import { xmlEscape } from "./xml.js";

// API ADT responsável por executar verificações de sintaxe e interpretar as mensagens retornadas pelo SAP.
export class CheckRunApi {
    constructor(http) {
        this.http = http;
    }

    // Executa o ABAP Check Run exatamente pelo endpoint utilizado pelo Eclipse ADT.
    async checkSyntax(uri, version = "inactive") {
        const objectUri = String(uri ?? "").trim();
        if (!objectUri) throw new Error("Object URI is required.");

        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<chkrun:checkObjectList xmlns:adtcore="http://www.sap.com/adt/core" xmlns:chkrun="http://www.sap.com/adt/checkrun">\n  <chkrun:checkObject adtcore:uri="${xmlEscape(objectUri)}" chkrun:version="${xmlEscape(version)}"/>\n</chkrun:checkObjectList>`;
        const response = await this.http.write("/sap/bc/adt/checkruns", {
            query: { reporters: "abapCheckRun" },
            headers: {
                "Content-Type": "application/vnd.sap.adt.checkobjects+xml",
                Accept: "application/vnd.sap.adt.checkmessages+xml"
            },
            body
        });

        const messages = parseCheckMessages(response.body);
        return this.createResult(objectUri, version, response, messages);
    }

    // Verifica a sintaxe do código informado usando um artifact temporário, sem gravar o conteúdo no SAP.
    async checkSource(uri, source, version = "active") {
        const objectUri = String(uri ?? "").trim();
        if (!objectUri) throw new Error("Object URI is required.");

        const sourceUri = `${objectUri}/source/main`;
        const content = Buffer.from(String(source ?? ""), "utf8").toString("base64");
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:adtcore="http://www.sap.com/adt/core" xmlns:chkrun="http://www.sap.com/adt/checkrun">
  <chkrun:checkObject adtcore:uri="${xmlEscape(objectUri)}" chkrun:version="${xmlEscape(version)}">
    <chkrun:artifacts>
      <chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="${xmlEscape(sourceUri)}">
        <chkrun:content>${content}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`;
        const response = await this.http.write("/sap/bc/adt/checkruns", {
            query: { reporters: "abapCheckRun" },
            headers: {
                "Content-Type": "application/vnd.sap.adt.checkobjects+xml",
                Accept: "application/vnd.sap.adt.checkmessages+xml"
            },
            body
        });

        const messages = parseCheckMessages(response.body);
        return {
            ...this.createResult(objectUri, version, response, messages),
            sourceUri,
            checkedSource: true
        };
    }

    // Padroniza o retorno das verificações de sintaxe.
    createResult(objectUri, version, response, messages) {
        return {
            uri: objectUri,
            version,
            status: response.status,
            durationMs: response.durationMs,
            messageCount: messages.length,
            hasErrors: messages.some(message => message.type === "E"),
            messages,
            raw: response.body
        };
    }
}

// Converte entidades XML para texto legível nas mensagens do SAP.
function decodeXml(value) {
    return String(value ?? "")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

// Extrai uma posição start/end da URI retornada pelo ABAP Check Run.
function parsePosition(uri) {
    const value = String(uri ?? "");
    const rangeMatch = value.match(/#start=(\d+),(\d+);end=(\d+),(\d+)/i);
    if (rangeMatch) {
        return {
            line: Number(rangeMatch[1]),
            column: Number(rangeMatch[2]),
            endLine: Number(rangeMatch[3]),
            endColumn: Number(rangeMatch[4])
        };
    }

    const startMatch = value.match(/#start=(\d+),(\d+)/i);
    if (!startMatch) return {};
    return {
        line: Number(startMatch[1]),
        column: Number(startMatch[2])
    };
}

// Extrai as mensagens de sintaxe do XML application/vnd.sap.adt.checkmessages+xml.
export function parseCheckMessages(xml) {
    const source = String(xml ?? "");
    const messages = [];
    const pattern = /<chkrun:checkMessage\b([^>]*)>([\s\S]*?)<\/chkrun:checkMessage>|<chkrun:checkMessage\b([^>]*)\/>/gi;

    for (const match of source.matchAll(pattern)) {
        const attributes = match[1] || match[3] || "";
        const attribute = name => {
            const value = attributes.match(new RegExp(`(?:[\\w.-]+:)?${name}=["']([^"']*)["']`, "i"));
            return value?.[1] ?? "";
        };
        const uri = decodeXml(attribute("uri"));
        messages.push({
            type: String(attribute("type") || "I").toUpperCase(),
            shortText: decodeXml(attribute("shortText")),
            code: decodeXml(attribute("code")),
            uri,
            ...parsePosition(uri)
        });
    }

    return messages;
}
