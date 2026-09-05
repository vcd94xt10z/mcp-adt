import { randomUUID } from "node:crypto";
import { writeSapLog } from "../log.js";
export class AdtHttpError extends Error {
    response;
    retryable;
    constructor(message, response, retryable) {
        super(message);
        this.response = response;
        this.retryable = retryable;
        this.name = "AdtHttpError";
    }
}
export class AdtHttpClient {
    config;
    csrfToken;
    cookie = "";
    constructor(config) {
        this.config = config;
        this.connectionId = randomUUID();
    }
    buildUrl(path, query) {
        const base = new URL(this.config.url.endsWith("/") ? this.config.url : `${this.config.url}/`);
        const url = new URL(path.replace(/^\//, ""), base);
        url.search = "";
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined)
                url.searchParams.set(key, value);
        }
        return url;
    }
    baseHeaders() {
        const basic = Buffer.from(`${this.config.user}:${this.config.password}`).toString("base64");
        const headers = {
            Authorization: `Basic ${basic}`,
            Accept: "application/xml, text/xml, application/json, */*",
            "X-SAP-ADTPRODUCT": "mcp-adt/0.1.0",
            "sap-adt-request-id": randomUUID(),
            "sap-adt-connection-id": this.connectionId
        };
        if (this.cookie)
            headers.Cookie = this.cookie;
        if (this.config.client)
            headers["sap-client"] = this.config.client;
        if (this.config.language)
            headers["Accept-Language"] = this.config.language;
        return headers;
    }
    updateCookies(headers) {
        const values = headers.getSetCookie?.() ?? [];
        if (values.length === 0)
            return;
        const parts = values.map(v => v.split(";", 1)[0]).filter(Boolean);
        const current = new Map();
        for (const item of this.cookie.split("; ")) {
            const [k, ...rest] = item.split("=");
            if (k && rest.length)
                current.set(k, rest.join("="));
        }
        for (const item of parts) {
            const [k, ...rest] = item.split("=");
            if (k && rest.length)
                current.set(k, rest.join("="));
        }
        this.cookie = [...current.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    async rawRequest(path, options) {
        const url = this.buildUrl(path, options.query);
        const headers = { ...this.baseHeaders(), ...(options.headers ?? {}) };
        for (const name of options.omitHeaders ?? []) delete headers[name];
        const started = performance.now();
        let response;
        try {
            response = await fetch(url, {
                method: options.method ?? "GET",
                headers,
                body: options.body,
                redirect: "follow"
            });
        }
        catch (error) {
            const durationMs = Math.round(performance.now() - started);
            const message = error instanceof Error ? error.message : String(error);
            await writeSapLog({
                method: options.method ?? "GET",
                url: url.toString(),
                headers,
                body: options.body,
                status: 0,
                responseHeaders: {},
                responseBody: "",
                durationMs,
                error: message
            });
            const synthetic = { status: 0, headers: new Headers(), body: "", url: url.toString(), durationMs };
            throw new AdtHttpError(`ADT network request failed: ${message}`, synthetic, true);
        }
        this.updateCookies(response.headers);
        const body = await response.text();
        const durationMs = Math.round(performance.now() - started);
        await writeSapLog({
            method: options.method ?? "GET",
            url: url.toString(),
            headers,
            body: options.body,
            status: response.status,
            responseHeaders: response.headers,
            responseBody: body,
            durationMs
        });
        return { status: response.status, headers: response.headers, body, url: url.toString(), durationMs };
    }
    isRetryableStatus(status) {
        return status === 408 || status === 429 || status >= 500;
    }
    async request(path, options = {}) {
        let response = await this.rawRequest(path, options);
        if (response.status === 403 && options.method && options.method !== "GET" && options.retry !== false) {
            await this.fetchCsrfToken(true);
            response = await this.rawRequest(path, {
                ...options,
                retry: false,
                headers: { ...(options.headers ?? {}), "X-CSRF-Token": this.csrfToken }
            });
        }
        if (response.status === 406 && options.retry !== false) {
            const accepted = extractAcceptedContentType(response.body);
            if (accepted) {
                response = await this.rawRequest(path, {
                    ...options,
                    retry: false,
                    headers: { ...(options.headers ?? {}), Accept: accepted }
                });
            }
        }
        if (this.isRetryableStatus(response.status) && options.retry !== false) {
            await new Promise(resolve => setTimeout(resolve, 250));
            response = await this.rawRequest(path, { ...options, retry: false });
        }
        if (response.status >= 400) {
            throw new AdtHttpError(`ADT request failed: ${response.status} ${response.url}${response.body ? ` - ${response.body.slice(0, 1000)}` : ""}`, response, this.isRetryableStatus(response.status) || response.status === 403);
        }
        return response;
    }
    async fetchCsrfToken(force = false) {
        if (this.csrfToken && !force)
            return this.csrfToken;
        const response = await this.rawRequest("/sap/bc/adt/discovery", {
            headers: { "X-CSRF-Token": "Fetch" }
        });
        if (response.status >= 400) {
            throw new AdtHttpError(`Unable to fetch CSRF token: ${response.status}`, response, response.status >= 500);
        }
        const token = response.headers.get("x-csrf-token");
        if (!token)
            throw new Error("SAP did not return X-CSRF-Token.");
        this.csrfToken = token;
        return token;
    }
    async write(path, options) {
        const token = await this.fetchCsrfToken();
        return this.request(path, {
            ...options,
            method: options.headers?.["X-HTTP-Method-Override"] ?? "POST",
            headers: { "X-CSRF-Token": token, ...(options.headers ?? {}) }
        });
    }
}

function extractAcceptedContentType(body) {
    const source = String(body ?? '');
    const match = source.match(/Accepted content types:\s*([^<\r\n]+)/i);
    if (!match) return '';
    const value = match[1].trim().split(',')[0].trim();
    return /^[-+\w.]+\/[-+\w.]+(?:;\s*[^,]+)?$/.test(value) ? value : '';
}
