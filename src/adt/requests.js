import { parseTransportRequest, xmlEscape } from "./xml.js";
const COLLECTION_URL = "/sap/bc/adt/cts/transportrequests";
function buildCreateTransportXml(input) {
    const description = String(input.description ?? "").trim();
    if (!description) throw new Error("Request description is required.");
    const owner = String(input.owner ?? "").trim().toUpperCase();
    if (!owner) throw new Error("SAP user is required to create a request.");
    const category = String(input.category ?? "K").trim().toUpperCase() || "K";
    if (!['K', 'W'].includes(category)) throw new Error("Request category must be K or W.");
    const target = String(input.target ?? "").trim();
    return `<?xml version="1.0" encoding="UTF-8"?>
<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" tm:useraction="newrequest">
  <tm:request tm:type="${category}" tm:desc="${xmlEscape(description).replace(/\"/g, '&quot;')}" tm:target="${xmlEscape(target).replace(/\"/g, '&quot;')}" tm:cts_project="">
    <tm:task tm:owner="${xmlEscape(owner).replace(/\"/g, '&quot;')}"/>
  </tm:request>
</tm:root>`;
}

export class RequestApi {
    constructor(http) { this.http = http; }
    async list({ user = "", status = "modifiable", targets = true } = {}) {
        const owner = String(user ?? "").trim().toUpperCase();
        let configUri = "";
        try {
            const configResponse = await this.http.request(`${COLLECTION_URL}/searchconfiguration/configurations`, { headers: { Accept: "application/xml, text/xml, */*" } });
            configUri = extractSearchConfigurationUri(configResponse.body);
        } catch {}
        const query = configUri
            ? { configUri, ...(targets ? { targets: "true" } : {}) }
            : { ...(owner ? { user: owner } : {}), ...(status ? { status } : {}), ...(targets ? { targets: "true" } : {}) };
        const response = await this.http.request(COLLECTION_URL, { query, headers: { Accept: "application/vnd.sap.adt.transportorganizertree.v1+xml, application/xml" } });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }
    async listTargets() {
        const response = await this.http.request(`${COLLECTION_URL}/valuehelp/target`, {
            query: { name: "*" },
            headers: {
                Accept: "application/vnd.sap.adt.nameditems.v1+xml, application/xml"
            }
        });
        const items = parseTransportTargets(response.body);
        return { status: response.status, durationMs: response.durationMs, count: items.length, items, raw: response.body };
    }
    async listModifiableWorkbench(user) {
        const owner = String(user ?? '').trim().toUpperCase();
        const listed = await this.list({ user: owner, status: 'modifiable', targets: true });
        let items = parseTransportRequestTree(listed.raw);
        if (owner) {
            const withOwner = items.filter(item => item.owner && item.owner.toUpperCase() === owner);
            if (withOwner.length) items = withOwner;
        }
        items = items.filter(item => item.workbench && item.modifiable);
        return { status: listed.status, durationMs: listed.durationMs, user: owner, count: items.length, items, raw: listed.raw };
    }
    async get(number) {
        const response = await this.http.request(`${COLLECTION_URL}/${encodeURIComponent(number)}`, { headers: { Accept: "application/xml" } });
        return { ...parseTransportRequest(response.body), status: response.status, durationMs: response.durationMs, raw: response.body };
    }
    async create(input) {
        const response = await this.http.write(COLLECTION_URL, {
            headers: {
                "Content-Type": "application/vnd.sap.adt.transportorganizer.v1+xml",
                Accept: "application/vnd.sap.adt.transportorganizer.v1+xml"
            },
            body: buildCreateTransportXml(input)
        });
        const parsed = parseTransportRequest(response.body);
        const location = response.headers.get("location");
        const rawNumber = response.body.trim();
        const number = parsed.number || response.headers.get("x-sap-request-number") || extractRequestNumber(location) || extractRequestNumber(rawNumber) || (rawNumber.match(/^[A-Z0-9]+$/i)?.[0] ?? "");
        return { ...parsed, number, category: String(input.category ?? "K").toUpperCase(), target: String(input.target ?? "").trim(), status: response.status, durationMs: response.durationMs, location, raw: response.body };
    }
    async update(number, description, target) {
        const requestNumber = String(number ?? "").trim().toUpperCase();
        const requestDescription = String(description ?? "").trim();
        if (!requestNumber) throw new Error("Transport request number is required.");
        if (!requestDescription) throw new Error("Request description is required.");
        const token = await this.http.fetchCsrfToken();
        const descriptionBody = `<?xml version="1.0" encoding="UTF-8"?>
<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" tm:number="${xmlEscape(requestNumber)}" tm:useraction="change">
  <tm:request tm:number="${xmlEscape(requestNumber)}" tm:desc="${xmlEscape(requestDescription)}"/>
</tm:root>`;
        const descriptionResponse = await this.http.request(`${COLLECTION_URL}/${encodeURIComponent(requestNumber)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/vnd.sap.adt.transportorganizer.v1+xml",
                Accept: "application/vnd.sap.adt.transportorganizer.v1+xml",
                "X-CSRF-Token": token
            },
            body: descriptionBody
        });
        let targetResponse = null;
        if (target !== undefined) {
            const requestTarget = String(target ?? "").trim();
            const targetBody = `<?xml version="1.0" encoding="ASCII"?>
<tm:root tm:useraction="changetarget" tm:number="${xmlEscape(requestNumber)}" xmlns:tm="http://www.sap.com/cts/adt/tm">
  <tm:request tm:number="${xmlEscape(requestNumber)}" tm:target="${xmlEscape(requestTarget)}"/>
</tm:root>`;
            targetResponse = await this.http.request(`${COLLECTION_URL}/${encodeURIComponent(requestNumber)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "text/plain",
                    Accept: "application/vnd.sap.adt.transportorganizer.v1+xml",
                    "X-CSRF-Token": token
                },
                body: targetBody
            });
        }
        return {
            status: targetResponse?.status ?? descriptionResponse.status,
            descriptionStatus: descriptionResponse.status,
            targetStatus: targetResponse?.status ?? null,
            durationMs: targetResponse?.durationMs ?? descriptionResponse.durationMs,
            raw: targetResponse?.body ?? descriptionResponse.body
        };
    }
    async delete(number) {
        const token = await this.http.fetchCsrfToken();
        const response = await this.http.request(`${COLLECTION_URL}/${encodeURIComponent(number)}`, {
            method: "DELETE",
            omitHeaders: ["Accept"],
            headers: {
                "X-CSRF-Token": token
            }
        });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }
}
function extractRequestNumber(location) {
    if (!location) return "";
    const match = location.match(/([A-Z][A-Z0-9]{3,}\d{6,})/i);
    return match?.[1] ?? "";
}
function extractSearchConfigurationUri(xml) {
    const matches = [...String(xml ?? '').matchAll(/(?:href|uri|configUri)=["']([^"']+)["']/gi)];
    for (const match of matches) if (/searchconfiguration|transportrequests/i.test(match[1])) return match[1];
    return '';
}
export function parseTransportRequestTree(xml) {
    const source = String(xml ?? '');
    const tokenPattern = /<\/?([A-Za-z_][\w:.-]*)([^>]*)>/g;
    const stack = [];
    const items = [];
    for (const match of source.matchAll(tokenPattern)) {
        const full = match[0];
        const name = match[1];
        const lower = name.split(':').pop().toLowerCase();
        if (full.startsWith('</')) {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].name === lower) { stack.length = i; break; }
            }
            continue;
        }
        const attrs = parseAttributes(match[2] ?? '');
        const context = stack.map(x => x.name);
        const targetContext = [...stack].reverse().find(x => x.name === 'target');
        if (lower === 'request') {
            const number = firstAttr(attrs, ['number', 'trkorr', 'trnumber', 'id']);
            if (number) {
                const description = firstAttr(attrs, ['description', 'desc', 'as4text', 'request_text', 'requesttext', 'text']);
                const owner = firstAttr(attrs, ['owner', 'as4user', 'user', 'uname']);
                const status = firstAttr(attrs, ['status', 'trstatus']);
                const pkg = firstAttr(attrs, ['package', 'packagename', 'devclass']);
                const target = firstAttr(attrs, ['target']) || firstAttr(targetContext?.attrs ?? {}, ['name', 'target', 'id', 'code']);
                const workbench = context.includes('workbench');
                const customizing = context.includes('customizing');
                const modifiable = context.includes('modifiable') || /^(d|modifiable)$/i.test(status);
                items.push({ number, description, owner, status: status || (modifiable ? 'modifiable' : ''), package: pkg, packages: pkg ? [pkg] : [], target, category: workbench ? 'K' : customizing ? 'W' : '', workbench, customizing, modifiable });
            }
        }

        if (lower === 'abap_object') {
            const pgmid = firstAttr(attrs, ['pgmid', 'programid']);
            const type = firstAttr(attrs, ['type', 'object']);
            const wbtype = firstAttr(attrs, ['wbtype', 'objecttype']);
            const nameValue = firstAttr(attrs, ['name', 'obj_name', 'objectname']);
            const isPackage = pgmid.toUpperCase() === 'R3TR'
                && (type.toUpperCase() === 'DEVC' || wbtype.toUpperCase().startsWith('DEVC/'));
            const requestContext = [...stack].reverse().find(node => node.name === 'request');
            const requestNumber = firstAttr(requestContext?.attrs ?? {}, ['number', 'trkorr', 'trnumber', 'id']);
            if (isPackage && nameValue && requestNumber) {
                const request = items.find(item => item.number === requestNumber);
                if (request) {
                    request.packages ??= [];
                    if (!request.packages.some(value => value.toUpperCase() === nameValue.toUpperCase())) request.packages.push(nameValue);
                }
            }
        }
        if (!/\/\s*>$/.test(full)) stack.push({ name: lower, attrs });
    }
    const seen = new Set();
    return items.filter(item => { if (seen.has(item.number)) return false; seen.add(item.number); return true; });
}
export function parseTransportTargets(xml) {
    const source = String(xml ?? '');
    const namedItems = [];
    const namedItemPattern = /<([A-Za-z_][\w:.-]*:)?namedItem\b[^>]*>([\s\S]*?)<\/([A-Za-z_][\w:.-]*:)?namedItem>/gi;
    for (const match of source.matchAll(namedItemPattern)) {
        const block = match[2];
        const name = extractElementText(block, 'name');
        const description = extractElementText(block, 'description') || name;
        if (name && isTransportTargetCode(name)) namedItems.push({ code: name, description });
    }
    if (namedItems.length) {
        const seen = new Set();
        return namedItems.filter(item => {
            const key = item.code.toUpperCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    const tokenPattern = /<\/?([A-Za-z_][\w:.-]*)([^>]*)>/g;
    const stack = [];
    const items = [];
    for (const match of source.matchAll(tokenPattern)) {
        const full = match[0];
        const name = match[1];
        const lower = name.split(':').pop().toLowerCase();
        if (full.startsWith('</')) {
            const closingIndex = [...stack].reverse().findIndex(item => item.name === lower);
            if (closingIndex >= 0) {
                const index = stack.length - 1 - closingIndex;
                const node = stack[index];
                stack.length = index;
                if (node.name === 'target') {
                    const code = resolveTargetCode(node);
                    const description = firstAttr(node.attrs, ['description', 'desc', 'text', 'title', 'label']) || code;
                    if (code) items.push({ code, description });
                }
            }
            continue;
        }
        const attrs = parseAttributes(match[2] ?? '');
        if (lower === 'target') {
            const code = resolveTargetCode({ attrs, text: '' });
            if (code) {
                const description = firstAttr(attrs, ['description', 'desc', 'text', 'title', 'label']) || code;
                items.push({ code, description });
            }
        }
        if (lower === 'request') {
            const code = firstAttr(attrs, ['target']);
            if (code && isTransportTargetCode(code)) {
                const description = firstAttr(attrs, ['target_desc', 'targetdescription']) || code;
                items.push({ code, description });
            }
        }
        if (!/\/\s*>$/.test(full)) stack.push({ name: lower, attrs, text: '' });
    }
    const seen = new Set();
    return items.filter(item => {
        const key = item.code.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function extractElementText(xml, localName) {
    const escaped = String(localName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<([A-Za-z_][\\w:.-]*:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/([A-Za-z_][\\w:.-]*:)?${escaped}>`, "i");
    const match = String(xml ?? '').match(pattern);
    return match ? decodeXml(match[2].replace(/<[^>]+>/g, '').trim()) : '';
}

function resolveTargetCode(node) {
    const attrs = node.attrs ?? {};
    const direct = firstAttr(attrs, ['name', 'target', 'id', 'code', 'value', 'system', 'systemid', 'targetsystem', 'key']);
    if (direct && isTransportTargetCode(direct)) return direct;
    const values = Object.values(attrs).map(value => String(value ?? '').trim()).filter(Boolean);
    const candidate = values.find(isTransportTargetCode);
    if (candidate) return candidate;
    const text = String(node.text ?? '').trim();
    return isTransportTargetCode(text) ? text : '';
}
function isTransportTargetCode(value) {
    return /^[A-Z][A-Z0-9_]{1,9}(?:\.[0-9]{3})?$/.test(String(value ?? '').trim().toUpperCase());
}
function parseAttributes(text) {
    const attrs = {};
    for (const match of String(text ?? '').matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*["']([^"']*)["']/g)) attrs[match[1].split(':').pop().toLowerCase()] = decodeXml(match[2]);
    return attrs;
}
function firstAttr(attrs, names) { for (const name of names) { const value = attrs[name.toLowerCase()]; if (value) return value.trim(); } return ''; }
function decodeXml(value) { return String(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
