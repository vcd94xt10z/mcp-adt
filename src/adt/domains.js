import { xmlEscape, xmlAttr, parseLockHandle } from "./xml.js";

const DOMAINS_URL = "/sap/bc/adt/ddic/domains";
const DOMAIN_CONTENT_TYPE = "application/vnd.sap.adt.domains.v2+xml";
const DOMAIN_ACCEPT = "application/vnd.sap.adt.domains.v1+xml, application/vnd.sap.adt.domains.v2+xml";

function localPackage(name) { return String(name ?? "").trim().startsWith("$"); }
export function normalizeDomainName(name) { const value = String(name ?? "").trim().toUpperCase(); if (!value) throw new Error("Domain name is required."); return value; }
function text(xml, tag) { const m = String(xml ?? "").match(new RegExp(`<[^>]*:?${tag}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, "i")); return m ? m[1].replace(/<[^>]+>/g, "").trim().replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">") : ""; }
function bool(xml, tag) { return text(xml, tag).toLowerCase() === "true"; }
function wildcard(value, pattern) { const p = String(pattern).replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,"."); return new RegExp(`^${p}$`,"i").test(String(value)); }

function parseDomain(xml) {
    const source = String(xml ?? "");
    const fixValues = [...source.matchAll(/<doma:fixValue\b[^>]*>\s*<doma:low>([\s\S]*?)<\/doma:low>(?:\s*<doma:high>([\s\S]*?)<\/doma:high>)?\s*<doma:text>([\s\S]*?)<\/doma:text>\s*<\/doma:fixValue>/gi)].map(m => ({ low: m[1].trim(), high: (m[2] ?? "").trim(), text: m[3].trim() }));
    const valueTableMatch = source.match(/<doma:valueTableRef\b[^>]*(?:adtcore:)?name=["']([^"']*)/i);
    return {
        name: xmlAttr(source, "name"), type: xmlAttr(source, "type"), description: xmlAttr(source, "description"), language: xmlAttr(source, "language") || xmlAttr(source, "masterLanguage"), responsible: xmlAttr(source, "responsible"), version: xmlAttr(source, "version"), abapLanguageVersion: xmlAttr(source, "abapLanguageVersion"), masterLanguage: xmlAttr(source, "masterLanguage"), masterSystem: xmlAttr(source, "masterSystem"), changedAt: xmlAttr(source, "changedAt"), changedBy: xmlAttr(source, "changedBy"), createdAt: xmlAttr(source, "createdAt"), createdBy: xmlAttr(source, "createdBy"),
        packageName: xmlAttr(source.match(/<adtcore:packageRef\b[^>]*>/i)?.[0] ?? "", "name"),
        datatype: text(source, "datatype"), length: Number(text(source, "length") || 0), decimals: Number(text(source, "decimals") || 0), outputLength: Number((source.match(/<doma:outputInformation>[\s\S]*?<doma:length>([^<]*)/i)?.[1] ?? "0")), style: text(source, "style"), conversionExit: text(source, "conversionExit"), signExists: bool(source, "signExists"), lowercase: bool(source, "lowercase"), ampmFormat: bool(source, "ampmFormat"), valueTable: valueTableMatch?.[1] ?? "", appendExists: bool(source, "appendExists"), fixValues, raw: source
    };
}

function buildDomainXml(input, current = {}) {
    const name = normalizeDomainName(input.name ?? current.name);
    const valueTable = String(input.valueTable ?? "").trim().toUpperCase();
    const fixValues = Array.isArray(input.fixValues) ? input.fixValues : (current.fixValues ?? []);
    const fixXml = fixValues.length ? `<doma:fixValues>${fixValues.map(item => `<doma:fixValue><doma:low>${xmlEscape(item.low ?? "")}</doma:low>${String(item.high ?? "") ? `<doma:high>${xmlEscape(item.high)}</doma:high>` : ""}<doma:text>${xmlEscape(item.text ?? "")}</doma:text></doma:fixValue>`).join("")}</doma:fixValues>` : "<doma:fixValues/>";
    const attr = (key, value) => `${key}="${xmlEscape(value ?? "")}"`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<doma:domain xmlns:adtcore="http://www.sap.com/adt/core" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:doma="http://www.sap.com/dictionary/domain" ${attr("adtcore:changedAt", current.changedAt)} ${attr("adtcore:changedBy", current.changedBy)} ${attr("adtcore:createdAt", current.createdAt)} ${attr("adtcore:createdBy", current.createdBy)} ${attr("adtcore:description", input.description ?? current.description)} ${attr("adtcore:language", input.language ?? current.language ?? "EN")} ${attr("adtcore:name", name)} adtcore:type="DOMA/DD" ${attr("adtcore:version", current.version || "new")} ${attr("adtcore:abapLanguageVersion", current.abapLanguageVersion || "standard")} ${attr("adtcore:masterLanguage", current.masterLanguage || input.language || "EN")} ${attr("adtcore:masterSystem", current.masterSystem)} ${attr("adtcore:responsible", input.responsible ?? current.responsible)}>
  <atom:link href="versions" rel="http://www.sap.com/adt/relations/versions" title="Historic versions"/>
  <adtcore:packageRef adtcore:name="${xmlEscape(String(input.packageName ?? current.packageName ?? "").trim().toUpperCase())}"/>
  <doma:content><doma:typeInformation><doma:datatype>${xmlEscape(input.datatype ?? current.datatype ?? "")}</doma:datatype><doma:length>${Number(input.length ?? current.length ?? 0)}</doma:length><doma:decimals>${Number(input.decimals ?? current.decimals ?? 0)}</doma:decimals></doma:typeInformation><doma:outputInformation><doma:length>${Number(input.outputLength ?? current.outputLength ?? input.length ?? current.length ?? 0)}</doma:length><doma:style>${xmlEscape(input.style ?? current.style ?? "")}</doma:style><doma:conversionExit>${xmlEscape(input.conversionExit ?? current.conversionExit ?? "")}</doma:conversionExit><doma:signExists>${Boolean(input.signExists ?? current.signExists)}</doma:signExists><doma:lowercase>${Boolean(input.lowercase ?? current.lowercase)}</doma:lowercase><doma:ampmFormat>${Boolean(input.ampmFormat ?? current.ampmFormat)}</doma:ampmFormat></doma:outputInformation><doma:valueInformation><doma:valueTableRef${valueTable ? ` adtcore:name="${xmlEscape(valueTable)}"` : ""}/><doma:appendExists>${Boolean(input.appendExists ?? current.appendExists)}</doma:appendExists>${fixXml}</doma:valueInformation></doma:content>
</doma:domain>`;
}

export class DomainApi {
    constructor(http) { this.http = http; }
    async list({ query = "Z*", maxResults = 100 } = {}) {
        const pattern = String(query ?? "Z*").trim() || "*";
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", { query: { operation:"quickSearch", query:pattern, objectType:"DOMA", maxResults:String(Math.min(500, Math.max(1, Number(maxResults)||100))) }, headers:{Accept:"application/xml"} });
        const items=[]; const seen=new Set();
        for (const m of String(response.body).matchAll(/<(?:[\w.-]+:)?objectReference\b([^>]*)>/gi)) { const attrs=m[1]; const get=n=>attrs.match(new RegExp(`(?:[\\w.-]+:)?${n}=["']([^"']*)`,"i"))?.[1]??""; const type=get("type"); const name=get("name"); if (name && /^DOMA(?:\/DD)?$/i.test(type) && !seen.has(name.toUpperCase()) && wildcard(name,pattern)) { seen.add(name.toUpperCase()); items.push({name,type,description:get("description"),packageName:get("packageName"),uri:get("uri")}); } }
        return { status:response.status,durationMs:response.durationMs,items,count:items.length,raw:response.body };
    }
    async get(name, version) { const domainName=normalizeDomainName(name); const response=await this.http.request(`${DOMAINS_URL}/${encodeURIComponent(domainName.toLowerCase())}`,{query:version?{version}:undefined,headers:{Accept:DOMAIN_ACCEPT,"Cache-Control":"no-cache"}}); return {...parseDomain(response.body),status:response.status,durationMs:response.durationMs}; }
    async validateName(input) { const name=normalizeDomainName(input.name); const response=await this.http.write(`${DOMAINS_URL}/validation`,{query:{objtype:"domadd",objname:name,description:String(input.description??"")},headers:{Accept:"application/vnd.sap.as+xml"}}); return {name,valid:/<CHECK_RESULT>\s*X\s*<\/CHECK_RESULT>/i.test(response.body),raw:response.body}; }
    async checkTransport(packageName,name) { const uri=`${DOMAINS_URL}/${encodeURIComponent(normalizeDomainName(name).toLowerCase())}`; const body=`<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><PGMID></PGMID><OBJECT></OBJECT><OBJECTNAME></OBJECTNAME><DEVCLASS>${xmlEscape(packageName)}</DEVCLASS><SUPER_PACKAGE></SUPER_PACKAGE><RECORD_CHANGES></RECORD_CHANGES><OPERATION>I</OPERATION><URI>${xmlEscape(uri)}</URI></DATA></asx:values></asx:abap>`; return this.http.write("/sap/bc/adt/cts/transportchecks",{headers:{"Content-Type":"application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData",Accept:"application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData"},body}); }
    // Obtém o identificador do sistema SAP para preencher masterSystem como o Eclipse.
    async getMasterSystem(packageName) {
        if (String(packageName).startsWith('$')) return '';
        const uri = `/sap/bc/adt/packages/${encodeURIComponent(String(packageName).toLowerCase())}`;
        try {
            const response = await this.http.request('/sap/bc/adt/repository/informationsystem/objectproperties/values', {
                query: { uri },
                headers: { Accept: 'application/vnd.sap.adt.repository.objproperties.result.v1+xml' }
            });
            const match = String(response.body).match(/<[^>]*property\b[^>]*facet=["']SYSTEM["'][^>]*\bname=["']([^"']+)/i);
            return match?.[1]?.trim() || '';
        } catch {
            return '';
        }
    }

    // Cria primeiro o domínio com os metadados mínimos e depois grava as propriedades DDIC.
    async create(input) {
        const name = normalizeDomainName(input.name);
        const packageName = String(input.packageName ?? '').trim().toUpperCase();
        if (!packageName) throw new Error('Package name is required.');
        const transport = String(input.transport ?? '').trim();
        if (!localPackage(packageName) && !transport) throw new Error(`A Workbench transport request is required for domain '${name}'.`);

        const validation = await this.validateName({ ...input, name });
        if (!validation.valid) throw new Error(`SAP rejected the domain name '${name}'.`);
        await this.checkTransport(packageName, name);

        const language = String(input.language ?? 'EN').trim().toUpperCase() || 'EN';
        const responsible = String(input.responsible ?? this.http.config?.user ?? '').trim();
        const masterSystem = String(input.masterSystem ?? '').trim() || await this.getMasterSystem(packageName);
        const attributes = [
            `adtcore:description="${xmlEscape(input.description ?? '')}"`,
            `adtcore:language="${xmlEscape(language)}"`,
            `adtcore:name="${xmlEscape(name)}"`,
            'adtcore:type="DOMA/DD"',
            `adtcore:masterLanguage="${xmlEscape(language)}"`,
            ...(masterSystem ? [`adtcore:masterSystem="${xmlEscape(masterSystem)}"`] : []),
            ...(responsible ? [`adtcore:responsible="${xmlEscape(responsible)}"`] : [])
        ].join(' ');
        const initial = `<?xml version="1.0" encoding="UTF-8"?>\n<doma:domain xmlns:adtcore="http://www.sap.com/adt/core" xmlns:doma="http://www.sap.com/dictionary/domain" ${attributes}>\n  <adtcore:packageRef adtcore:name="${xmlEscape(packageName)}"/>\n</doma:domain>`;

        const response = await this.http.write(DOMAINS_URL, {
            query: transport ? { corrNr: transport } : undefined,
            headers: { 'Content-Type': DOMAIN_CONTENT_TYPE, Accept: DOMAIN_ACCEPT },
            body: initial
        });

        if (input.datatype) await this.update({ ...input, name, packageName, language, responsible });
        return { name, packageName, masterSystem, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Bloqueia o domínio para alteração mantendo a mesma sessão ADT até o UNLOCK.
    async lock(name) {
        const domainName = normalizeDomainName(name);
        const response = await this.http.write(`${DOMAINS_URL}/${encodeURIComponent(domainName.toLowerCase())}`, {
            query: { _action: "LOCK", accessMode: "MODIFY" },
            headers: {
                "X-sap-adt-sessiontype": "stateful",
                Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.8, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2;q=0.9"
            }
        });
        const lock = parseLockHandle(response.body);
        if (!lock.lockHandle) throw new Error(`SAP did not return a lock handle for domain '${domainName}'.`);
        return { ...lock, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Desbloqueia o domínio usando a mesma sessão utilizada para o LOCK.
    async unlock(name, lockHandle) {
        return this.http.write(`${DOMAINS_URL}/${encodeURIComponent(normalizeDomainName(name).toLowerCase())}`, {
            query: { _action: "UNLOCK", lockHandle },
            headers: { "X-sap-adt-sessiontype": "stateful" }
        });
    }

    // Atualiza o domínio depois de obter o lock handle válido para a sessão ADT atual.
    async update(input) {
        const name = normalizeDomainName(input.name);
        const current = await this.get(name, "inactive").catch(() => this.get(name, "workingArea"));
        const packageName = String(input.packageName ?? current.packageName ?? "").trim().toUpperCase();
        const transport = String(input.transport ?? "").trim();

        if (!localPackage(packageName) && !transport) {
            throw new Error(`A Workbench transport request is required to update domain '${name}'.`);
        }

        // Obtém o token antes do LOCK para não executar uma chamada adicional entre LOCK e PUT.
        const token = await this.http.fetchCsrfToken();
        const lock = await this.lock(name);
        let failure;

        try {
            const query = { lockHandle: lock.lockHandle };
            if (transport) query.corrNr = transport;

            const response = await this.http.request(`${DOMAINS_URL}/${encodeURIComponent(name.toLowerCase())}`, {
                method: "PUT",
                query,
                headers: {
                    "Content-Type": `${DOMAIN_CONTENT_TYPE}; charset=utf-8`,
                    Accept: DOMAIN_ACCEPT,
                    "X-CSRF-Token": token,
                    "X-sap-adt-sessiontype": "stateful"
                },
                body: buildDomainXml({ ...input, name, packageName }, current)
            });

            return { name, status: response.status, durationMs: response.durationMs, raw: response.body };
        } catch (error) {
            failure = error;
            throw error;
        } finally {
            try {
                await this.unlock(name, lock.lockHandle);
            } catch (unlockError) {
                if (!failure) throw unlockError;
            }
        }
    }
    // Extrai o número da request de respostas XML do ADT.
    parseTransportNumber(raw) {
        const source = String(raw ?? "");
        const patterns = [
            /<(?:[\w.-]+:)?TRKORR\b[^>]*>\s*([^<\s]+)\s*<\//i,
            /<(?:[\w.-]+:)?(?:transportNumber|requestNumber|request)\b[^>]*>\s*([^<\s]+)\s*<\//i,
            /(?:[\w.-]+:)?(?:trkorr|transportNumber|requestNumber|request)=['"]([^'"]+)['"]/i
        ];
        return patterns.map(pattern => source.match(pattern)?.[1] ?? "").find(Boolean)?.trim() ?? "";
    }

    // Consulta a request Workbench associada ao domínio. Pacotes locais não possuem request.
    async getTransport(name, packageName = "") {
        const domainName = normalizeDomainName(name);
        if (localPackage(packageName)) return { name: domainName, number: "" };

        const uri = `${DOMAINS_URL}/${encodeURIComponent(domainName.toLowerCase())}/transports`;
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
                if (number) return { name: domainName, number, status: response.status, durationMs: response.durationMs, raw: response.body };
            } catch (error) {
                lastError = error;
            }
        }

        try {
            const check = await this.checkDelete(domainName);
            if (check.transport) return { name: domainName, number: check.transport, status: check.status, durationMs: check.durationMs, raw: check.raw };
        } catch (error) {
            lastError = error;
        }

        if (lastError) throw lastError;
        return { name: domainName, number: "" };
    }

    async checkDelete(name) { const domainName=normalizeDomainName(name); const uri=`${DOMAINS_URL}/${encodeURIComponent(domainName.toLowerCase())}`; const body=`<?xml version="1.0" encoding="UTF-8"?><del:checkRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion"><del:object adtcore:uri="${xmlEscape(uri)}"/></del:checkRequest>`; const response=await this.http.write("/sap/bc/adt/deletion/check",{headers:{"Content-Type":"application/vnd.sap.adt.deletion.check.request.v1+xml",Accept:"application/vnd.sap.adt.deletion.check.response.v1+xml"},body}); const transport=response.body.match(/<del:trkorr>\s*([^<]+)/i)?.[1]?.trim()??""; return {name:domainName,uri,isDeletable:/isDeletable=["']true/i.test(response.body),transport,raw:response.body}; }
    async delete(name,transport) { const check=await this.checkDelete(name); if(!check.isDeletable) throw new Error(`Domain '${check.name}' cannot be deleted.`); const request=String(transport??check.transport??"").trim(); const body=`<?xml version="1.0" encoding="UTF-8"?><del:deletionRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion"><del:object adtcore:uri="${xmlEscape(check.uri)}">${request?`<del:transportNumber>${xmlEscape(request)}</del:transportNumber>`:""}</del:object></del:deletionRequest>`; const response=await this.http.write("/sap/bc/adt/deletion/delete",{headers:{"Content-Type":"application/vnd.sap.adt.deletion.request.v1+xml",Accept:"application/vnd.sap.adt.deletion.response.v1+xml"},body}); return {name:check.name,deleted:/isDeleted=["']true/i.test(response.body),transport:request||undefined,raw:response.body}; }
}
