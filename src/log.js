import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const logFile = resolve(process.cwd(), "mcp.log");
let enabled = false;
let writeQueue = Promise.resolve();

export function isLogEnabled() {
    return enabled;
}

export function setLogEnabled(value) {
    enabled = Boolean(value);
    return enabled;
}

export function getLogFile() {
    return logFile;
}

export async function readLog() {
    try {
        const content = await readFile(logFile, "utf8");
        if (!content.trim()) return [];
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        if (error instanceof SyntaxError) return [];
        throw error;
    }
}

export async function clearLog() {
    await writeQueue;
    try {
        await unlink(logFile);
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }
}

export async function writeSapLog({ method, url, headers, body, status, responseHeaders, responseBody, durationMs, error }) {
    if (!enabled) return;
    const entry = {
        timestamp: new Date().toISOString(),
        date: formatDate(new Date()),
        time: formatTime(new Date()),
        method: method ?? "GET",
        uri: url ?? "",
        request: {
            headers: sanitizeHeaders(headers),
            body: String(body ?? "")
        },
        response: {
            status: status ?? 0,
            durationMs: durationMs ?? 0,
            headers: sanitizeHeaders(responseHeaders),
            body: String(responseBody ?? "")
        }
    };
    if (error) entry.error = String(error);
    writeQueue = writeQueue.then(async () => {
        const entries = await readLog();
        entries.push(entry);
        await writeFile(logFile, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    });
    await writeQueue;
}

function formatDate(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sanitizeHeaders(headers) {
    if (!headers) return {};
    const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
    const result = {};
    for (const [name, value] of entries) {
        result[name] = /^(authorization|cookie|set-cookie|x-csrf-token)$/i.test(name) ? "<redacted>" : String(value);
    }
    return result;
}
