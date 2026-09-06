import { xmlEscape, parsePackage, parsePackageSearch, parseLockHandle } from "./xml.js";
const PACKAGE_URL = "/sap/bc/adt/packages";
export function normalizePackageName(name) {
    const value = String(name ?? "").trim();
    if (!value) throw new Error("Package name is required.");
    return value.toUpperCase();
}
export function isLocalPackage(name) { return normalizePackageName(name).startsWith("$"); }
export function buildPackageXml(input) {
    const name = normalizePackageName(input.name);
    const packageType = input.packageType ?? "development";
    const responsible = input.responsible ?? "";
    const superPackage = input.superPackage?.trim() ? normalizePackageName(input.superPackage) : "";
    const softwareComponent = input.softwareComponent?.trim() || "LOCAL";
    const transportLayer = input.transportLayer?.trim() ?? "";
    const language = String(input.language ?? "").trim().toUpperCase();
    const recordChanges = input.recordChanges ?? (softwareComponent.toUpperCase() !== "LOCAL" || transportLayer !== "");
    return `<?xml version="1.0" encoding="UTF-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${xmlEscape(name)}" adtcore:type="DEVC/K" adtcore:description="${xmlEscape(input.description ?? "")}" adtcore:responsible="${xmlEscape(responsible)}"${language ? ` adtcore:masterLanguage="${xmlEscape(language)}"` : ""}>
  <adtcore:packageRef adtcore:name="${xmlEscape(name)}"/>
  <pak:attributes pak:packageType="${xmlEscape(packageType)}" pak:recordChanges="${recordChanges ? "true" : "false"}"/>
  <pak:superPackage adtcore:name="${xmlEscape(superPackage)}"/>
  <pak:applicationComponent/>
  <pak:transport>
    <pak:softwareComponent pak:name="${xmlEscape(softwareComponent)}"/>
    <pak:transportLayer pak:name="${xmlEscape(transportLayer)}"/>
  </pak:transport>
  <pak:translation/>
  <pak:useAccesses/>
  <pak:packageInterfaces/>
  <pak:subPackages/>
</pak:package>`;
}
function wildcardMatch(value, pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(value);
}
export class PackageApi {
    constructor(http) { this.http = http; }
    async list({ query = "*", description = "", superPackage = "", maxResults = 100 } = {}) {
        const searchQuery = String(query ?? "*").trim() || "*";
        const descriptionFilter = String(description ?? "").trim();
        const parentFilter = String(superPackage ?? "").trim();
        const limit = Math.max(1, Math.min(500, Number(maxResults) || 100));
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", { query: { operation: "quickSearch", query: searchQuery, objectType: "DEVC/K", maxResults: String(limit) }, headers: { Accept: "*/*" } });
        let items = parsePackageSearch(response.body)
            .filter(item => !searchQuery || searchQuery === "*" || wildcardMatch(item.name, searchQuery));

        // Quando o usuário informa um superpackage, consulta os detalhes dos pacotes
        // encontrados para obter o relacionamento hierárquico real informado pelo SAP.
        // O quickSearch nem sempre retorna o superpackage no resultado resumido.
        const needsEnrichment = Boolean(parentFilter) || items.some(item => !item.description || !item.superPackage);
        if (needsEnrichment) {
            const enriched = await Promise.all(items.map(async item => {
                if (!parentFilter && item.description && item.superPackage) return item;
                try {
                    const detail = await this.get(item.name);
                    return { ...item, description: item.description || detail.description || "", superPackage: detail.superPackage || item.superPackage || "", softwareComponent: item.softwareComponent || detail.softwareComponent || "", transportLayer: item.transportLayer || detail.transportLayer || "" };
                } catch {
                    return item;
                }
            }));
            items = enriched;
        }

        if (descriptionFilter) {
            items = items.filter(item => String(item.description || "").toUpperCase().includes(descriptionFilter.toUpperCase()));
        }
        if (parentFilter) {
            items = items.filter(item => String(item.superPackage || "").toUpperCase() === parentFilter.toUpperCase());
        }
        return { status: response.status, durationMs: response.durationMs, query: searchQuery, description: descriptionFilter, superPackage: parentFilter, maxResults: limit, count: items.length, items, raw: response.body };
    }
    async creationOptions() {
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", { query: { operation: "quickSearch", query: "*", objectType: "DEVC/K", maxResults: "500" }, headers: { Accept: "*/*" } });
        const items = parsePackageSearch(response.body);
        const superPackages = [...new Set(items.map(item => item.name).filter(Boolean))].sort();
        const softwareComponents = [...new Set(items.map(item => item.softwareComponent).filter(Boolean).concat(["HOME", "LOCAL"]))].sort();
        const transportLayers = [...new Set(items.map(item => item.transportLayer).filter(Boolean).concat(["SAP"]))].sort();
        return { status: response.status, durationMs: response.durationMs, superPackages, softwareComponents, transportLayers, raw: response.body };
    }
    async get(name) {
        const normalizedName = normalizePackageName(name);
        const response = await this.http.request(`${PACKAGE_URL}/${encodeURIComponent(normalizedName)}`, { headers: { Accept: "application/vnd.sap.adt.packages.v2+xml" } });
        return { ...parsePackage(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }
    async create(input) {
        const name = normalizePackageName(input.name);
        const local = name.startsWith("$");
        if (!local && !input.transport?.trim()) throw new Error(`A Workbench transport request is required for non-local package '${name}'.`);
        if (local && input.transport?.trim()) throw new Error(`Local package '${name}' must not use a transport request.`);
        const response = await this.http.write(PACKAGE_URL, { query: local ? undefined : { corrNr: input.transport.trim() }, headers: { "Content-Type": "application/vnd.sap.adt.packages.v2+xml", Accept: "application/vnd.sap.adt.packages.v2+xml" }, body: buildPackageXml({ ...input, name, recordChanges: local ? false : (input.recordChanges ?? true) }) });
        return { name, status: response.status, durationMs: response.durationMs, location: response.headers.get("location"), transport: input.transport, local, raw: response.body };
    }
    // Atualiza somente descrição e transport layer, preservando os demais dados retornados pelo SAP.
    async update(name, description, transportLayer, transport) {
        const normalizedName = normalizePackageName(name);
        const packageDescription = String(description ?? '').trim();
        const packageLayer = String(transportLayer ?? '').trim();
        if (!packageDescription) throw new Error('Package description is required.');
        if (!packageLayer) throw new Error('Package transport layer is required.');

        const current = await this.get(normalizedName);
        let body = current.raw;
        body = replaceAttribute(body, 'description', packageDescription, 'package');
        body = replaceTransportLayer(body, packageLayer);

        const token = await this.http.fetchCsrfToken();
        const local = normalizedName.startsWith('$');
        const requestNumber = String(transport ?? '').trim();
        if (!local && !requestNumber) throw new Error(`A Workbench transport request is required to update non-local package '${normalizedName}'.`);
        if (local && requestNumber) throw new Error(`Local package '${normalizedName}' must not use a transport request.`);

        const response = await this.http.request(`${PACKAGE_URL}/${encodeURIComponent(normalizedName)}`, {
            method: 'PUT',
            query: local ? undefined : { corrNr: requestNumber },
            headers: {
                'Content-Type': 'application/vnd.sap.adt.packages.v2+xml',
                Accept: 'application/vnd.sap.adt.packages.v2+xml',
                'X-CSRF-Token': token
            },
            body
        });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    async delete(name, transport) {
        const normalizedName = normalizePackageName(name);
        const local = normalizedName.startsWith("$");
        if (!local && !transport?.trim()) throw new Error(`A Workbench transport request is required to delete non-local package '${normalizedName}'.`);
        if (local && transport?.trim()) throw new Error(`Local package '${normalizedName}' must not use a transport request.`);
        const token = await this.http.fetchCsrfToken();
        const packageUrl = `${PACKAGE_URL}/${encodeURIComponent(normalizedName)}`;
        const lockResponse = await this.http.request(packageUrl, {
            method: "POST",
            query: { _action: "LOCK", accessMode: "MODIFY" },
            headers: {
                "X-CSRF-Token": token,
                "X-sap-adt-sessiontype": "stateful",
                Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result"
            }
        });
        const lock = parseLockHandle(lockResponse.body);
        if (!lock.lockHandle) throw new Error(`SAP did not return a lock handle for package '${normalizedName}'.`);
        let deleteResponse;
        let unlockError;
        try {
            deleteResponse = await this.http.request(packageUrl, { method: "DELETE", query: { lockHandle: lock.lockHandle, ...(local ? {} : { corrNr: transport.trim() }) }, headers: { "X-CSRF-Token": token, "X-sap-adt-sessiontype": "stateful", Accept: "application/vnd.sap.adt.packages.v2+xml, application/xml, */*" } });
        } finally {
            try { await this.http.request(packageUrl, { method: "POST", query: { _action: "UNLOCK", lockHandle: lock.lockHandle }, headers: { "X-CSRF-Token": token, "X-sap-adt-sessiontype": "stateful" }, retry: false }); }
            catch (error) { unlockError = error; }
        }
        if (unlockError && deleteResponse?.status >= 200 && deleteResponse.status < 300) return { status: deleteResponse.status, durationMs: deleteResponse.durationMs, raw: deleteResponse.body, unlockWarning: unlockError instanceof Error ? unlockError.message : String(unlockError) };
        return { status: deleteResponse.status, durationMs: deleteResponse.durationMs, raw: deleteResponse.body };
    }
}

// Substitui um atributo do elemento package sem alterar outros campos do XML.
function replaceAttribute(xml, attribute, value, elementType) {
    const escapedValue = xmlEscape(value);
    const pattern = new RegExp(`(<(?:[A-Za-z_][\\w:.-]*:)?${elementType}\\b[^>]*\\b(?:[A-Za-z_][\\w:.-]*:)?${attribute}=)(["'])(.*?)\\2`, 'i');
    if (pattern.test(xml)) return xml.replace(pattern, `$1"${escapedValue}"`);
    return xml;
}

// Substitui o transport layer existente ou o adiciona dentro do bloco de transporte.
function replaceTransportLayer(xml, transportLayer) {
    const escapedValue = xmlEscape(transportLayer);
    const existingPattern = /(<(?:[A-Za-z_][\w:.-]*:)?transportLayer\b[^>]*\b(?:[A-Za-z_][\w:.-]*:)?name=)([\"'])(.*?)\2/i;
    if (existingPattern.test(xml)) return xml.replace(existingPattern, `$1"${escapedValue}"`);

    const transportPattern = /(<(?:[A-Za-z_][\w:.-]*:)?transport\b[^>]*>)/i;
    if (!transportPattern.test(xml)) return xml;
    return xml.replace(transportPattern, `$1\n    <pak:transportLayer pak:name="${escapedValue}"/>`);
}

