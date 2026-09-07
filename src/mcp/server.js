import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { AdtHttpClient } from "../adt/http.js";
import { PackageApi } from "../adt/packages.js";
import { RequestApi } from "../adt/requests.js";
import { ClassApi } from "../adt/classes.js";
import { InterfaceApi } from "../adt/interfaces.js";
import { DomainApi } from "../adt/domains.js";
import { ReportApi } from "../adt/reports.js";
import { ActivationApi } from "../adt/activation.js";
import { CheckRunApi } from "../adt/checkrun.js";
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
    }, async ({ connection, name, version }) => { const api = new ClassApi(await client(connection)); if (version) return result({ class: await api.get(name, version), source: await api.getSource(name, version), version }); return result(await api.getForEdit(name)); });
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
    server.registerTool("class_check_syntax", {
        title: "Check ABAP class syntax", description: "Run the Eclipse ADT ABAP Check Run against the exact source code supplied by the caller without saving it. If source is omitted, checks the selected SAP version.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), source: z.string().optional(), version: z.enum(["active", "inactive"]).optional() })
    }, async ({ connection, name, source, version }) => { const className = name.trim().toUpperCase(); const api = new CheckRunApi(await client(connection)); const uri = `/sap/bc/adt/oo/classes/${encodeURIComponent(className.toLowerCase())}`; return result(source === undefined ? await api.checkSyntax(uri, version ?? "inactive") : await api.checkSource(uri, source, version ?? "active")); });
    server.registerTool("class_activate", {
        title: "Activate ABAP class", description: "Activate an ABAP class through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1) })
    }, async ({ connection, name }) => { const className = name.trim().toUpperCase(); return result(await new ActivationApi(await client(connection)).activate({ uri: `/sap/bc/adt/oo/classes/${encodeURIComponent(className.toLowerCase())}`, name: className })); });
    server.registerTool("class_delete", {
        title: "Delete ABAP class", description: "Check and delete an ABAP class through the Eclipse ADT deletion endpoints.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), transport: z.string().optional() })
    }, async ({ connection, name, transport }) => result(await new ClassApi(await client(connection)).delete(name, transport)));
    server.registerTool("interface_list", {
        title: "List ABAP interfaces",
        description: "Search ABAP interfaces by name pattern with * and ? wildcards.",
        inputSchema: connectionSchema.extend({ query: z.string().optional(), maxResults: z.number().optional() })
    }, async ({ connection, query, maxResults }) => result(await new InterfaceApi(await client(connection)).list({ query: query ?? "ZIF*", maxResults })));
    server.registerTool("interface_get", {
        title: "Get ABAP interface", description: "Read ABAP interface metadata and source through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), version: z.string().optional() })
    }, async ({ connection, name, version }) => { const api = new InterfaceApi(await client(connection)); if (version) return result({ class: await api.get(name, version), source: await api.getSource(name, version), version }); return result(await api.getForEdit(name)); });
    server.registerTool("interface_create", {
        title: "Create ABAP interface", description: "Create an ABAP interface using the Eclipse ADT flow.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), packageName: z.string().min(1), transport: z.string().optional(), language: z.string().optional(), final: z.boolean().optional(), visibility: z.string().optional(), source: z.string().optional() })
    }, async ({ connection, ...input }) => { const connections = await loadConnections(); return result(await new InterfaceApi(await client(connection)).create({ ...input, responsible: connections[connection]?.user })); });
    server.registerTool("interface_update", {
        title: "Update ABAP interface", description: "Update the main source of an ABAP interface using the Eclipse ADT save flow. Local package interfaces do not require a transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), description: z.string(), packageName: z.string().optional(), transport: z.string().optional(), language: z.string().optional(), responsible: z.string().optional(), final: z.boolean().optional(), visibility: z.string().optional(), source: z.string() })
    }, async ({ connection, ...input }) => result(await new InterfaceApi(await client(connection)).update(input)));
    server.registerTool("interface_update_source", {
        title: "Update ABAP interface source", description: "Update the main source of an ABAP interface using lock, PUT and unlock. Local package interfaces do not require a transport request.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), source: z.string(), transport: z.string().optional(), packageName: z.string().optional() })
    }, async ({ connection, name, source, transport, packageName }) => result(await new InterfaceApi(await client(connection)).updateSource(name, source, transport, packageName)));
    server.registerTool("interface_check_syntax", {
        title: "Check ABAP interface syntax", description: "Run the Eclipse ADT ABAP Check Run against the exact source code supplied by the caller without saving it. If source is omitted, checks the selected SAP version.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), source: z.string().optional(), version: z.enum(["active", "inactive"]).optional() })
    }, async ({ connection, name, source, version }) => { const interfaceName = name.trim().toUpperCase(); const api = new CheckRunApi(await client(connection)); const uri = `/sap/bc/adt/oo/interfaces/${encodeURIComponent(interfaceName.toLowerCase())}`; return result(source === undefined ? await api.checkSyntax(uri, version ?? "inactive") : await api.checkSource(uri, source, version ?? "active")); });
    server.registerTool("interface_activate", {
        title: "Activate ABAP interface", description: "Activate an ABAP interface through SAP ADT.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1) })
    }, async ({ connection, name }) => { const interfaceName = name.trim().toUpperCase(); return result(await new ActivationApi(await client(connection)).activate({ uri: `/sap/bc/adt/oo/interfaces/${encodeURIComponent(interfaceName.toLowerCase())}`, name: interfaceName })); });
    server.registerTool("interface_delete", {
        title: "Delete ABAP interface", description: "Check and delete an ABAP interface through the Eclipse ADT deletion endpoints.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), transport: z.string().optional() })
    }, async ({ connection, name, transport }) => result(await new InterfaceApi(await client(connection)).delete(name, transport)));
    server.registerTool("domain_list", {
        title: "List DDIC domains", description: "Search ABAP Dictionary domains by name pattern.",
        inputSchema: connectionSchema.extend({ query: z.string().optional(), maxResults: z.number().optional() })
    }, async ({ connection, query, maxResults }) => result(await new DomainApi(await client(connection)).list({ query: query ?? "Z*", maxResults })));
    server.registerTool("domain_get", {
        title: "Get DDIC domain", description: "Read DDIC domain definition and technical properties.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), version: z.string().optional() })
    }, async ({ connection, name, version }) => result(await new DomainApi(await client(connection)).get(name, version)));
    server.registerTool("domain_create", {
        title: "Create DDIC domain", description: "Create a DDIC domain following the Eclipse ADT validation and transport flow.",
        inputSchema: connectionSchema.extend({ name:z.string().min(1), description:z.string(), packageName:z.string().min(1), transport:z.string().optional(), language:z.string().optional(), datatype:z.string().optional(), length:z.number().optional(), decimals:z.number().optional(), outputLength:z.number().optional(), conversionExit:z.string().optional(), lowercase:z.boolean().optional(), signExists:z.boolean().optional(), valueTable:z.string().optional(), fixValues:z.array(z.object({low:z.string(),high:z.string().optional(),text:z.string()})).optional() })
    }, async ({ connection, ...input }) => { const connections=await loadConnections(); return result(await new DomainApi(await client(connection)).create({...input,responsible:connections[connection]?.user})); });
    server.registerTool("domain_update", {
        title: "Update DDIC domain", description: "Update DDIC domain definition using lock, PUT and unlock.",
        inputSchema: connectionSchema.extend({ name:z.string().min(1), description:z.string(), packageName:z.string().optional(), transport:z.string().optional(), language:z.string().optional(), datatype:z.string(), length:z.number(), decimals:z.number().optional(), outputLength:z.number().optional(), conversionExit:z.string().optional(), lowercase:z.boolean().optional(), signExists:z.boolean().optional(), valueTable:z.string().optional(), fixValues:z.array(z.object({low:z.string(),high:z.string().optional(),text:z.string()})).optional() })
    }, async ({ connection, ...input }) => result(await new DomainApi(await client(connection)).update(input)));
    server.registerTool("domain_activate", {
        title: "Activate DDIC domain", description: "Activate a DDIC domain through SAP ADT.", inputSchema: connectionSchema.extend({ name:z.string().min(1) })
    }, async ({connection,name}) => { const n=name.trim().toUpperCase(); return result(await new ActivationApi(await client(connection)).activate({uri:`/sap/bc/adt/ddic/domains/${encodeURIComponent(n.toLowerCase())}`,name:n})); });
    server.registerTool("domain_delete", {
        title:"Delete DDIC domain", description:"Check and delete a DDIC domain through Eclipse ADT deletion endpoints.", inputSchema:connectionSchema.extend({name:z.string().min(1),transport:z.string().optional()})
    }, async ({connection,name,transport}) => result(await new DomainApi(await client(connection)).delete(name,transport)));
    server.registerTool("report_list", {
        title: "List ABAP reports", description: "Search executable ABAP reports by name pattern with * and ? wildcards.",
        inputSchema: connectionSchema.extend({ query: z.string().optional(), maxResults: z.number().optional() })
    }, async ({ connection, query, maxResults }) => result(await new ReportApi(await client(connection)).list({ query, maxResults })));
    server.registerTool("report_get", {
        title: "Get ABAP report", description: "Read ABAP report metadata, source and associated transport when available.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), version: z.string().optional() })
    }, async ({ connection, name, version }) => { const api = new ReportApi(await client(connection)); const editData = version ? { report: await api.get(name, version), source: await api.getSource(name, version), version } : await api.getForEdit(name); return result({ ...editData, transport: await api.getTransport(name).catch(() => ({ number: "" })) }); });
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
    server.registerTool("report_check_syntax", {
        title: "Check ABAP report syntax", description: "Run the Eclipse ADT ABAP Check Run against the exact source code supplied by the caller without saving it. If source is omitted, checks the selected SAP version.",
        inputSchema: connectionSchema.extend({ name: z.string().min(1), source: z.string().optional(), version: z.enum(["active", "inactive"]).optional() })
    }, async ({ connection, name, source, version }) => { const reportName = name.trim().toUpperCase(); const api = new CheckRunApi(await client(connection)); const uri = `/sap/bc/adt/programs/programs/${encodeURIComponent(reportName.toLowerCase())}`; return result(source === undefined ? await api.checkSyntax(uri, version ?? "inactive") : await api.checkSource(uri, source, version ?? "active")); });
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
