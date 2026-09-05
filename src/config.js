import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function loadConnections(file = resolve(process.cwd(), "connections.json")) {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    validateConnectionsFile(parsed);
    return parsed.connections;
}
export async function saveConnections(connections, file = resolve(process.cwd(), "connections.json")) {
    validateConnectionsFile({ connections });
    await writeFile(file, `${JSON.stringify({ connections }, null, 2)}\n`, "utf8");
}
export function validateConnectionName(name) {
    const value = name.trim();
    if (!value)
        throw new Error("Connection name is required.");
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error("Connection name may contain only letters, numbers, '_' and '-'.");
    }
    return value;
}
export function validateConnection(config) {
    if (!config.url?.trim())
        throw new Error("Connection URL is required.");
    new URL(config.url);
    if (!config.client?.trim())
        throw new Error("SAP client is required.");
    if (!config.user?.trim())
        throw new Error("SAP user is required.");
    if (typeof config.password !== "string")
        throw new Error("SAP password is required.");
}
function validateConnectionsFile(value) {
    if (!value.connections || typeof value.connections !== "object" || Array.isArray(value.connections)) {
        throw new Error("connections.json must contain an object named 'connections'.");
    }
    for (const [name, config] of Object.entries(value.connections)) {
        validateConnectionName(name);
        validateConnection(config);
    }
}
