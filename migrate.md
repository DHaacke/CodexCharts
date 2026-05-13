# CodexCharts To BHRA-Importer Migration Checklist (Tailored)

This guide is tailored to the current BHRA-Importer and CodexCharts structures.

## Scope

- Source project: `CodexCharts`
- Target project: `BHRA-Importer`
- Priority area: BHRA export section (first section of UI)
- Baseline output: HTML

## Current Structure Snapshot

### CodexCharts files to reuse

- `chart-contract/chart-request.schema.json`
- `chart-contract/chart-request.template.json`
- `chart-contract/examples/*.json`
- `src/server.ts`
- `src/send-chart-request.ts`

### BHRA-Importer integration points

- `src/index.ts` (Express bootstrap + root route)
- `views/index.ejs` (current UI page)
- `src/db/Database.ts` (pool + query transaction helper)
- `src/config.ts` (env and path config)
- `sql/chart-procs-and-seed.sql` (already chart-related DB seed/procs)

## File-By-File Migration Matrix

### Slice 1: Contract and examples

1. Source: `CodexCharts/chart-contract/chart-request.schema.json`
  Target: `BHRA-Importer/chart-contract/chart-request.schema.json`
  Action: copy and keep schema as primary request contract.

2. Source: `CodexCharts/chart-contract/chart-request.template.json`
  Target: `BHRA-Importer/chart-contract/chart-request.template.json`
  Action: copy and tune defaults for BHRA stored procedures.

3. Source: `CodexCharts/chart-contract/examples/*.json`
  Target: `BHRA-Importer/chart-contract/examples/*.json`
  Action: copy examples, then replace procedure names with BHRA equivalents.

### Slice 2: Stored-procedure API route

1. Source: logic in `CodexCharts/src/server.ts` (`/api/stored-proc`)
  Target: add route in `BHRA-Importer/src/index.ts` (or split into new route module)
  Action: port only stored-proc endpoint logic, not unrelated test pages.

2. Source: helper behavior in `CodexCharts/src/server.ts`
  Target: new utility in `BHRA-Importer/src/utils` (recommended: stored-proc helper)
  Action: migrate `parseParams`, `buildCallSql`, and result-set extraction behavior.

3. Source: DB pool usage in `CodexCharts/src/server.ts`
  Target: `BHRA-Importer/src/db/Database.ts`
  Action: use BHRA database class as the single execution path.

### Slice 3: Request builder and exporter CLI

1. Source: `CodexCharts/src/send-chart-request.ts`
  Target: `BHRA-Importer/src/send-chart-request.ts` (or `src/export/send-chart-request.ts`)
  Action: port validator + request loader + request sender logic.

2. Source: schema reference usage in `CodexCharts/src/send-chart-request.ts`
  Target: BHRA chart-contract path
  Action: keep relative paths accurate for BHRA root layout.

3. Source: output handling in `CodexCharts/src/send-chart-request.ts`
  Target: BHRA output folder policy (recommended new folder: `public/charts/generated`)
  Action: keep HTML-first generation and deterministic file naming.

### Slice 4: UI integration for categorized exports

1. Source: chart trigger ideas from `CodexCharts` flow
  Target: `BHRA-Importer/views/index.ejs`
  Action: add first-section UI controls (category, table/query, export type, generate action).

2. Source: Express render route patterns in both projects
  Target: `BHRA-Importer/src/index.ts`
  Action: pass category/query metadata to EJS view and add export endpoints.

3. Source: existing chart artifact location in BHRA (`public/charts`)
  Target: keep `public/charts` and add `generated` subfolder if needed
  Action: continue serving generated files via static middleware already configured.

### Slice 5: SQL metadata alignment

1. Source: BHRA SQL baseline already present in `BHRA-Importer/sql/chart-procs-and-seed.sql`
  Target: same file
  Action: align request-template defaults to seeded chart metadata (`code`, proc name, params).

2. Source: Codex mapping expectations (`xField`, `yField`, `categoryField`, `valueField`)
  Target: BHRA chart query metadata tables/procs
  Action: ensure stored-proc outputs include mapped columns used by each chart type.

## Recommended Execution Order

1. Create `chart-contract` folder in BHRA and copy schema/template/examples.
2. Add `/api/stored-proc` route in BHRA using current DB service.
3. Port request validator/builder CLI.
4. Prove one end-to-end line chart HTML export.
5. Add UI controls for categorized exports.
6. Add remaining chart/export categories incrementally.

## BHRA-Specific Notes

1. BHRA already has chart outputs in `public/charts` including `.html` and `.png`; migration baseline should keep HTML default and treat PNG as optional legacy.
2. BHRA already contains chart-focused SQL definitions, which reduces migration risk for data-source setup.
3. BHRA app currently runs a file-watch import workflow through `WatchController`; keep export/chart routes isolated so import processing behavior is unaffected.

## Risks And Controls

1. Risk: route-level coupling between importer watcher flow and new export flow.
  Control: isolate export routes/services and avoid modifying watcher internals initially.

2. Risk: mismatch between stored-proc result columns and mapping fields.
  Control: add pre-render mapped-field validation and explicit error messages.

3. Risk: output sprawl in `public/charts`.
  Control: introduce deterministic generated naming and optional subfolder partitioning.

4. Risk: scope creep into non-HTML outputs during baseline migration.
  Control: freeze first release on HTML output parity.

## Acceptance Checklist

1. BHRA user can choose category/table/export mode from the first UI section.
2. Request validates against schema before execution.
3. Stored procedure runs and correct result set is selected.
4. HTML output file is generated and directly viewable.
5. Validation and runtime errors are user-readable.
6. Existing BHRA import watcher behavior remains intact.

## Next-Step Migration Wave (After Baseline)

1. Add CSV/XLSX export parity from contract mode where required.
2. Add result history listing and retention policy for generated chart files.
3. Optionally reintroduce PNG/SVG/PDF rendering behind explicit output mode.
