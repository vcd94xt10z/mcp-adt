import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { AdtHttpClient } from "../adt/http.js";
import { PackageApi } from "../adt/packages.js";
import { RequestApi } from "../adt/requests.js";
import { ClassApi } from "../adt/classes.js";
import { ReportApi } from "../adt/reports.js";
import { ActivationApi } from "../adt/activation.js";
import { loadConnections } from "../config.js";
export function createMcpServer(initialConnections) {
    const server = new McpServer({ name: "mcp-adt", version: "0.1.0" });
    const clients = new Map();
    async function client(connection) {
        const connections = await loadConnections();
        const config = connections[connection];
        if (!config)
            throw new Error(`Unknown SAP connection '${connection}'. Available: ${Object.keys(connections).join(", ")}`);
        const fingerprint = JSON.stringify(config);
        const current = clients.get(connection);
        if (!current || current.fingerprint !== fingerprint) {
            const value = new AdtHttpClient(config);
            clients.set(connection, { fingerprint, client: value });
            return value;
        }
        return current.client;
    }
    const connectionSchema = z.object({ connection: z.string().min(1) });
    server.registerTool("package_list", {
        title: "List SAP packages",
        description: "Search SAP ABAP packages by name pattern using the ADT Repository Information System. Default pattern is Z*. Returns package description and superpackage.",
        inputSchema: connectionSchema.extend({ query: z.string().optional(), maxResults: z.number().optional() })
    }, async ({ connection, query, maxResults }) => result(await new PackageApi(await client(connection)).list({ query, maxResults })));
    server.registerTool("package_get", {
        title: "Get SAP package",
        description: "Read a package by name through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1) })
    }, async ({ connection, name }) => result(await new PackageApi(await client(connection)).get(name)));
    server.registerTool("package_validate_object", {
        title: "Validate package compatibility",
        description: "Validate whether a selected SAP package can be used for an object type without hiding packages from the user.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), objectType: z.string().min(1) })
    }, async ({ connection, name, objectType }) => result(await new PackageApi(await client(connection)).validateObjectCompatibility(name, objectType)));
    server.registerTool("package_create", {
        title: "Create SAP package",
        description: "Create an ABAP package (DEVC) through SAP ADT. Package names are normalized to uppercase. Local packages whose name starts with $ do not use a transport. Non-local packages require a Workbench transport request and record object changes.",
        inputSchema: connectionSchema.extend({
            name: z.string().min(1),
            description: z.string(),
            superPackage: z.string().optional(),
            responsible: z.string().optional(),
            language: z.string().optional(),
            packageType: z.enum(["development", "structure", "main"]).optional(),
            softwareComponent: z.string().optional(),
            transportLayer: z.string().optional(),
            transport: z.string().optional(),
            recordChanges: z.boolean().optional()
        })
    }, async ({ connection, ...input }) => result(await new PackageApi(await client(connection)).create(input)));
    server.registerTool("package_update", {
        title: "Update SAP package",
        description: "Update only the package description and transport layer through SAP ADT. Other package attributes are preserved.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), transportLayer: z.string(), transport: z.string().optional() })
    }, async ({ connection, name, description, transportLayer, transport }) => result(await new PackageApi(await client(connection)).update(name, description, transportLayer, transport)));
    server.registerTool("package_delete", {
        title: "Delete SAP package",
        description: "Delete an ABAP package through SAP ADT. Non-local packages require a Workbench transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), transport: z.string().optional() })
    }, async ({ connection, name, transport }) => result(await new PackageApi(await client(connection)).delete(name, transport)));
    server.registerTool("class_list", {
        title: "List ABAP classes",
        description: "Search ABAP classes by name pattern with * and ? wildcards.",
        inputSchema: connectionSchema.extend({ query: z.string().optional(), maxResults: z.number().optional() })
    }, async ({ connection, query, maxResults }) => result(await new ClassApi(await client(connection)).list({ query, maxResults })));
    server.registerTool("class_get", {
        title: "Get ABAP class", description: "Read ABAP class metadata and source through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), version: z.string().optional() })
    }, async ({ connection, name, version }) => { const api = new ClassApi(await client(connection)); return result({ class: await api.get(name, version), source: await api.getSource(name, version) }); });
    server.registerTool("class_create", {
        title: "Create ABAP class", description: "Create an ABAP class using the Eclipse ADT flow.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), packageName: z.string().min(1), transport: z.string().optional(), language: z.string().optional(), final: z.boolean().optional(), visibility: z.string().optional(), source: z.string().optional() })
    }, async ({ connection, ...input }) => { const connections = await loadConnections(); return result(await new ClassApi(await client(connection)).create({ ...input, responsible: connections[connection]?.user })); });
    server.registerTool("class_update", {
        title: "Update ABAP class", description: "Update ABAP class metadata and source. Local package classes do not require a transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), packageName: z.string().optional(), transport: z.string().optional(), language: z.string().optional(), responsible: z.string().optional(), final: z.boolean().optional(), visibility: z.string().optional(), source: z.string() })
    }, async ({ connection, ...input }) => result(await new ClassApi(await client(connection)).update(input)));
    server.registerTool("class_update_source", {
        title: "Update ABAP class source", description: "Update the main source of an ABAP class using lock, PUT and unlock. Local package classes do not require a transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), source: z.string(), transport: z.string().optional(), packageName: z.string().optional() })
    }, async ({ connection, name, source, transport, packageName }) => result(await new ClassApi(await client(connection)).updateSource(name, source, transport, packageName)));
    server.registerTool("class_activate", {
        title: "Activate ABAP class", description: "Activate an ABAP class through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1) })
    }, async ({ connection, name }) => { const className = name.trim().toUpperCase(); return result(await new ActivationApi(await client(connection)).activate({ uri: `/sap/bc/adt/oo/classes/${encodeURIComponent(className.toLowerCase())}`, name: className })); });
    server.registerTool("class_delete", {
        title: "Delete ABAP class", description: "Check and delete an ABAP class through the Eclipse ADT deletion endpoints.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), transport: z.string().optional() })
    }, async ({ connection, name, transport }) => result(await new ClassApi(await client(connection)).delete(name, transport)));
    server.registerTool("report_list", {
        title: "List ABAP reports", description: "Search executable ABAP reports by name pattern with * and ? wildcards.",
        inputSchema: connectionSchema.extend({ query: z.string().optional(), maxResults: z.number().optional() })
    }, async ({ connection, query, maxResults }) => result(await new ReportApi(await client(connection)).list({ query, maxResults })));
    server.registerTool("report_get", {
        title: "Get ABAP report", description: "Read ABAP report metadata, source and associated transport when available.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), version: z.string().optional() })
    }, async ({ connection, name, version }) => { const api = new ReportApi(await client(connection)); return result({ report: await api.get(name, version), source: await api.getSource(name, version), transport: await api.getTransport(name).catch(() => ({ number: "" })) }); });
    server.registerTool("report_create", {
        title: "Create ABAP report", description: "Create an executable ABAP report using the Eclipse ADT flow. Local packages do not require a transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), packageName: z.string().min(1), transport: z.string().optional(), language: z.string().optional(), source: z.string().optional() })
    }, async ({ connection, ...input }) => { const connections = await loadConnections(); return result(await new ReportApi(await client(connection)).create({ ...input, responsible: connections[connection]?.user })); });
    server.registerTool("report_update", {
        title: "Update ABAP report", description: "Update ABAP report metadata and source using lock, PUT and unlock. Local packages do not require a transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), packageName: z.string().optional(), transport: z.string().optional(), language: z.string().optional(), responsible: z.string().optional(), source: z.string() })
    }, async ({ connection, ...input }) => result(await new ReportApi(await client(connection)).update(input)));
    server.registerTool("report_update_source", {
        title: "Update ABAP report source", description: "Update the main source of an ABAP report using lock, PUT and unlock.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), source: z.string(), transport: z.string().optional(), packageName: z.string().optional() })
    }, async ({ connection, name, source, transport, packageName }) => result(await new ReportApi(await client(connection)).updateSource(name, source, transport, packageName)));
    server.registerTool("report_activate", {
        title: "Activate ABAP report", description: "Activate an ABAP report through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1) })
    }, async ({ connection, name }) => { const reportName = name.trim().toUpperCase(); return result(await new ActivationApi(await client(connection)).activate({ uri: `/sap/bc/adt/programs/programs/${encodeURIComponent(reportName.toLowerCase())}`, name: reportName })); });
    server.registerTool("report_delete", {
        title: "Delete ABAP report", description: "Check and delete an ABAP report through the Eclipse ADT deletion endpoints.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), transport: z.string().optional() })
    }, async ({ connection, name, transport }) => result(await new ReportApi(await client(connection)).delete(name, transport)));
    server.registerTool("request_list", {
        title: "List transport requests",
        description: "List transport requests through SAP ADT.",
        inputSchema: connectionSchema
    }, async ({ connection }) => result(await new RequestApi(await client(connection)).list()));
    server.registerTool("request_get", {
        title: "Get transport request",
        description: "Read a transport request by number.",
        inputSchema: connectionSchema.extend({ number: z.string().min(1) })
    }, async ({ connection, number }) => result(await new RequestApi(await client(connection)).get(number)));
    server.registerTool("request_create", {
        title: "Create transport request",
        description: "Create a Workbench (K) or Customizing (W) transport request through SAP ADT. The request number is generated by SAP.",
        inputSchema: connectionSchema.extend({ description: z.string().min(1), category: z.enum(["K", "W"]).optional(), target: z.string().optional() })
    }, async ({ connection, ...input }) => {
        const connections = await loadConnections();
        const config = connections[connection];
        if (!config) throw new Error(`Unknown SAP connection '${connection}'.`);
        return result(await new RequestApi(await client(connection)).create({ ...input, owner: config.user }));
    });
    server.registerTool("request_update", {
        title: "Update transport request",
        description: "Update a transport request description and target through SAP ADT.",
        inputSchema: connectionSchema.extend({ number: z.string().min(1), description: z.string().min(1), target: z.string().optional() })
    }, async ({ connection, number, description, target }) => result(await new RequestApi(await client(connection)).update(number, description, target)));
    server.registerTool("request_delete", {
        title: "Delete transport request",
        description: "Delete an unreleased transport request through SAP ADT.",
        inputSchema: connectionSchema.extend({ number: z.string().min(1) })
    }, async ({ connection, number }) => result(await new RequestApi(await client(connection)).delete(number)));
    return server;
}
function result(value) {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
