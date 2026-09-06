import { xmlEscape } from "./xml.js";

// API ADT genérica para ativação de objetos de desenvolvimento.
export class ActivationApi {
    constructor(http) { this.http = http; }

    // Ativa um ou mais objetos ADT pelos respectivos URIs.
    async activate(objects) {
        const list = Array.isArray(objects) ? objects : [objects];
        if (!list.length) throw new Error("At least one object is required for activation.");
        const references = list.map(object => {
            const uri = String(object.uri ?? "").trim();
            if (!uri) throw new Error("Object URI is required for activation.");
            const name = String(object.name ?? "").trim();
            return `<adtcore:objectReference adtcore:uri="${xmlEscape(uri)}"${name ? ` adtcore:name="${xmlEscape(name)}"` : ""}/>`;
        }).join("");
        const body = `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${references}</adtcore:objectReferences>`;
        const response = await this.http.write("/sap/bc/adt/activation", { query: { method: "activate", preauditRequested: "true" }, headers: { "Content-Type": "application/xml", Accept: "application/xml" }, body });
        return { status: response.status, durationMs: response.durationMs, raw: response.body };
    }
}
