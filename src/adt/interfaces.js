import { xmlEscape, parseLockHandle } from "./xml.js";

const INTERFACES_URL = "/sap/bc/adt/oo/interfaces";
const INTERFACE_CONTENT_TYPE = "application/vnd.sap.adt.oo.interfaces.v5+xml";

// Identifica pacotes locais, que não exigem ordem de transporte.
function isLocalPackage(packageName) {
    return String(packageName ?? "").trim().toUpperCase().startsWith("$");
}

// Normaliza e valida o nome de uma interface ABAP.
export function normalizeInterfaceName(name) {
    const value = String(name ?? "").trim().toUpperCase();
    if (!value) throw new Error("Interface name is required.");
    return value;
}

// Converte um padrão com * e ? em uma expressão regular local.
function wildcardMatch(value, pattern) {
    const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(String(value));
}

// Extrai referências de objetos CLAS da resposta do Repository Information System.
function parseInterfaceSearch(xml) {
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
        if (!name || !/^INTF(?:\/OI)?$/i.test(type)) continue;
        const key = name.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ name, type: type || "INTF", description: attr("description"), packageName: attr("packageName"), uri: attr("uri") });
    }
    return items;
}

// Lê atributos ADT da definição XML da interface.
function parseInterface(xml) {
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
        version: attr("version"),
        raw: source
    };
}

// Monta o XML de criação reproduzindo o formato usado pelo Eclipse.
export function buildInterfaceXml(input) {
    const name = normalizeInterfaceName(input.name);
    return `<?xml version="1.0" encoding="UTF-8"?>
<intf:abapInterface xmlns:adtcore="http://www.sap.com/adt/core" xmlns:intf="http://www.sap.com/adt/oo/interfaces" adtcore:description="${xmlEscape(input.description ?? "")}" adtcore:language="${xmlEscape(input.language ?? "EN")}" adtcore:name="${xmlEscape(name)}" adtcore:type="INTF/OI" adtcore:masterLanguage="${xmlEscape(input.language ?? "EN")}" adtcore:responsible="${xmlEscape(input.responsible ?? "")}">
  <adtcore:packageRef adtcore:name="${xmlEscape(String(input.packageName ?? "").trim().toUpperCase())}"/>
</intf:abapInterface>`;
}

// API ADT responsável pelas operações de interfaces ABAP.
export class InterfaceApi {
    constructor(http) { this.http = http; }

    // Lista interfaces pelo padrão informado, incluindo suporte a * e ?.
    async list({ query = "ZIF*", maxResults = 100 } = {}) {
        const searchQuery = String(query ?? "ZIF*").trim() || "*";
        const limit = Math.max(1, Math.min(500, Number(maxResults) || 100));
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", {
            query: { operation: "quickSearch", query: searchQuery, objectType: "INTF", maxResults: String(limit) },
            headers: { Accept: "application/xml" }
        });
        const items = parseInterfaceSearch(response.body).filter(item => wildcardMatch(item.name, searchQuery));
        return { status: response.status, durationMs: response.durationMs, query: searchQuery, maxResults: limit, count: items.length, items, raw: response.body };
    }

    // Consulta os metadados de uma interface.
    async get(name, version) {
        const interfaceName = normalizeInterfaceName(name);
        const response = await this.http.request(`${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}`, {
            query: version ? { version } : undefined,
            headers: { Accept: `${INTERFACE_CONTENT_TYPE}, application/vnd.sap.adt.oo.interfaces.v4+xml, application/vnd.sap.adt.oo.interfaces.v3+xml, application/vnd.sap.adt.oo.interfaces.v2+xml, application/vnd.sap.adt.oo.interfaces+xml` }
        });
        return { ...parseInterface(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Consulta o código fonte principal da interface.
    async getSource(name, version) {
        const interfaceName = normalizeInterfaceName(name);
        const response = await this.http.request(`${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}/source/main`, {
            query: version ? { version } : undefined,
            headers: { Accept: "text/plain" }
        });
        return { name: interfaceName, source: response.body, status: response.status, durationMs: response.durationMs };
    }

    // Carrega primeiro a versão inativa para edição e usa a ativa quando não existe versão inativa.
    async getForEdit(name) {
        try {
            const interfaceData = await this.get(name, "inactive");
            const source = await this.getSource(name, "inactive");
            if (String(interfaceData.version).toLowerCase() === "inactive") {
                return { interface: interfaceData, source, version: "inactive" };
            }
        } catch (error) {
            // Sem versão inativa, continua com a versão ativa.
        }

        const interfaceData = await this.get(name, "active");
        const source = await this.getSource(name, "active");
        return { interface: interfaceData, source, version: "active" };
    }

    // Valida o nome da interface antes da criação.
    async validateName(input) {
        const interfaceName = normalizeInterfaceName(input.name);
        const response = await this.http.write("/sap/bc/adt/oo/validation/objectname", {
            query: { objname: interfaceName, packagename: String(input.packageName ?? "").trim().toUpperCase(), description: String(input.description ?? ""), objtype: "INTF/OI" },
            headers: { Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.oo.clifname.check" }
        });
        const valid = /<CHECK_RESULT>\s*X\s*<\/CHECK_RESULT>/i.test(response.body);
        return { name: interfaceName, valid, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Executa a validação de transporte usada pelo Eclipse antes da criação.
    async checkTransport(packageName, name) {
        const uri = `${INTERFACES_URL}/${encodeURIComponent(normalizeInterfaceName(name).toLowerCase())}`;
        const body = `<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><PGMID></PGMID><OBJECT></OBJECT><OBJECTNAME></OBJECTNAME><DEVCLASS>${xmlEscape(String(packageName ?? "").trim().toUpperCase())}</DEVCLASS><SUPER_PACKAGE></SUPER_PACKAGE><RECORD_CHANGES></RECORD_CHANGES><OPERATION>I</OPERATION><URI>${xmlEscape(uri)}</URI></DATA></asx:values></asx:abap>`;
        const response = await this.http.write("/sap/bc/adt/cts/transportchecks", {
            headers: { "Content-Type": "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData", Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData" }, body
        });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Cria a interface e grava o código fonte informado somente depois da criação.
    async create(input) {
        const name = normalizeInterfaceName(input.name);
        const packageName = String(input.packageName ?? "").trim().toUpperCase();
        if (!packageName) throw new Error("Package name is required.");
        const transport = String(input.transport ?? "").trim();
        if (!isLocalPackage(packageName) && !transport) throw new Error(`A Workbench transport request is required for interface '${name}'.`);
        const validation = await this.validateName({ ...input, name, packageName });
        if (!validation.valid) throw new Error(`SAP rejected the interface name '${name}'.`);
        await this.checkTransport(packageName, name);
        const response = await this.http.write(INTERFACES_URL, {
            query: transport ? { corrNr: transport } : undefined,
            headers: { "Content-Type": INTERFACE_CONTENT_TYPE, Accept: INTERFACE_CONTENT_TYPE },
            body: buildInterfaceXml({ ...input, name, packageName })
        });
        if (String(input.source ?? "").trim()) {
            await this.updateSource(name, String(input.source), transport);
        }
        return { name, packageName, transport: transport || undefined, status: response.status, durationMs: response.durationMs, location: response.headers.get("location"), raw: response.body };
    }

    // Bloqueia a interface para modificação e retorna o lock handle.
    async lock(name) {
        const interfaceName = normalizeInterfaceName(name);
        const response = await this.http.write(`${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}`, {
            query: { _action: "LOCK", accessMode: "MODIFY" },
            headers: { "X-sap-adt-sessiontype": "stateful", Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2" }
        });
        const lock = parseLockHandle(response.body);
        if (!lock.lockHandle) throw new Error(`SAP did not return a lock handle for class '${interfaceName}'.`);
        return { ...lock, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Desbloqueia a interface depois de uma modificação.
    async unlock(name, lockHandle) {
        const interfaceName = normalizeInterfaceName(name);
        return this.http.write(`${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}`, { query: { _action: "UNLOCK", lockHandle }, headers: { "X-sap-adt-sessiontype": "stateful" } });
    }

    // Atualiza os metadados principais da interface, inclusive a descrição.
    async updateMetadata(input) {
        const interfaceName = normalizeInterfaceName(input.name);
        const packageName = String(input.packageName ?? "").trim().toUpperCase();
        if (!packageName) throw new Error("Package name is required.");
        const request = String(input.transport ?? "").trim();
        if (!isLocalPackage(packageName) && !request) throw new Error(`A Workbench transport request is required to update interface '${interfaceName}'.`);

        const lock = await this.lock(interfaceName);
        let updateError;
        try {
            const token = await this.http.fetchCsrfToken();
            const query = { lockHandle: lock.lockHandle };
            if (request) query.corrNr = request;
            const response = await this.http.request(`${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}`, {
                method: "PUT",
                query,
                headers: {
                    "Content-Type": INTERFACE_CONTENT_TYPE,
                    Accept: INTERFACE_CONTENT_TYPE,
                    "X-CSRF-Token": token
                },
                body: buildInterfaceXml({ ...input, name: interfaceName, packageName })
            });
            return { name: interfaceName, packageName, status: response.status, durationMs: response.durationMs, raw: response.body };
        } catch (error) {
            updateError = error;
            throw error;
        } finally {
            try { await this.unlock(interfaceName, lock.lockHandle); } catch (unlockError) { if (!updateError) throw unlockError; }
        }
    }

    // Atualiza o código fonte usando PUT, após bloquear a interface no SAP.
    // Pacotes locais não enviam corrNr porque não precisam de request.
    async updateSource(name, source, transport, packageName) {
        const interfaceName = normalizeInterfaceName(name);
        const request = String(transport ?? "").trim();
        const packageValue = String(packageName ?? "").trim().toUpperCase();
        if (packageValue && !isLocalPackage(packageValue) && !request) throw new Error(`A Workbench transport request is required to update interface '${interfaceName}'.`);
        const lock = await this.lock(interfaceName);
        let updateError;
        try {
            const token = await this.http.fetchCsrfToken();
            const query = { lockHandle: lock.lockHandle };
            if (request) query.corrNr = request;
            const response = await this.http.request(`${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}/source/main`, {
                method: "PUT",
                query,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    Accept: "text/plain",
                    "X-CSRF-Token": token
                },
                body: String(source ?? "")
            });
            return { name: interfaceName, status: response.status, durationMs: response.durationMs, raw: response.body };
        } catch (error) {
            updateError = error;
            throw error;
        } finally {
            try { await this.unlock(interfaceName, lock.lockHandle); } catch (unlockError) { if (!updateError) throw unlockError; }
        }
    }

    // Atualiza metadados e código fonte usando as mesmas regras de transporte.
    async update(input) {
        const interfaceName = normalizeInterfaceName(input.name);
        const current = await this.get(interfaceName, "workingArea");
        const packageName = String(input.packageName ?? current.packageName ?? "").trim().toUpperCase();
        const metadata = await this.updateMetadata({
            ...current,
            ...input,
            name: interfaceName,
            packageName,
            language: input.language ?? current.language ?? "EN",
            responsible: input.responsible ?? current.responsible ?? "",
            final: input.final ?? current.final,
            visibility: input.visibility ?? current.visibility ?? "public"
        });
        const source = await this.updateSource(interfaceName, input.source ?? "", input.transport, packageName);
        return { name: interfaceName, packageName, metadata, source };
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

    // Consulta a ordem de transporte associada à interface.
    async getTransport(name) {
        const interfaceName = normalizeInterfaceName(name);
        const uri = `${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}/transports`;
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
                if (number) return { name: interfaceName, number, status: response.status, durationMs: response.durationMs, raw: response.body };
            } catch (error) {
                lastError = error;
            }
        }

        // O check de exclusão também retorna a request sugerida/associada pelo SAP.
        try {
            const check = await this.checkDelete(interfaceName);
            if (check.transport) return { name: interfaceName, number: check.transport, status: check.status, durationMs: check.durationMs, raw: check.raw };
        } catch (error) {
            lastError = error;
        }

        if (lastError) throw lastError;
        return { name: interfaceName, number: "" };
    }

    // Executa o check de exclusão usado pelo Eclipse e retorna o transporte sugerido pelo SAP.
    async checkDelete(name) {
        const interfaceName = normalizeInterfaceName(name);
        const uri = `${INTERFACES_URL}/${encodeURIComponent(interfaceName.toLowerCase())}`;
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<del:checkRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion">\n  <del:object adtcore:uri="${xmlEscape(uri)}"/>\n</del:checkRequest>`;
        const response = await this.http.write("/sap/bc/adt/deletion/check", { headers: { "Content-Type": "application/vnd.sap.adt.deletion.check.request.v1+xml", Accept: "application/vnd.sap.adt.deletion.check.response.v1+xml" }, body });
        const isDeletable = /isDeletable=["']true["']/i.test(response.body);
        const transport = this.parseTransportNumber(response.body);
        return { name: interfaceName, uri, isDeletable, transport, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Exclui a interface utilizando o endpoint de exclusão genérico do ADT.
    async delete(name, transport) {
        const check = await this.checkDelete(name);
        if (!check.isDeletable) throw new Error(`Interface '${check.name}' cannot be deleted because SAP reported dependencies or restrictions.`);
        const transportNumber = String(transport ?? check.transport ?? "").trim();
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<del:deletionRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion">\n  <del:object adtcore:uri="${xmlEscape(check.uri)}">${transportNumber ? `\n    <del:transportNumber>${xmlEscape(transportNumber)}</del:transportNumber>` : ""}\n  </del:object>\n</del:deletionRequest>`;
        const response = await this.http.write("/sap/bc/adt/deletion/delete", { headers: { "Content-Type": "application/vnd.sap.adt.deletion.request.v1+xml", Accept: "application/vnd.sap.adt.deletion.response.v1+xml" }, body });
        return { name: check.name, deleted: /isDeleted=["']true["']/i.test(response.body), transport: transportNumber || undefined, status: response.status, durationMs: response.durationMs, raw: response.body };
    }
}
