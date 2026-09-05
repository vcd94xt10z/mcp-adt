import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConnections } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
const connections = await loadConnections();
serveStdio(() => createMcpServer(connections));
console.error(`mcp-adt started. Connections: ${Object.keys(connections).join(", ")}`);
