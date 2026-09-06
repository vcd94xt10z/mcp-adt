import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { AdtHttpClient } from "../adt/http.js";
import { PackageApi } from "../adt/packages.js";
import { RequestApi } from "../adt/requests.js";
import { ClassApi } from "../adt/classes.js";
import { ReportApi } from "../adt/reports.js";
import { ActivationApi } from "../adt/activation.js";
import { saveConnections, validateConnection, validateConnectionName } from "../config.js";
import { clearLog, getLogFile, isLogEnabled, readLog, setLogEnabled } from "../log.js";
const publicDir = join(process.cwd(), "public");
const connectionsFile = resolve(process.cwd(), "connections.json");
export function createWebServer(connections, host = "127.0.0.1", port = 3100) {
    const clients = new Map();
    async function persistConnections() {
        await saveConnections(connections, connectionsFile);
    }
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname === "/api/connections" && req.method === "GET") {
                return json(res, 200, { connections: Object.entries(connections).map(([name, config]) => ({ name, ...config, password: undefined })) });
            }
            if (url.pathname === "/api/connections" && req.method === "POST") {
                const payload = await readJson(req);
                const name = validateConnectionName(String(payload.name ?? ""));
                if (connections[name])
                    return json(res, 409, { ok: false, error: `Connection '${name}' already exists.` });
                const config = connectionFromPayload(payload);
                validateConnection(config);
                connections[name] = config;
                await persistConnections();
                return json(res, 201, { ok: true, name, connection: { name, ...config, password: undefined } });
            }
            const connectionTestMatch = url.pathname.match(/^\/api\/connections\/([^/]+)\/test$/);
            if (connectionTestMatch && req.method === "POST") {
                const name = decodeURIComponent(connectionTestMatch[1]);
                const config = connections[name];
                if (!config)
                    return json(res, 404, { ok: false, error: `Connection '${name}' not found.` });
                const client = getClient(name, config, clients);
                const started = performance.now();
                const response = await client.request("/sap/bc/adt/discovery", { headers: { Accept: "application/xml, text/xml, */*" } });
                return json(res, 200, { ok: true, operation: "connection_test", connection: name, status: response.status, durationMs: Math.round(performance.now() - started), raw: response.body });
            }
            const connectionMatch = url.pathname.match(/^\/api\/connections\/([^/]+)$/);
            if (connectionMatch && req.method === "PUT") {
                const name = decodeURIComponent(connectionMatch[1]);
                if (!connections[name])
                    return json(res, 404, { ok: false, error: `Connection '${name}' not found.` });
                const payload = await readJson(req);
                const config = connectionFromPayload(payload, connections[name]);
                validateConnection(config);
                connections[name] = config;
                clients.delete(name);
                await persistConnections();
                return json(res, 200, { ok: true, name, connection: { name, ...config, password: undefined } });
            }
            if (connectionMatch && req.method === "DELETE") {
                const name = decodeURIComponent(connectionMatch[1]);
                if (!connections[name])
                    return json(res, 404, { ok: false, error: `Connection '${name}' not found.` });
                delete connections[name];
                clients.delete(name);
                await persistConnections();
                return json(res, 200, { ok: true, name });
            }
            if (url.pathname === "/api/environment-options" && req.method === "GET") {
                const connectionName = String(url.searchParams.get("connection") ?? "");
                const config = connections[connectionName];
                if (!config) return json(res, 400, { ok: false, error: `Unknown SAP connection '${connectionName}'.` });
                const client = getClient(connectionName, config, clients);
                const [packageOptions, targetOptions, requestOptions, systemInfo] = await Promise.all([
                    new PackageApi(client).creationOptions(),
                    new RequestApi(client).listTargets(),
                    new RequestApi(client).listModifiableWorkbench(config.user),
                    getSystemInformation(client)
                ]);
                const languages = parseInstalledLanguages(systemInfo.raw, config.language);
                return json(res, 200, {
                    ok: true,
                    connection: connectionName,
                    user: config.user,
                    languages,
                    superPackages: packageOptions.superPackages,
                    softwareComponents: packageOptions.softwareComponents,
                    transportLayers: packageOptions.transportLayers,
                    targets: targetOptions.items,
                    modifiableWorkbenchRequests: requestOptions.items
                });
            }
            if (url.pathname === "/api/log" && req.method === "GET") {
                return json(res, 200, { ok: true, enabled: isLogEnabled(), file: getLogFile(), entries: await readLog() });
            }
            if (url.pathname === "/api/log" && req.method === "POST") {
                const payload = await readJson(req);
                const enabled = setLogEnabled(payload.enabled);
                return json(res, 200, { ok: true, enabled, file: getLogFile() });
            }
            if (url.pathname === "/api/log" && req.method === "DELETE") {
                await clearLog();
                return json(res, 200, { ok: true, file: getLogFile() });
            }
            if (url.pathname === "/api/health" && req.method === "GET") {
                return json(res, 200, { ok: true, service: "mcp-adt-web" });
            }
            if (url.pathname === "/api/execute" && req.method === "POST") {
                const payload = await readJson(req);
                return await execute(res, connections, clients, payload);
            }
            if (req.method === "GET")
                return serveStatic(req, res);
            return json(res, 404, { error: "Not found" });
        }
        catch (error) {
            const status = Number(error?.response?.status) >= 400 ? Number(error.response.status) : 500;
            return json(res, status, { ok: false, error: serializeError(error) });
        }
    });
    return {
        server,
        start() {
            return new Promise((resolveStart, reject) => {
                server.once("error", reject);
                server.listen(port, host, () => {
                    server.off("error", reject);
                    console.error(`mcp-adt web UI: http://${host}:${port}`);
                    resolveStart();
                });
            });
        },
        stop() {
            return new Promise((resolveStop, reject) => server.close(error => error ? reject(error) : resolveStop()));
        }
    };
}
function connectionFromPayload(payload, existing) {
    const password = String(payload.password ?? "");
    return {
        url: String(payload.url ?? "").trim(),
        client: String(payload.client ?? "").trim(),
        user: String(payload.user ?? "").trim(),
        password: password || existing?.password || "",
        ...(String(payload.language ?? "").trim() ? { language: String(payload.language).trim() } : {}),
        ...(payload.rejectUnauthorized === undefined ? {} : { rejectUnauthorized: Boolean(payload.rejectUnauthorized) })
    };
}
async function execute(res, connections, clients, payload) {
    const operation = String(payload.operation ?? "");
    const connectionName = String(payload.connection ?? "");
    const config = connections[connectionName];
    if (!config)
        return json(res, 400, { ok: false, error: `Unknown SAP connection '${connectionName}'.` });
    const client = getClient(connectionName, config, clients);
    const input = (payload.input ?? {});
    const started = performance.now();
    let result;
    switch (operation) {
        case "package_list":
            result = await new PackageApi(client).list({ query: optional(input, "query") ?? "Z*", maxResults: Number(input.maxResults) || 100 });
            break;
        case "package_get":
            result = await new PackageApi(client).get(required(input, "name"));
            break;
        case "package_validate_object":
            result = await new PackageApi(client).validateObjectCompatibility(required(input, "name"), required(input, "objectType"));
            break;
        case "package_create": {
            const packageInput = {
                name: required(input, "name"), description: String(input.description ?? ""),
                superPackage: optional(input, "superPackage"), responsible: config.user,
                language: optional(input, "language"), packageType: input.packageType,
                softwareComponent: optional(input, "softwareComponent"), transportLayer: optional(input, "transportLayer"),
                transport: optional(input, "transport"),
                recordChanges: input.recordChanges === undefined ? undefined : Boolean(input.recordChanges)
            };
            result = await new PackageApi(client).create(packageInput);
            break;
        }
        case "package_update": {
            const name = required(input, "name");
            result = await new PackageApi(client).update(name, String(input.description ?? ''), optional(input, 'transportLayer'), optional(input, 'transport'));
            break;
        }
        case "package_delete": {
            const name = required(input, "name");
            result = await new PackageApi(client).delete(name, optional(input, "transport"));
            break;
        }
        case "class_list":
            result = await new ClassApi(client).list({ query: optional(input, "query") ?? "ZCL*", maxResults: Number(input.maxResults) || 100 });
            break;
        case "class_get": {
            const api = new ClassApi(client); const name = required(input, "name"); const version = optional(input, "version");
            const [classData, source, transport] = await Promise.all([
                api.get(name, version),
                api.getSource(name, version),
                api.getTransport(name).catch(() => ({ number: "" }))
            ]);
            result = { class: classData, source, transport };
            break;
        }
        case "class_create": {
            result = await new ClassApi(client).create({ name: required(input, "name"), description: String(input.description ?? ""), packageName: required(input, "packageName"), transport: optional(input, "transport"), language: optional(input, "language") ?? config.language ?? "EN", responsible: config.user, final: input.final === undefined ? true : Boolean(input.final), visibility: optional(input, "visibility") ?? "public", source: String(input.source ?? "") });
            break;
        }
        case "class_update":
            result = await new ClassApi(client).update({
                name: required(input, "name"),
                description: String(input.description ?? ""),
                packageName: optional(input, "packageName"),
                transport: optional(input, "transport"),
                language: optional(input, "language"),
                responsible: optional(input, "responsible"),
                final: input.final === undefined ? undefined : Boolean(input.final),
                visibility: optional(input, "visibility"),
                source: String(input.source ?? "")
            });
            break;
        case "class_update_source":
            result = await new ClassApi(client).updateSource(required(input, "name"), String(input.source ?? ""), optional(input, "transport"), optional(input, "packageName"));
            break;
        case "class_activate": {
            const name = required(input, "name").toUpperCase();
            result = await new ActivationApi(client).activate({ uri: `/sap/bc/adt/oo/classes/${encodeURIComponent(name.toLowerCase())}`, name });
            break;
        }
        case "class_delete_check":
            result = await new ClassApi(client).checkDelete(required(input, "name"));
            break;
        case "class_delete":
            result = await new ClassApi(client).delete(required(input, "name"), optional(input, "transport"));
            break;
        case "report_list":
            result = await new ReportApi(client).list({ query: optional(input, "query") ?? "Z*", maxResults: Number(input.maxResults) || 100 });
            break;
        case "report_get": {
            const api = new ReportApi(client); const name = required(input, "name"); const version = optional(input, "version");
            const [report, source, transport] = await Promise.all([api.get(name, version), api.getSource(name, version), api.getTransport(name).catch(() => ({ number: "" }))]);
            result = { report, source, transport };
            break;
        }
        case "report_create":
            result = await new ReportApi(client).create({ name: required(input, "name"), description: String(input.description ?? ""), packageName: required(input, "packageName"), transport: optional(input, "transport"), language: optional(input, "language") ?? config.language ?? "EN", responsible: config.user, source: String(input.source ?? "") });
            break;
        case "report_update":
            result = await new ReportApi(client).update({ name: required(input, "name"), description: String(input.description ?? ""), packageName: optional(input, "packageName"), transport: optional(input, "transport"), language: optional(input, "language"), responsible: optional(input, "responsible"), source: String(input.source ?? "") });
            break;
        case "report_update_source":
            result = await new ReportApi(client).updateSource(required(input, "name"), String(input.source ?? ""), optional(input, "transport"), optional(input, "packageName"));
            break;
        case "report_activate": {
            const name = required(input, "name").toUpperCase();
            result = await new ActivationApi(client).activate({ uri: `/sap/bc/adt/programs/programs/${encodeURIComponent(name.toLowerCase())}`, name });
            break;
        }
        case "report_delete_check":
            result = await new ReportApi(client).checkDelete(required(input, "name"));
            break;
        case "report_delete":
            result = await new ReportApi(client).delete(required(input, "name"), optional(input, "transport"));
            break;
        case "request_list":
            result = await new RequestApi(client).list();
            break;
        case "request_modifiable_workbench_list":
            result = await new RequestApi(client).listModifiableWorkbench(config.user);
            break;
        case "request_get":
            result = await new RequestApi(client).get(required(input, "number"));
            break;
        case "request_create":
            result = await new RequestApi(client).create({
                description: required(input, "description"),
                target: optional(input, "target"),
                category: String(input.category ?? "K").trim().toUpperCase(),
                owner: config.user
            });
            break;
        case "request_update":
            result = await new RequestApi(client).update(required(input, "number"), required(input, "description"), input.target);
            break;
        case "request_delete":
            result = await new RequestApi(client).delete(required(input, "number"));
            break;
        default: return json(res, 400, { ok: false, error: `Unknown operation '${operation}'.` });
    }
    return json(res, 200, { ok: true, operation, connection: connectionName, elapsedMs: Math.round(performance.now() - started), result });
}
async function getSystemInformation(client) {
    try {
        return await client.request("/sap/bc/adt/core/http/systeminformation", { headers: { Accept: "application/xml, text/xml, */*" } });
    } catch {
        return { body: "" };
    }
}
function parseInstalledLanguages(xml, configuredLanguage) {
    const source = String(xml ?? "");
    const found = [];

    // Adiciona um idioma somente uma vez e mantém a primeira descrição encontrada.
    const addLanguage = (code, description = "") => {
        const normalizedCode = String(code ?? "").trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(normalizedCode)) return;
        found.push({ code: normalizedCode, description: String(description ?? "").trim() });
    };

    // Lê idiomas informados como atributos XML.
    for (const match of source.matchAll(/<(?:[^:>]+:)?(?:language|lang)\b([^>]*)>(?:\s*([^<]+)\s*)?<\//gi)) {
        const attrs = match[1] ?? "";
        const text = match[2] ?? "";
        const code = attrs.match(/(?:code|key|id|value|language)=['"]([^'"]+)['"]/i)?.[1] ?? text;
        const description = attrs.match(/(?:description|desc|name|text|title)=['"]([^'"]+)['"]/i)?.[1] ?? "";
        addLanguage(code, description);
    }

    // Lê listas de idiomas retornadas pelo systeminformation em atributos ou elementos.
    const listPattern = /(?:installed[_-]?languages|languages|logon[_-]?languages)=['"]([^'"]+)['"]|<(?:[^:>]+:)?(?:installed[_-]?languages|languages|logon[_-]?languages)[^>]*>\s*([^<]+)\s*<\//gi;
    for (const match of source.matchAll(listPattern)) {
        String(match[1] ?? match[2] ?? "").split(/[,;\s]+/).forEach(code => addLanguage(code, "Idioma do sistema"));
    }

    // Lê estruturas JSON quando o endpoint for convertido pelo backend para JSON.
    try {
        const json = JSON.parse(source);
        const candidates = json.languages ?? json.installedLanguages ?? json.installed_languages ?? [];
        (Array.isArray(candidates) ? candidates : String(candidates).split(/[,;\s]+/)).forEach(item => {
            if (typeof item === "string") addLanguage(item, "Idioma do sistema");
            else if (item && typeof item === "object") addLanguage(item.code ?? item.language ?? item.key, item.description ?? item.text ?? item.name);
        });
    } catch {
        // A resposta normalmente é XML; não há ação necessária quando não for JSON.
    }

    addLanguage(configuredLanguage, "Idioma da conexão");

    // Alguns sistemas não expõem a lista de idiomas pelo systeminformation.
    // Nesse caso disponibilizamos a lista padrão de idiomas SAP para o Value Help.
    if (new Set(found.map(item => item.code)).size <= 1) {
        for (const item of defaultSapLanguages()) addLanguage(item.code, item.description);
    }

    const unique = new Map();
    for (const item of found) {
        const existing = unique.get(item.code);
        if (!existing || (!existing.description && item.description)) unique.set(item.code, item);
    }
    return [...unique.values()].sort((a, b) => a.code.localeCompare(b.code));
}

// Retorna os idiomas padrão usados pelo SAP GUI para fallback do Value Help.
function defaultSapLanguages() {
    return [
        ["AF", "Afrikaans"], ["AR", "Arabic"], ["BG", "Bulgarian"], ["CA", "Catalan"], ["CS", "Czech"],
        ["DA", "Danish"], ["DE", "German"], ["EL", "Greek"], ["EN", "English"], ["ES", "Spanish"],
        ["ET", "Estonian"], ["FI", "Finnish"], ["FR", "French"], ["HE", "Hebrew"], ["HI", "Hindi"],
        ["HR", "Croatian"], ["HU", "Hungarian"], ["ID", "Indonesian"], ["IS", "Icelandic"], ["IT", "Italian"],
        ["JA", "Japanese"], ["KK", "Kazakh"], ["KO", "Korean"], ["LT", "Lithuanian"], ["LV", "Latvian"],
        ["MS", "Malay"], ["NL", "Dutch"], ["NO", "Norwegian"], ["PL", "Polish"], ["PT", "Portuguese"],
        ["RO", "Romanian"], ["RU", "Russian"], ["SH", "Serbian Latin"], ["SK", "Slovak"], ["SL", "Slovenian"],
        ["SV", "Swedish"], ["TH", "Thai"], ["TR", "Turkish"], ["UK", "Ukrainian"], ["VI", "Vietnamese"],
        ["ZF", "Chinese Simplified"], ["ZH", "Chinese Traditional"]
    ].map(([code, description]) => ({ code, description }));
}

function getClient(name, config, clients) {
    let client = clients.get(name);
    if (!client) {
        client = new AdtHttpClient(config);
        clients.set(name, client);
    }
    return client;
}
function required(input, key) {
    const value = String(input[key] ?? "").trim();
    if (!value)
        throw new Error(`Field '${key}' is required.`);
    return value;
}
function optional(input, key) {
    const value = String(input[key] ?? "").trim();
    return value || undefined;
}
async function readJson(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
}
async function serveStatic(req, res) {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const requested = pathname === "/" ? "/index.html" : pathname;
    const safePath = join(publicDir, requested.replace(/^\/+/, ""));
    if (!safePath.startsWith(publicDir))
        return json(res, 403, { error: "Forbidden" });
    try {
        const data = await readFile(safePath);
        const type = mimeType(extname(safePath));
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(data);
    }
    catch {
        return json(res, 404, { error: "Not found" });
    }
}
function mimeType(ext) {
    return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" }[ext] ?? "application/octet-stream";
}
function json(res, status, value) {
    const body = JSON.stringify(value, null, 2);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
}
function serializeError(error) {
    if (error && typeof error === "object" && "response" in error) {
        const e = error;
        return { message: e.message, userMessage: e.userMessage, retryable: e.retryable, response: e.response };
    }
    return error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
}
