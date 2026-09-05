import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConnections } from "../config.js";
import { createWebServer } from "./server.js";
const execFileAsync = promisify(execFile);
const connections = await loadConnections();
const host = process.env.MCP_ADT_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_ADT_WEB_PORT ?? "3100");
const url = `http://${host}:${port}`;
await createWebServer(connections, host, port).start();
await openBrowser(url);
async function openBrowser(target) {
    try {
        if (process.platform === "win32") {
            await execFileAsync("cmd", ["/c", "start", "", target]);
        }
        else if (process.platform === "darwin") {
            await execFileAsync("open", [target]);
        }
        else {
            await execFileAsync("xdg-open", [target]);
        }
    }
    catch (error) {
        console.error(`Could not open browser automatically. Open ${target} manually.`, error);
    }
}
