import { xmlEscape, parseLockHandle } from "./xml.js";

const REPORTS_URL = "/sap/bc/adt/programs/programs";
const REPORT_CONTENT_TYPE = "application/vnd.sap.adt.programs.programs.v2+xml";

function isLocalPackage(packageName) {
    return String(packageName ?? "").trim().toUpperCase().startsWith("$");
}

export function normalizeReportName(name) {
    const value = String(name ?? "").trim().toUpperCase();
    if (!value) throw new Error("Report name is required.");
    return value;
}

function wildcardMatch(value, pattern) {
    const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(String(value));
}

function parseSearch(xml) {
    const items = [];
    const seen = new Set();
    const pattern = /<(?:[\w.-]+:)?(?:objectReference|object|result|item)\b([^>]*)>/gi;
    for (const match of String(xml ?? "").matchAll(pattern)) {
        const attrs = match[1];
        const attr = name => attrs.match(new RegExp(`(?:[\\w.-]+:)?${name}=["']([^"']*)["']`, "i"))?.[1] ?? "";
        const type = attr("type").toUpperCase();
        const name = attr("name");
        if (!name || !/^PROG(?:\/P)?$/i.test(type)) continue;
        const key = name.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ name, type: type || "PROG/P", description: attr("description"), packageName: attr("packageName"), uri: attr("uri") });
    }
    return items;
}

function parseReport(xml) {
    const source = String(xml ?? "");
    const attr = name => source.match(new RegExp(`(?:[\\w.-]+:)?${name}=["']([^"']*)["']`, "i"))?.[1] ?? "";
    const packageMatch = source.match(/<(?:[\w.-]+:)?packageRef\b[^>]*(?:[\w.-]+:)?name=["']([^"']*)["']/i);
    return {
        name: attr("name"), type: attr("type") || "PROG/P", description: attr("description"),
        language: attr("masterLanguage") || attr("language"), responsible: attr("responsible"),
        packageName: packageMatch?.[1] ?? "", programType: attr("programType"),
        abapLanguageVersion: attr("abapLanguageVersion"), raw: source
    };
}

export function buildReportXml(input) {
    const name = normalizeReportName(input.name);
    const language = input.language ?? "EN";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<program:abapProgram xmlns:adtcore="http://www.sap.com/adt/core" xmlns:program="http://www.sap.com/adt/programs/programs" adtcore:description="${xmlEscape(input.description ?? "")}" adtcore:language="${xmlEscape(language)}" adtcore:name="${xmlEscape(name)}" adtcore:type="PROG/P" adtcore:masterLanguage="${xmlEscape(language)}" adtcore:responsible="${xmlEscape(input.responsible ?? "")}">\n  <adtcore:packageRef adtcore:name="${xmlEscape(String(input.packageName ?? "").trim().toUpperCase())}"/>\n</program:abapProgram>`;
}

export class ReportApi {
    constructor(http) { this.http = http; }

    async list({ query = "Z*", maxResults = 100 } = {}) {
        const searchQuery = String(query ?? "Z*").trim() || "*";
        const limit = Math.max(1, Math.min(500, Number(maxResults) || 100));
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", {
            query: { operation: "quickSearch", query: searchQuery, objectType: "PROG", maxResults: String(limit) },
            headers: { Accept: "application/xml" }
        });
        const items = parseSearch(response.body).filter(item => wildcardMatch(item.name, searchQuery));
        return { status: response.status, durationMs: response.durationMs, query: searchQuery, maxResults: limit, count: items.length, items, raw: response.body };
    }

    async get(name, version) {
        const reportName = normalizeReportName(name);
        const response = await this.http.request(`${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}`, {
            query: version ? { version } : undefined,
            headers: { Accept: "application/vnd.sap.adt.programs.programs.v2+xml, application/vnd.sap.adt.programs.programs+xml" }
        });
        return { ...parseReport(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    async getSource(name, version) {
        const reportName = normalizeReportName(name);
        const response = await this.http.request(`${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}/source/main`, {
            query: version ? { version } : undefined, headers: { Accept: "text/plain" }
        });
        return { name: reportName, source: response.body, status: response.status, durationMs: response.durationMs };
    }

    async validateName(input) {
        const name = normalizeReportName(input.name);
        const response = await this.http.write("/sap/bc/adt/programs/validation", {
            query: { objname: name, packagename: String(input.packageName ?? "").trim().toUpperCase(), description: String(input.description ?? ""), objtype: "PROG/P" },
            headers: { Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.programs.check" }
        });
        return { name, valid: /<CHECK_RESULT>\s*X\s*<\/CHECK_RESULT>/i.test(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    async checkTransport(packageName, name) {
        const reportName = normalizeReportName(name);
        const uri = `${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}`;
        const body = `<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><PGMID></PGMID><OBJECT></OBJECT><OBJECTNAME></OBJECTNAME><DEVCLASS>${xmlEscape(String(packageName ?? "").trim().toUpperCase())}</DEVCLASS><SUPER_PACKAGE></SUPER_PACKAGE><RECORD_CHANGES></RECORD_CHANGES><OPERATION>I</OPERATION><URI>${xmlEscape(uri)}</URI></DATA></asx:values></asx:abap>`;
        const response = await this.http.write("/sap/bc/adt/cts/transportchecks", {
            headers: { "Content-Type": "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData", Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData" }, body
        });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    async create(input) {
        const name = normalizeReportName(input.name);
        const packageName = String(input.packageName ?? "").trim().toUpperCase();
        const transport = String(input.transport ?? "").trim();
        if (!packageName) throw new Error("Package name is required.");
        if (!isLocalPackage(packageName) && !transport) throw new Error(`A Workbench transport request is required for report '${name}'.`);
        const validation = await this.validateName({ ...input, name, packageName });
        if (!validation.valid) throw new Error(`SAP rejected the report name '${name}'.`);
        await this.checkTransport(packageName, name);
        const response = await this.http.write(REPORTS_URL, {
            query: transport ? { corrNr: transport } : undefined,
            headers: { "Content-Type": REPORT_CONTENT_TYPE, Accept: REPORT_CONTENT_TYPE }, body: buildReportXml({ ...input, name, packageName })
        });
        if (String(input.source ?? "").trim()) await this.updateSource(name, String(input.source), transport, packageName);
        return { name, packageName, transport: transport || undefined, status: response.status, durationMs: response.durationMs, location: response.headers.get("location"), raw: response.body };
    }

    async lock(name) {
        const reportName = normalizeReportName(name);
        const response = await this.http.write(`${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}`, {
            query: { _action: "LOCK", accessMode: "MODIFY" }, headers: { "X-sap-adt-sessiontype": "stateful", Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2" }
        });
        const lock = parseLockHandle(response.body);
        if (!lock.lockHandle) throw new Error(`SAP did not return a lock handle for report '${reportName}'.`);
        return { ...lock, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    async unlock(name, lockHandle) {
        const reportName = normalizeReportName(name);
        return this.http.write(`${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}`, { query: { _action: "UNLOCK", lockHandle }, headers: { "X-sap-adt-sessiontype": "stateful" } });
    }

    async updateMetadata(input) {
        const name = normalizeReportName(input.name);
        const packageName = String(input.packageName ?? "").trim().toUpperCase();
        const transport = String(input.transport ?? "").trim();
        if (!packageName) throw new Error("Package name is required.");
        if (!isLocalPackage(packageName) && !transport) throw new Error(`A Workbench transport request is required to update report '${name}'.`);
        const lock = await this.lock(name); let updateError;
        try {
            const token = await this.http.fetchCsrfToken(); const query = { lockHandle: lock.lockHandle }; if (transport) query.corrNr = transport;
            const response = await this.http.request(`${REPORTS_URL}/${encodeURIComponent(name.toLowerCase())}`, { method: "PUT", query, headers: { "Content-Type": REPORT_CONTENT_TYPE, Accept: REPORT_CONTENT_TYPE, "X-CSRF-Token": token }, body: buildReportXml({ ...input, name, packageName }) });
            return { name, packageName, status: response.status, durationMs: response.durationMs, raw: response.body };
        } catch (error) { updateError = error; throw error; }
        finally { try { await this.unlock(name, lock.lockHandle); } catch (error) { if (!updateError) throw error; } }
    }

    async updateSource(name, source, transport, packageName) {
        const reportName = normalizeReportName(name);
        const request = String(transport ?? "").trim();
        const packageValue = String(packageName ?? "").trim().toUpperCase();
        if (packageValue && !isLocalPackage(packageValue) && !request) throw new Error(`A Workbench transport request is required to update report '${reportName}'.`);
        const lock = await this.lock(reportName); let updateError;
        try {
            const token = await this.http.fetchCsrfToken(); const query = { lockHandle: lock.lockHandle }; if (request) query.corrNr = request;
            const response = await this.http.request(`${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}/source/main`, { method: "PUT", query, headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "text/plain", "X-CSRF-Token": token }, body: String(source ?? "") });
            return { name: reportName, status: response.status, durationMs: response.durationMs, raw: response.body };
        } catch (error) { updateError = error; throw error; }
        finally { try { await this.unlock(reportName, lock.lockHandle); } catch (error) { if (!updateError) throw error; } }
    }

    async update(input) {
        const name = normalizeReportName(input.name); const current = await this.get(name, "workingArea");
        const packageName = String(input.packageName ?? current.packageName ?? "").trim().toUpperCase();
        const metadata = await this.updateMetadata({ ...current, ...input, name, packageName, language: input.language ?? current.language ?? "EN", responsible: input.responsible ?? current.responsible ?? "" });
        const source = await this.updateSource(name, input.source ?? "", input.transport, packageName);
        return { name, packageName, metadata, source };
    }

    parseTransportNumber(raw) {
        const source = String(raw ?? "");
        return [/<(?:[\w.-]+:)?TRKORR\b[^>]*>\s*([^<\s]+)\s*<\//i, /<(?:[\w.-]+:)?(?:transportNumber|requestNumber|request|trkorr)\b[^>]*>\s*([^<\s]+)\s*<\//i, /(?:trkorr|transportNumber|requestNumber|request)=['"]([^'"]+)['"]/i].map(pattern => source.match(pattern)?.[1] ?? "").find(Boolean)?.trim() ?? "";
    }

    async checkDelete(name) {
        const reportName = normalizeReportName(name); const uri = `${REPORTS_URL}/${encodeURIComponent(reportName.toLowerCase())}`;
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<del:checkRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion">\n  <del:object adtcore:uri="${xmlEscape(uri)}"/>\n</del:checkRequest>`;
        const response = await this.http.write("/sap/bc/adt/deletion/check", { headers: { "Content-Type": "application/vnd.sap.adt.deletion.check.request.v1+xml", Accept: "application/vnd.sap.adt.deletion.check.response.v1+xml" }, body });
        return { name: reportName, uri, isDeletable: /isDeletable=['"]true['"]/i.test(response.body), transport: this.parseTransportNumber(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    async getTransport(name) { const check = await this.checkDelete(name); return { name: check.name, number: check.transport, status: check.status, durationMs: check.durationMs, raw: check.raw }; }

    async delete(name, transport) {
        const check = await this.checkDelete(name); if (!check.isDeletable) throw new Error(`Report '${check.name}' cannot be deleted because SAP reported dependencies or restrictions.`);
        const transportNumber = String(transport ?? check.transport ?? "").trim();
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<del:deletionRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion">\n  <del:object adtcore:uri="${xmlEscape(check.uri)}">${transportNumber ? `\n    <del:transportNumber>${xmlEscape(transportNumber)}</del:transportNumber>\n  ` : ""}</del:object>\n</del:deletionRequest>`;
        const response = await this.http.write("/sap/bc/adt/deletion/delete", { headers: { "Content-Type": "application/vnd.sap.adt.deletion.request.v1+xml", Accept: "application/vnd.sap.adt.deletion.result.v1+xml" }, body });
        return { name: check.name, transport: transportNumber || undefined, deleted: /isDeleted=['"]true['"]/i.test(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }
}
