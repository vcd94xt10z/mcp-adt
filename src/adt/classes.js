import { xmlEscape, parseLockHandle } from "./xml.js";

const CLASSES_URL = "/sap/bc/adt/oo/classes";
const CLASS_CONTENT_TYPE = "application/vnd.sap.adt.oo.classes.v4+xml";

// Normaliza e valida o nome de uma classe ABAP.
export function normalizeClassName(name) {
    const value = String(name ?? "").trim().toUpperCase();
    if (!value) throw new Error("Class name is required.");
    return value;
}

// Converte um padrão com * e ? em uma expressão regular local.
function wildcardMatch(value, pattern) {
    const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(String(value));
}

// Extrai referências de objetos CLAS da resposta do Repository Information System.
function parseClassSearch(xml) {
    const source = String(xml ?? "");
    const items = [];
    const seen = new Set();
    const tagPattern = /<(?:[\w.-]+:)?(?:objectReference|object|result|item)\b([^>]*)>/gi;
    for (const match of source.matchAll(tagPattern)) {
        const attrs = match[1];
        const attr = name => {
            const found = attrs.match(new RegExp(`(?:[\\w.-]+:)?${name}=["']([^"']*)["']`, "i"));
            return found?.[1] ?? "";
        };
        const type = attr("type").toUpperCase();
        const name = attr("name");
        if (!name || !/^CLAS(?:\/OC)?$/i.test(type)) continue;
        const key = name.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ name, type: type || "CLAS", description: attr("description"), packageName: attr("packageName"), uri: attr("uri") });
    }
    return items;
}

// Lê atributos ADT da definição XML da classe.
function parseClass(xml) {
    const source = String(xml ?? "");
    const attr = name => {
        const found = source.match(new RegExp(`(?:[\\w.-]+:)?${name}=["']([^"']*)["']`, "i"));
        return found?.[1] ?? "";
    };
    const packageMatch = source.match(/<(?:[\w.-]+:)?packageRef\b[^>]*(?:[\w.-]+:)?name=["']([^"']*)["']/i);
    return {
        name: attr("name"),
        type: attr("type"),
        description: attr("description"),
        language: attr("masterLanguage") || attr("language"),
        responsible: attr("responsible"),
        packageName: packageMatch?.[1] ?? "",
        final: attr("final").toLowerCase() === "true",
        visibility: attr("visibility"),
        raw: source
    };
}

// Monta o XML de criação reproduzindo o formato usado pelo Eclipse.
export function buildClassXml(input) {
    const name = normalizeClassName(input.name);
    return `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core" xmlns:class="http://www.sap.com/adt/oo/classes" adtcore:description="${xmlEscape(input.description ?? "")}" adtcore:language="${xmlEscape(input.language ?? "EN")}" adtcore:name="${xmlEscape(name)}" adtcore:type="CLAS/OC" adtcore:masterLanguage="${xmlEscape(input.language ?? "EN")}" adtcore:responsible="${xmlEscape(input.responsible ?? "")}" class:final="${input.final === false ? "false" : "true"}" class:visibility="${xmlEscape(input.visibility ?? "public")}">
  <adtcore:packageRef adtcore:name="${xmlEscape(String(input.packageName ?? "").trim().toUpperCase())}"/>
  <class:include adtcore:name="CLAS/OC" adtcore:type="CLAS/OC" class:includeType="testclasses"/>
  <class:superClassRef/>
</class:abapClass>`;
}

// API ADT responsável pelas operações de classes ABAP.
export class ClassApi {
    constructor(http) { this.http = http; }

    // Lista classes pelo padrão informado, incluindo suporte a * e ?.
    async list({ query = "ZCL*", maxResults = 100 } = {}) {
        const searchQuery = String(query ?? "ZCL*").trim() || "*";
        const limit = Math.max(1, Math.min(500, Number(maxResults) || 100));
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", {
            query: { operation: "quickSearch", query: searchQuery, objectType: "CLAS", maxResults: String(limit) },
            headers: { Accept: "application/xml" }
        });
        const items = parseClassSearch(response.body).filter(item => wildcardMatch(item.name, searchQuery));
        return { status: response.status, durationMs: response.durationMs, query: searchQuery, maxResults: limit, count: items.length, items, raw: response.body };
    }

    // Consulta os metadados de uma classe.
    async get(name, version) {
        const className = normalizeClassName(name);
        const response = await this.http.request(`${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}`, {
            query: version ? { version } : undefined,
            headers: { Accept: `${CLASS_CONTENT_TYPE}, application/vnd.sap.adt.oo.classes.v3+xml, application/vnd.sap.adt.oo.classes.v2+xml, application/vnd.sap.adt.oo.classes+xml` }
        });
        return { ...parseClass(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Consulta o código fonte principal da classe.
    async getSource(name, version) {
        const className = normalizeClassName(name);
        const response = await this.http.request(`${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}/source/main`, {
            query: version ? { version } : undefined,
            headers: { Accept: "text/plain" }
        });
        return { name: className, source: response.body, status: response.status, durationMs: response.durationMs };
    }

    // Valida o nome da classe antes da criação.
    async validateName(input) {
        const className = normalizeClassName(input.name);
        const response = await this.http.write("/sap/bc/adt/oo/validation/objectname", {
            query: { objname: className, packagename: String(input.packageName ?? "").trim().toUpperCase(), description: String(input.description ?? ""), objtype: "CLAS/OC" },
            headers: { Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.oo.clifname.check" }
        });
        const valid = /<CHECK_RESULT>\s*X\s*<\/CHECK_RESULT>/i.test(response.body);
        return { name: className, valid, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Executa a validação de transporte usada pelo Eclipse antes da criação.
    async checkTransport(packageName, name) {
        const uri = `${CLASSES_URL}/${encodeURIComponent(normalizeClassName(name).toLowerCase())}/source/main`;
        const body = `<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><PGMID></PGMID><OBJECT></OBJECT><OBJECTNAME></OBJECTNAME><DEVCLASS>${xmlEscape(String(packageName ?? "").trim().toUpperCase())}</DEVCLASS><SUPER_PACKAGE></SUPER_PACKAGE><RECORD_CHANGES></RECORD_CHANGES><OPERATION>I</OPERATION><URI>${xmlEscape(uri)}</URI></DATA></asx:values></asx:abap>`;
        const response = await this.http.write("/sap/bc/adt/cts/transportchecks", {
            headers: { "Content-Type": "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData", Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData" }, body
        });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Cria a classe e grava o código fonte informado somente depois da criação.
    async create(input) {
        const name = normalizeClassName(input.name);
        const packageName = String(input.packageName ?? "").trim().toUpperCase();
        if (!packageName) throw new Error("Package name is required.");
        const transport = String(input.transport ?? "").trim();
        if (!packageName.startsWith("$") && !transport) throw new Error(`A Workbench transport request is required for class '${name}'.`);
        const validation = await this.validateName({ ...input, name, packageName });
        if (!validation.valid) throw new Error(`SAP rejected the class name '${name}'.`);
        await this.checkTransport(packageName, name);
        const response = await this.http.write(CLASSES_URL, {
            query: transport ? { corrNr: transport } : undefined,
            headers: { "Content-Type": CLASS_CONTENT_TYPE, Accept: CLASS_CONTENT_TYPE },
            body: buildClassXml({ ...input, name, packageName })
        });
        if (String(input.source ?? "").trim()) {
            await this.updateSource(name, String(input.source), transport);
        }
        return { name, packageName, transport: transport || undefined, status: response.status, durationMs: response.durationMs, location: response.headers.get("location"), raw: response.body };
    }

    // Bloqueia a classe para modificação e retorna o lock handle.
    async lock(name) {
        const className = normalizeClassName(name);
        const response = await this.http.write(`${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}`, {
            query: { _action: "LOCK", accessMode: "MODIFY" },
            headers: { "X-sap-adt-sessiontype": "stateful", Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2" }
        });
        const lock = parseLockHandle(response.body);
        if (!lock.lockHandle) throw new Error(`SAP did not return a lock handle for class '${className}'.`);
        return { ...lock, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Desbloqueia a classe depois de uma modificação.
    async unlock(name, lockHandle) {
        const className = normalizeClassName(name);
        return this.http.write(`${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}`, { query: { _action: "UNLOCK", lockHandle }, headers: { "X-sap-adt-sessiontype": "stateful" } });
    }

    // Atualiza o código fonte garantindo o unlock mesmo em caso de erro.
    // Atualiza o código fonte usando PUT, após bloquear a classe no SAP.
    async updateSource(name, source, transport) {
        const className = normalizeClassName(name);
        const request = String(transport ?? "").trim();
        if (!request) throw new Error(`A Workbench transport request is required to update class '${className}'.`);
        const lock = await this.lock(className);
        let updateError;
        try {
            const token = await this.http.fetchCsrfToken();
            const response = await this.http.request(`${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}/source/main`, {
                method: "PUT",
                query: { lockHandle: lock.lockHandle, corrNr: request },
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    Accept: "text/plain",
                    "X-CSRF-Token": token
                },
                body: String(source ?? "")
            });
            return { name: className, status: response.status, durationMs: response.durationMs, raw: response.body };
        } catch (error) {
            updateError = error;
            throw error;
        } finally {
            try { await this.unlock(className, lock.lockHandle); } catch (unlockError) { if (!updateError) throw unlockError; }
        }
    }

    // Extrai uma ordem de transporte de diferentes respostas XML retornadas pelo ADT.
    parseTransportNumber(raw) {
        const source = String(raw ?? "");
        const patterns = [
            /<(?:[\w.-]+:)?TRKORR\b[^>]*>\s*([^<\s]+)\s*<\//i,
            /<(?:[\w.-]+:)?(?:transportNumber|requestNumber|request)\b[^>]*>\s*([^<\s]+)\s*<\//i,
            /(?:[\w.-]+:)?(?:trkorr|transportNumber|requestNumber|request)=['"]([^'"]+)['"]/i
        ];
        return patterns.map(pattern => source.match(pattern)?.[1] ?? "").find(Boolean)?.trim() ?? "";
    }

    // Consulta a ordem de transporte associada à classe.
    async getTransport(name) {
        const className = normalizeClassName(name);
        const uri = `${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}/transports`;
        const accepts = [
            "application/vnd.sap.as+xml;charset=utf-8;dataname=com.sap.adt.lock.result2",
            "application/vnd.sap.as+xml; charset=utf-8",
            "application/xml, text/xml"
        ];
        let lastError;

        for (const accept of accepts) {
            try {
                const response = await this.http.request(uri, {
                    headers: { Accept: accept, "X-sap-adt-sessiontype": "stateful" }
                });
                const number = this.parseTransportNumber(response.body);
                if (number) return { name: className, number, status: response.status, durationMs: response.durationMs, raw: response.body };
            } catch (error) {
                lastError = error;
            }
        }

        // O check de exclusão também retorna a request sugerida/associada pelo SAP.
        try {
            const check = await this.checkDelete(className);
            if (check.transport) return { name: className, number: check.transport, status: check.status, durationMs: check.durationMs, raw: check.raw };
        } catch (error) {
            lastError = error;
        }

        if (lastError) throw lastError;
        return { name: className, number: "" };
    }

    // Executa o check de exclusão usado pelo Eclipse e retorna o transporte sugerido pelo SAP.
    async checkDelete(name) {
        const className = normalizeClassName(name);
        const uri = `${CLASSES_URL}/${encodeURIComponent(className.toLowerCase())}`;
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<del:checkRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion">\n  <del:object adtcore:uri="${xmlEscape(uri)}"/>\n</del:checkRequest>`;
        const response = await this.http.write("/sap/bc/adt/deletion/check", { headers: { "Content-Type": "application/vnd.sap.adt.deletion.check.request.v1+xml", Accept: "application/vnd.sap.adt.deletion.check.response.v1+xml" }, body });
        const isDeletable = /isDeletable=["']true["']/i.test(response.body);
        const transport = this.parseTransportNumber(response.body);
        return { name: className, uri, isDeletable, transport, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Exclui a classe utilizando o endpoint de exclusão genérico do ADT.
    async delete(name, transport) {
        const check = await this.checkDelete(name);
        if (!check.isDeletable) throw new Error(`Class '${check.name}' cannot be deleted because SAP reported dependencies or restrictions.`);
        const transportNumber = String(transport ?? check.transport ?? "").trim();
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<del:deletionRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion">\n  <del:object adtcore:uri="${xmlEscape(check.uri)}">${transportNumber ? `\n    <del:transportNumber>${xmlEscape(transportNumber)}</del:transportNumber>` : ""}\n  </del:object>\n</del:deletionRequest>`;
        const response = await this.http.write("/sap/bc/adt/deletion/delete", { headers: { "Content-Type": "application/vnd.sap.adt.deletion.request.v1+xml", Accept: "application/vnd.sap.adt.deletion.response.v1+xml" }, body });
        return { name: check.name, deleted: /isDeleted=["']true["']/i.test(response.body), transport: transportNumber || undefined, status: response.status, durationMs: response.durationMs, raw: response.body };
    }
}
