import { xmlEscape, xmlAttr, parseLockHandle } from "./xml.js";

const DATA_ELEMENTS_URL = "/sap/bc/adt/ddic/dataelements";
const DATA_ELEMENT_CONTENT_TYPE = "application/vnd.sap.adt.dataelements.v2+xml";
const DATA_ELEMENT_ACCEPT = "application/vnd.sap.adt.dataelements.v1+xml, application/vnd.sap.adt.dataelements.v2+xml";

function localPackage(name) { return String(name ?? "").trim().startsWith("$"); }
export function normalizeDataElementName(name) { const value = String(name ?? "").trim().toUpperCase(); if (!value) throw new Error("DataElement name is required."); return value; }
function text(xml, tag) { const m = String(xml ?? "").match(new RegExp(`<[^>]*:?${tag}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, "i")); return m ? m[1].replace(/<[^>]+>/g, "").trim().replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">") : ""; }
function bool(xml, tag) { return text(xml, tag).toLowerCase() === "true"; }
function wildcard(value, pattern) { const p = String(pattern).replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,"."); return new RegExp(`^${p}$`,"i").test(String(value)); }

function parseDataElement(xml) {
    const source = String(xml ?? "");
    const get = tag => text(source, tag);
    return {
        name: xmlAttr(source,"name"), type: xmlAttr(source,"type"), description: xmlAttr(source,"description"), language: xmlAttr(source,"language") || xmlAttr(source,"masterLanguage"), responsible: xmlAttr(source,"responsible"), version: xmlAttr(source,"version"), abapLanguageVersion: xmlAttr(source,"abapLanguageVersion"), masterLanguage: xmlAttr(source,"masterLanguage"), masterSystem: xmlAttr(source,"masterSystem"), changedAt: xmlAttr(source,"changedAt"), changedBy: xmlAttr(source,"changedBy"), createdAt: xmlAttr(source,"createdAt"), createdBy: xmlAttr(source,"createdBy"),
        packageName: xmlAttr(source.match(/<adtcore:packageRef\b[^>]*>/i)?.[0] ?? "", "name"),
        typeKind: get("typeKind"), typeName: get("typeName"), dataType: get("dataType"), dataTypeLength: Number(get("dataTypeLength") || 0), dataTypeDecimals: Number(get("dataTypeDecimals") || 0),
        shortFieldLabel:get("shortFieldLabel"), shortFieldLength:Number(get("shortFieldLength")||0), shortFieldMaxLength:Number(get("shortFieldMaxLength")||0),
        mediumFieldLabel:get("mediumFieldLabel"), mediumFieldLength:Number(get("mediumFieldLength")||0), mediumFieldMaxLength:Number(get("mediumFieldMaxLength")||0),
        longFieldLabel:get("longFieldLabel"), longFieldLength:Number(get("longFieldLength")||0), longFieldMaxLength:Number(get("longFieldMaxLength")||0),
        headingFieldLabel:get("headingFieldLabel"), headingFieldLength:Number(get("headingFieldLength")||0), headingFieldMaxLength:Number(get("headingFieldMaxLength")||0), raw:source
    };
}
function buildDataElementXml(input, current = {}) {
    const name = normalizeDataElementName(input.name ?? current.name);
    const value = (key, fallback = "") => input[key] ?? current[key] ?? fallback;
    const number = (key, fallback = 0) => Number(value(key, fallback) || 0);
    const esc = value => xmlEscape(value ?? "");
    const typeKind = String(value("typeKind", "domain")).toLowerCase();
    const typeName = typeKind === "predefined" ? "" : value("typeName");
    const shortLength = number("shortFieldLength", 10);
    const mediumLength = number("mediumFieldLength", 20);
    const longLength = number("longFieldLength", 40);
    const headingLength = number("headingFieldLength", 55);

    return `<?xml version="1.0" encoding="UTF-8"?>
<blue:wbobj xmlns:adtcore="http://www.sap.com/adt/core" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel" xmlns:dtel="http://www.sap.com/adt/dictionary/dataelements" adtcore:changedAt="${esc(current.changedAt)}" adtcore:changedBy="${esc(current.changedBy)}" adtcore:createdAt="${esc(current.createdAt)}" adtcore:createdBy="${esc(current.createdBy)}" adtcore:description="${esc(value("description"))}" adtcore:language="${esc(value("language", "EN"))}" adtcore:name="${esc(name)}" adtcore:type="DTEL/DE" adtcore:version="${esc(current.version || "new")}" adtcore:abapLanguageVersion="${esc(current.abapLanguageVersion || "standard")}" adtcore:masterLanguage="${esc(current.masterLanguage || value("language", "EN"))}" adtcore:masterSystem="${esc(current.masterSystem)}" adtcore:responsible="${esc(value("responsible"))}">
  <atom:link href="versions" rel="http://www.sap.com/adt/relations/versions" title="Historic versions"/>
  <adtcore:packageRef adtcore:name="${esc(value("packageName"))}"/>
  <dtel:dataElement>
    <dtel:typeKind>${esc(typeKind)}</dtel:typeKind>
    <dtel:typeName>${esc(typeName)}</dtel:typeName>
    <dtel:dataType>${esc(value("dataType"))}</dtel:dataType>
    <dtel:dataTypeLength>${number("dataTypeLength")}</dtel:dataTypeLength>
    <dtel:dataTypeDecimals>${number("dataTypeDecimals")}</dtel:dataTypeDecimals>
    <dtel:shortFieldLabel>${esc(value("shortFieldLabel"))}</dtel:shortFieldLabel>
    <dtel:shortFieldLength>${shortLength}</dtel:shortFieldLength>
    <dtel:shortFieldMaxLength>${shortLength}</dtel:shortFieldMaxLength>
    <dtel:mediumFieldLabel>${esc(value("mediumFieldLabel"))}</dtel:mediumFieldLabel>
    <dtel:mediumFieldLength>${mediumLength}</dtel:mediumFieldLength>
    <dtel:mediumFieldMaxLength>${mediumLength}</dtel:mediumFieldMaxLength>
    <dtel:longFieldLabel>${esc(value("longFieldLabel"))}</dtel:longFieldLabel>
    <dtel:longFieldLength>${longLength}</dtel:longFieldLength>
    <dtel:longFieldMaxLength>${longLength}</dtel:longFieldMaxLength>
    <dtel:headingFieldLabel>${esc(value("headingFieldLabel"))}</dtel:headingFieldLabel>
    <dtel:headingFieldLength>${headingLength}</dtel:headingFieldLength>
    <dtel:headingFieldMaxLength>${headingLength}</dtel:headingFieldMaxLength>
    <dtel:searchHelp></dtel:searchHelp>
    <dtel:searchHelpParameter></dtel:searchHelpParameter>
    <dtel:setGetParameter></dtel:setGetParameter>
    <dtel:defaultComponentName></dtel:defaultComponentName>
    <dtel:deactivateInputHistory>false</dtel:deactivateInputHistory>
    <dtel:changeDocument>false</dtel:changeDocument>
    <dtel:leftToRightDirection>false</dtel:leftToRightDirection>
    <dtel:deactivateBIDIFiltering>false</dtel:deactivateBIDIFiltering>
  </dtel:dataElement>
</blue:wbobj>`;
}

export class DataElementApi {
    constructor(http) { this.http = http; }
    async list({ query = "Z*", maxResults = 100 } = {}) {
        const pattern = String(query ?? "Z*").trim() || "*";
        const response = await this.http.request("/sap/bc/adt/repository/informationsystem/search", { query: { operation:"quickSearch", query:pattern, objectType:"DTEL", maxResults:String(Math.min(500, Math.max(1, Number(maxResults)||100))) }, headers:{Accept:"application/xml"} });
        const items=[]; const seen=new Set();
        for (const m of String(response.body).matchAll(/<(?:[\w.-]+:)?objectReference\b([^>]*)>/gi)) { const attrs=m[1]; const get=n=>attrs.match(new RegExp(`(?:[\\w.-]+:)?${n}=["']([^"']*)`,"i"))?.[1]??""; const type=get("type"); const name=get("name"); if (name && /^DTEL(?:\/DE)?$/i.test(type) && !seen.has(name.toUpperCase()) && wildcard(name,pattern)) { seen.add(name.toUpperCase()); items.push({name,type,description:get("description"),packageName:get("packageName"),uri:get("uri")}); } }
        return { status:response.status,durationMs:response.durationMs,items,count:items.length,raw:response.body };
    }
    async get(name, version) { const dataElementName=normalizeDataElementName(name); const response=await this.http.request(`${DATA_ELEMENTS_URL}/${encodeURIComponent(dataElementName.toLowerCase())}`,{query:version?{version}:undefined,headers:{Accept:DATA_ELEMENT_ACCEPT,"Cache-Control":"no-cache"}}); return {...parseDataElement(response.body),status:response.status,durationMs:response.durationMs}; }
    async validateName(input) { const name=normalizeDataElementName(input.name); const response=await this.http.write(`${DATA_ELEMENTS_URL}/validation`,{query:{objtype:"dtelde",objname:name,description:String(input.description??"")},headers:{Accept:"application/vnd.sap.as+xml"}}); return {name,valid:/<CHECK_RESULT>\s*X\s*<\/CHECK_RESULT>/i.test(response.body),raw:response.body}; }
    async checkTransport(packageName,name) { const uri=`${DATA_ELEMENTS_URL}/${encodeURIComponent(normalizeDataElementName(name).toLowerCase())}`; const body=`<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><PGMID></PGMID><OBJECT></OBJECT><OBJECTNAME></OBJECTNAME><DEVCLASS>${xmlEscape(packageName)}</DEVCLASS><SUPER_PACKAGE></SUPER_PACKAGE><RECORD_CHANGES></RECORD_CHANGES><OPERATION>I</OPERATION><URI>${xmlEscape(uri)}</URI></DATA></asx:values></asx:abap>`; return this.http.write("/sap/bc/adt/cts/transportchecks",{headers:{"Content-Type":"application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData",Accept:"application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData"},body}); }
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

    // Cria primeiro o elemento de dados com os metadados mínimos e depois grava as propriedades DDIC.
    async create(input) {
        const name = normalizeDataElementName(input.name);
        const packageName = String(input.packageName ?? '').trim().toUpperCase();
        if (!packageName) throw new Error('Package name is required.');
        const transport = String(input.transport ?? '').trim();
        if (!localPackage(packageName) && !transport) throw new Error(`A Workbench transport request is required for dataElement '${name}'.`);

        const validation = await this.validateName({ ...input, name });
        if (!validation.valid) throw new Error(`SAP rejected the dataElement name '${name}'.`);
        await this.checkTransport(packageName, name);

        const language = String(input.language ?? 'EN').trim().toUpperCase() || 'EN';
        const responsible = String(input.responsible ?? this.http.config?.user ?? '').trim();
        const masterSystem = String(input.masterSystem ?? '').trim() || await this.getMasterSystem(packageName);
        const attributes = [
            `adtcore:description="${xmlEscape(input.description ?? '')}"`,
            `adtcore:language="${xmlEscape(language)}"`,
            `adtcore:name="${xmlEscape(name)}"`,
            'adtcore:type="DTEL/DE"',
            `adtcore:masterLanguage="${xmlEscape(language)}"`,
            ...(masterSystem ? [`adtcore:masterSystem="${xmlEscape(masterSystem)}"`] : []),
            ...(responsible ? [`adtcore:responsible="${xmlEscape(responsible)}"`] : [])
        ].join(' ');
        const initial = `<?xml version="1.0" encoding="UTF-8"?>\n<blue:wbobj xmlns:adtcore="http://www.sap.com/adt/core" xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel" ${attributes}>\n  <adtcore:packageRef adtcore:name="${xmlEscape(packageName)}"/>\n</blue:wbobj>`;

        const response = await this.http.write(DATA_ELEMENTS_URL, {
            query: transport ? { corrNr: transport } : undefined,
            headers: { 'Content-Type': DATA_ELEMENT_CONTENT_TYPE, Accept: DATA_ELEMENT_ACCEPT },
            body: initial
        });

        if (input.typeName || input.dataType || input.typeKind) await this.update({ ...input, name, packageName, language, responsible });
        return { name, packageName, masterSystem, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Bloqueia o elemento de dados para alteração mantendo a mesma sessão ADT até o UNLOCK.
    async lock(name) {
        const dataElementName = normalizeDataElementName(name);
        const response = await this.http.write(`${DATA_ELEMENTS_URL}/${encodeURIComponent(dataElementName.toLowerCase())}`, {
            query: { _action: "LOCK", accessMode: "MODIFY" },
            headers: {
                "X-sap-adt-sessiontype": "stateful",
                Accept: "application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.8, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2;q=0.9"
            }
        });
        const lock = parseLockHandle(response.body);
        if (!lock.lockHandle) throw new Error(`SAP did not return a lock handle for dataElement '${dataElementName}'.`);
        return { ...lock, status: response.status, durationMs: response.durationMs, raw: response.body };
    }

    // Desbloqueia o elemento de dados usando a mesma sessão utilizada para o LOCK.
    async unlock(name, lockHandle) {
        return this.http.write(`${DATA_ELEMENTS_URL}/${encodeURIComponent(normalizeDataElementName(name).toLowerCase())}`, {
            query: { _action: "UNLOCK", lockHandle },
            headers: { "X-sap-adt-sessiontype": "stateful" }
        });
    }

    // Atualiza o elemento de dados depois de obter o lock handle válido para a sessão ADT atual.
    async update(input) {
        const name = normalizeDataElementName(input.name);
        const current = await this.get(name, "inactive").catch(() => this.get(name, "workingArea"));
        const packageName = String(input.packageName ?? current.packageName ?? "").trim().toUpperCase();
        const transport = String(input.transport ?? "").trim();

        if (!localPackage(packageName) && !transport) {
            throw new Error(`A Workbench transport request is required to update dataElement '${name}'.`);
        }

        // Obtém o token antes do LOCK para não executar uma chamada adicional entre LOCK e PUT.
        const token = await this.http.fetchCsrfToken();
        const lock = await this.lock(name);
        let failure;

        try {
            const query = { lockHandle: lock.lockHandle };
            if (transport) query.corrNr = transport;

            const response = await this.http.request(`${DATA_ELEMENTS_URL}/${encodeURIComponent(name.toLowerCase())}`, {
                method: "PUT",
                query,
                headers: {
                    "Content-Type": `${DATA_ELEMENT_CONTENT_TYPE}; charset=utf-8`,
                    Accept: DATA_ELEMENT_ACCEPT,
                    "X-CSRF-Token": token,
                    "X-sap-adt-sessiontype": "stateful"
                },
                body: buildDataElementXml({ ...input, name, packageName }, current)
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

    // Consulta a request Workbench associada ao elemento de dados. Pacotes locais não possuem request.
    async getTransport(name, packageName = "") {
        const dataElementName = normalizeDataElementName(name);
        if (localPackage(packageName)) return { name: dataElementName, number: "" };

        const uri = `${DATA_ELEMENTS_URL}/${encodeURIComponent(dataElementName.toLowerCase())}/transports`;
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
                if (number) return { name: dataElementName, number, status: response.status, durationMs: response.durationMs, raw: response.body };
            } catch (error) {
                lastError = error;
            }
        }

        try {
            const check = await this.checkDelete(dataElementName);
            if (check.transport) return { name: dataElementName, number: check.transport, status: check.status, durationMs: check.durationMs, raw: check.raw };
        } catch (error) {
            lastError = error;
        }

        if (lastError) throw lastError;
        return { name: dataElementName, number: "" };
    }

    async checkDelete(name) { const dataElementName=normalizeDataElementName(name); const uri=`${DATA_ELEMENTS_URL}/${encodeURIComponent(dataElementName.toLowerCase())}`; const body=`<?xml version="1.0" encoding="UTF-8"?><del:checkRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion"><del:object adtcore:uri="${xmlEscape(uri)}"/></del:checkRequest>`; const response=await this.http.write("/sap/bc/adt/deletion/check",{headers:{"Content-Type":"application/vnd.sap.adt.deletion.check.request.v1+xml",Accept:"application/vnd.sap.adt.deletion.check.response.v1+xml"},body}); const transport=response.body.match(/<del:trkorr>\s*([^<]+)/i)?.[1]?.trim()??""; return {name:dataElementName,uri,isDeletable:/isDeletable=["']true/i.test(response.body),transport,raw:response.body}; }
    async delete(name,transport) { const check=await this.checkDelete(name); if(!check.isDeletable) throw new Error(`DataElement '${check.name}' cannot be deleted.`); const request=String(transport??check.transport??"").trim(); const body=`<?xml version="1.0" encoding="UTF-8"?><del:deletionRequest xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion"><del:object adtcore:uri="${xmlEscape(check.uri)}">${request?`<del:transportNumber>${xmlEscape(request)}</del:transportNumber>`:""}</del:object></del:deletionRequest>`; const response=await this.http.write("/sap/bc/adt/deletion/delete",{headers:{"Content-Type":"application/vnd.sap.adt.deletion.request.v1+xml",Accept:"application/vnd.sap.adt.deletion.response.v1+xml"},body}); return {name:check.name,deleted:/isDeleted=["']true/i.test(response.body),transport:request||undefined,raw:response.body}; }
}
