import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAPI_DIR = process.env.CDISC_OPENAPI_DIR || path.join(__dirname, "openapi");
const DEFAULT_BASE_HEADERS = {};

function loadYamlIfExists(filename) {
  const filePath = path.join(OPENAPI_DIR, filename);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    return YAML.parse(content);
  }
  return null;
}

function buildOperationIndex(openapiDoc) {
  const index = new Map();
  if (!openapiDoc || !openapiDoc.paths) return index;
  for (const [routePath, methods] of Object.entries(openapiDoc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== "object") continue;
      const operationId = op.operationId || `${method}:${routePath}`;
      index.set(operationId, { method: method.toUpperCase(), path: routePath, op });
    }
  }
  return index;
}

function resolveServerUrl(openapiDoc) {
  const servers = openapiDoc?.servers;
  if (Array.isArray(servers) && servers.length > 0 && servers[0]?.url) {
    return servers[0].url;
  }
  return process.env.CDISC_API_BASE_URL || "https://api.library.cdisc.org";
}

function collectSecuritySchemes(openapiDoc) {
  const schemes = openapiDoc?.components?.securitySchemes || {};
  const hasApiKeyHeader = Boolean(schemes.apiKeyHeader);
  const hasApiKeyQuery = Boolean(schemes.apiKeyQuery);
  return { hasApiKeyHeader, hasApiKeyQuery };
}

function sanitizePath(pathTemplate, pathParams) {
  let finalPath = pathTemplate;
  for (const [key, value] of Object.entries(pathParams || {})) {
    finalPath = finalPath.replace(new RegExp(`{${key}}`, "g"), encodeURIComponent(String(value)));
  }
  return finalPath;
}

function buildQueryString(query) {
  const entries = Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) {
    const value = Array.isArray(v) ? v : [v];
    for (const item of value) usp.append(k, String(item));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

function pickAuthHeaders(authConfig) {
  const headers = { ...DEFAULT_BASE_HEADERS };
  if (authConfig?.apiKey && authConfig?.location === "header") {
    headers[authConfig.headerName || "api-key"] = authConfig.apiKey;
  }
  return headers;
}

function appendAuthQuery(url, authConfig) {
  if (authConfig?.apiKey && authConfig?.location === "query") {
    const u = new URL(url);
    u.searchParams.set(authConfig.queryName || "api-key", authConfig.apiKey);
    return u.toString();
  }
  return url;
}

// Load OpenAPI specs
const specs = [
  loadYamlIfExists("cdisc-cosmos-bc-proxy-v2.yaml"),
  loadYamlIfExists("cdisc-cosmos-base-specializations-proxy-v2.yaml"),
  loadYamlIfExists("cdisc-library-api.yaml")
].filter(Boolean);

// Prepare indices per spec
const specContexts = specs.map((doc) => ({
  doc,
  baseUrl: resolveServerUrl(doc),
  index: buildOperationIndex(doc),
  security: collectSecuritySchemes(doc)
}));

const server = new Server(
  { name: "cdisc-library-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const tools = [
  // Generic helpers
  {
    name: "list_operations",
    description: "List available OpenAPI operations across loaded specs.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Substring to filter operationId or path" }
      }
    }
  },
  {
    name: "call_operation",
    description: "Invoke an OpenAPI operation by operationId. Supports path, query, and body inputs. Handles API key via env CDISC_API_KEY.",
    inputSchema: {
      type: "object",
      required: ["operationId"],
      properties: {
        operationId: { type: "string" },
        pathParams: { type: "object", additionalProperties: true },
        query: { type: "object", additionalProperties: true },
        body: { type: ["object", "array", "string", "null"] },
        headers: { type: "object", additionalProperties: { type: "string" } },
        timeoutMs: { type: "number" }
      }
    }
  },
  // Search tools
  {
    name: "search.suggest",
    description: "Suggest search terms across CDISC Library.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: { q: { type: "string" }, top: { type: "string" }, select: { type: "string" } }
    }
  },
  {
    name: "search.query",
    description: "Search across CDISC Library with paging, facets, and filters.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string" },
        start: { type: "number" },
        pageSize: { type: "number" },
        facets: { type: "boolean" },
        filters: {
          type: "object",
          properties: {
            domain: { type: "string" },
            codelist: { type: "string" },
            conceptId: { type: "string" },
            product: { type: "string" },
            version: { type: "string" },
            dataset: { type: "string" },
            variable: { type: "string" },
            standard: { type: "string" }
          }
        }
      }
    }
  },
  // BC latest
  { name: "bc.list", description: "List latest Biomedical Concepts (optional category).", inputSchema: { type: "object", properties: { category: { type: "string" } } } },
  { name: "bc.get", description: "Get latest Biomedical Concept by conceptId.", inputSchema: { type: "object", required: ["conceptId"], properties: { conceptId: { type: "string" } } } },
  { name: "bc.categories", description: "List Biomedical Concept categories.", inputSchema: { type: "object" } },
  // BC packages
  { name: "bc.packages.list", description: "List BC packages.", inputSchema: { type: "object" } },
  { name: "bc.packages.listConcepts", description: "List BCs within a package.", inputSchema: { type: "object", required: ["package"], properties: { package: { type: "string" } } } },
  { name: "bc.packages.getConcept", description: "Get BC within a package.", inputSchema: { type: "object", required: ["package", "conceptId"], properties: { package: { type: "string" }, conceptId: { type: "string" } } } },
  // SDTM latest
  { name: "sdtm.list", description: "List latest SDTM dataset specializations (optional domain).", inputSchema: { type: "object", properties: { domain: { type: "string" } } } },
  { name: "sdtm.get", description: "Get latest SDTM specialization by datasetSpecializationId.", inputSchema: { type: "object", required: ["datasetSpecializationId"], properties: { datasetSpecializationId: { type: "string" } } } },
  { name: "sdtm.domains", description: "List SDTM specialization domains.", inputSchema: { type: "object" } },
  { name: "sdtm.byBiomedicalConcept", description: "List dataset specializations specializing a given Biomedical Concept (latest).", inputSchema: { type: "object", required: ["conceptId"], properties: { conceptId: { type: "string" } } } },
  // SDTM packages
  { name: "sdtm.packages.list", description: "List SDTM packages.", inputSchema: { type: "object" } },
  { name: "sdtm.packages.listSpecializations", description: "List SDTM specializations within a package.", inputSchema: { type: "object", required: ["package"], properties: { package: { type: "string" } } } },
  { name: "sdtm.packages.getSpecialization", description: "Get SDTM specialization within a package.", inputSchema: { type: "object", required: ["package", "datasetSpecialization"], properties: { package: { type: "string" }, datasetSpecialization: { type: "string" } } } }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("[mcp] tools/list requested");
  return { tools };
});

async function handleListOperations(input) {
  const filter = (input?.filter || "").toLowerCase();
  const results = [];
  for (const { doc, baseUrl, index } of specContexts) {
    for (const [operationId, meta] of index.entries()) {
      const match = !filter || operationId.toLowerCase().includes(filter) || meta.path.toLowerCase().includes(filter);
      if (match) {
        results.push({
          operationId,
          method: meta.method,
          path: meta.path,
          baseUrl,
          summary: meta.op?.summary || null,
          tags: meta.op?.tags || [],
          servers: doc?.servers || []
        });
      }
    }
  }
  return { content: [{ type: "json", text: JSON.stringify(results) }] };
}

async function handleCallOperation(input) {
  const { operationId, pathParams, query, body, headers, timeoutMs } = input;

  // Find operation across specs
  let context = null;
  let meta = null;
  for (const ctx of specContexts) {
    const found = ctx.index.get(operationId);
    if (found) { context = ctx; meta = found; break; }
  }
  if (!context || !meta) {
    throw new Error(`operationId not found: ${operationId}`);
  }

  const authConfig = (() => {
    const apiKey = process.env.CDISC_API_KEY;
    if (!apiKey) return null;
    const force = process.env.CDISC_AUTH_LOCATION; // 'header' or 'query'
    if (force === "header") {
      return { apiKey, location: "header", headerName: process.env.CDISC_AUTH_HEADER || "api-key" };
    }
    if (force === "query") {
      return { apiKey, location: "query", queryName: process.env.CDISC_AUTH_QUERY || "api-key" };
    }
    if (context.security.hasApiKeyHeader) {
      return { apiKey, location: "header", headerName: "api-key" };
    }
    if (context.security.hasApiKeyQuery) {
      return { apiKey, location: "query", queryName: "api-key" };
    }
    return { apiKey, location: "header", headerName: "api-key" };
  })();

  const urlPath = sanitizePath(meta.path, pathParams);
  const qs = buildQueryString(query);
  let url = `${context.baseUrl.replace(/\/$/, "")}${urlPath}${qs}`;
  url = appendAuthQuery(url, authConfig);

  const requestHeaders = {
    "content-type": "application/json",
    ...pickAuthHeaders(authConfig),
    ...(headers || {})
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 30000));
  try {
    const res = await fetch(url, {
      method: meta.method,
      headers: requestHeaders,
      body: body !== undefined && body !== null && meta.method !== "GET" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return {
      content: [{ type: parsed ? "json" : "text", text: parsed ? JSON.stringify(parsed) : text }],
      isError: !res.ok,
    };
  } finally {
    clearTimeout(id);
  }
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  console.error(`[mcp] tools/call: ${req.params?.name}`);
  const name = req.params.name;
  const args = (req.params && req.params.arguments) || {};
  if (name === "list_operations") return handleListOperations(args);
  if (name === "call_operation") return handleCallOperation(args);
  // Search
  if (name === "search.suggest") {
    return handleCallOperation({ operationId: "api-search-suggest", query: { q: args.q, top: args.top, select: args.select } });
  }
  if (name === "search.query") {
    const { q, start, pageSize, facets, filters = {} } = args;
    return handleCallOperation({ operationId: "api-search-search", query: { q, start, pageSize, facets, ...filters } });
  }
  // BC latest
  if (name === "bc.list") {
    const query = {};
    if (args.category) query.category = args.category;
    return handleCallOperation({ operationId: "get_latest_biomedical_concepts_mdr_bc_biomedicalconcepts_get", query });
  }
  if (name === "bc.get") {
    return handleCallOperation({ operationId: "get_latest_biomedicalconcept_mdr_bc_biomedicalconcepts__biomedicalconcept__g", pathParams: { biomedicalconcept: args.conceptId } });
  }
  if (name === "bc.categories") {
    return handleCallOperation({ operationId: "get_latest_biomedicalconcept_categories_mdr_bc_categories_get" });
  }
  // BC packages
  if (name === "bc.packages.list") {
    return handleCallOperation({ operationId: "get_biomedicalconcept_packages_mdr_bc_packages_get" });
  }
  if (name === "bc.packages.listConcepts") {
    return handleCallOperation({ operationId: "get_biomedicalconcepts_mdr_bc_packages__package__biomedicalconcepts_get", pathParams: { package: args.package } });
  }
  if (name === "bc.packages.getConcept") {
    return handleCallOperation({ operationId: "get_package_biomedicalconcept_mdr_bc_packages__package__biomedicalconcepts__", pathParams: { package: args.package, biomedicalconcept: args.conceptId } });
  }
  // SDTM latest
  if (name === "sdtm.list") {
    const query = {};
    if (args.domain) query.domain = args.domain;
    return handleCallOperation({ operationId: "get_latest_sdtm_specializations_mdr_specializations_sdtm_datasetspecializati", query });
  }
  if (name === "sdtm.get") {
    return handleCallOperation({ operationId: "get_latest_sdtm_specialization_mdr_specializations_sdtm_datasetspecializatio", pathParams: { dataset_specialization_id: args.datasetSpecializationId } });
  }
  if (name === "sdtm.domains") {
    return handleCallOperation({ operationId: "get_sdtm_dataset_specialization_domain_list_mdr_specializations_sdtm_domains" });
  }
  if (name === "sdtm.byBiomedicalConcept") {
    return handleCallOperation({ operationId: "get_latest_bc_datasetspecializations_mdr_specializations_datasetspecializati", query: { biomedicalconcept: args.conceptId } });
  }
  // SDTM packages
  if (name === "sdtm.packages.list") {
    return handleCallOperation({ operationId: "get_sdtm_specialization_packages_mdr_specializations_sdtm_packages_get" });
  }
  if (name === "sdtm.packages.listSpecializations") {
    return handleCallOperation({ operationId: "get_sdtm_specializations_mdr_specializations_sdtm_packages__package__dataset", pathParams: { package: args.package } });
  }
  if (name === "sdtm.packages.getSpecialization") {
    return handleCallOperation({ operationId: "get_sdtm_specialization_mdr_specializations_sdtm_packages__package__datasets", pathParams: { package: args.package, datasetspecialization: args.datasetSpecialization } });
  }
  throw new Error(`Unknown tool: ${name}`);
});

console.error("[mcp] starting stdio transport");
await server.connect(new StdioServerTransport());
console.error("[mcp] transport started");


