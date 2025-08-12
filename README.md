CDISC Library MCP Server (DXT)

Local MCP server packaged for DXT that exposes tools to discover and call the CDISC Library API based on bundled OpenAPI specs.

This MCP server exposes a compact, task-oriented wrapper around the CDISC Library. It supports discovery (suggest + search), Biomedical Concepts (latest + versioned packages), and SDTM Dataset Specializations (latest + packages). Use it to search, fetch a concept or specialization with one call, and then follow `_links` for deeper context. If you need reproducible results tied to an effective date, use the package routes; for exploratory workflows, stick to the latest routes.

About CDISC and the CDISC Library
- CDISC (the Clinical Data Interchange Standards Consortium) is a global, non-profit organization that develops and advances data standards to streamline clinical research and enable data interoperability. See the CDISC site: https://www.cdisc.org
- The CDISC Library provides programmatic access to CDISC standards and related artifacts (for example, SDTM, CDASH, ADaM, Controlled Terminology), including Biomedical Concepts and SDTM Dataset Specializations. You can browse the Library at https://library.cdisc.org/browser and obtain API access via the Developer Portal at https://api.developer.library.cdisc.org

Tools
- list_operations(filter?): Lists operationIds, methods, paths from bundled OpenAPI specs.
- call_operation(operationId, pathParams?, query?, body?, headers?, timeoutMs?): Calls an operation by operationId. API key supported via CDISC_API_KEY.

OpenAPI Sources
- server/openapi/cdisc-cosmos-bc-proxy-v2.yaml
- server/openapi/cdisc-cosmos-base-specializations-proxy-v2.yaml
- server/openapi/cdisc-library-api.yaml (if present)

Run locally
```bash
export CDISC_API_KEY=your_key_here # optional
npm start
```

Package as DXT
- Spec: https://github.com/anthropics/dxt/blob/main/MANIFEST.md
- CLI: https://github.com/anthropics/dxt/blob/main/CLI.md

```bash
npm install -g @anthropic-ai/dxt
# create cdisc-library-mcp.dxt in the project directory
dxt pack
```

The manifest sets CDISC_OPENAPI_DIR to ${DXT_DIR}/server/openapi so the extension is self-contained.

Getting an API key (required)
1) Create/sign in to a CDISC Library account.
   - Browser login: https://library.cdisc.org/browser
2) Open the API Management Developer Portal and sign in with the same credentials.
   - Developer Portal: https://api.developer.library.cdisc.org
3) Retrieve your subscription key (API Key) on the portal.
   - You may receive an email confirming that your key has been generated shortly after sign‑up.
4) Use the key as `api-key` in a header (recommended) or query string.

Bases
- Library: https://api.library.cdisc.org/api
- Cosmos BC: https://api.library.cdisc.org/api/cosmos/v2/mdr/bc
- Cosmos SDTM Specializations: https://api.library.cdisc.org/api/cosmos/v2/mdr/specializations

Install in clients
- Claude Desktop: open the generated `.dxt` file to install the local MCP server.
- Any DXT-compatible app can load this extension per its instructions. See the DXT repo for details: https://github.com/anthropics/dxt

Governance
- License: MIT (see `LICENSE.md`)
- See `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and `SECURITY.md` for community and security guidelines.

Quick outline
- Auth & bases
  - API key (header or query): `api-key: <YOUR_KEY>`
  - Library base: `https://api.library.cdisc.org/api`
  - Cosmos BC base: `https://api.library.cdisc.org/api/cosmos/v2/mdr/bc`
  - Cosmos SDTM Specializations base: `https://api.library.cdisc.org/api/cosmos/v2/mdr/specializations`

1) Discovery
- GET `/mdr/suggest` — params: `q`, `top`, `select`
- GET `/mdr/search` — params: `q` (req), `start`, `pageSize`, `facets`, filters like `domain`, `codelist`, `conceptId`, `product`, `version`, `dataset`, `variable`, `standard`

2) Biomedical Concepts (latest + versioned)
- Latest: `/biomedicalconcepts`, `/biomedicalconcepts/{biomedicalconcept}`, `/categories`
- Version-locked: `/packages`, `/packages/{package}/biomedicalconcepts`, `/packages/{package}/biomedicalconcepts/{biomedicalconcept}`
- Key fields: `_links`, `conceptId`, `href`, `categories`, `shortName`, `synonyms`, `resultScales`, `definition`, `coding`, `dataElementConcepts`, `ncitCode`

3) SDTM Dataset Specializations (latest + versioned)
- Latest: `/sdtm/datasetspecializations?domain=VS|LB|…`, `/sdtm/datasetspecializations/{dataset_specialization_id}`, `/sdtm/domains`, by BC: `/datasetspecializations?biomedicalconcept={conceptId}`
- Version-locked: `/sdtm/packages`, `/sdtm/packages/{package}/datasetspecializations`, `/sdtm/packages/{package}/datasetspecializations/{datasetspecialization}`
- Key fields: `_links`, `datasetSpecializationId`, `domain`, `shortName`, `source`, `sdtmigStartVersion`, `sdtmigEndVersion`, `variables[]`
- `variables[]` keys: `name`, `dataElementConceptId`, `isNonStandard`, `codelist`, `subsetCodelist`, `valueList`, `assignedTerm`, `role`, `dataType`, `length`, `format`, `significantDigits`, `relationship{subject,linkingPhrase,predicateTerm,object}`, `mandatoryVariable`, `mandatoryValue`, `originType`, `originSource`, `comparator`, `vlmTarget`

4) Behavior
- Pagination on `/mdr/search`: `start`, `pageSize`
- Errors surfaced as-is: 401, 422, 404/406/5xx
- Links: follow `_links.self`, `_links.parentPackage`, and `_links.parentBiomedicalConcept`

5) MCP tools (one-to-one mapping)
- `search.suggest(q, top?, select?)`
- `search.query(q, start?, pageSize?, facets?, filters?)`
- `bc.list(category?)`
- `bc.get(conceptId)`
- `bc.categories()`
- `bc.packages.list()`
- `bc.packages.listConcepts(package)`
- `bc.packages.getConcept(package, conceptId)`
- `sdtm.list(domain?)`
- `sdtm.get(datasetSpecializationId)`
- `sdtm.domains()`
- `sdtm.packages.list()`
- `sdtm.packages.listSpecializations(package)`
- `sdtm.packages.getSpecialization(package, datasetSpecialization)`
- `sdtm.byBiomedicalConcept(conceptId)`

