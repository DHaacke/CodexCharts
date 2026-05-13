# CodexCharts Reusable Skills (Node + Express + TypeScript + ChartJS + MySQL)

This file captures practical patterns learned in this project so they can be reused in BHRA-Importer and future apps.

## 1. Architecture Skills

### Express + TypeScript service patterns
- Build small, clear route handlers in `src/`.
- Keep request validation and business logic separate from transport concerns.
- Return useful HTTP errors with actionable messages.

### Data-to-chart pipeline
- Gather data from MySQL stored procedures.
- Normalize dataset columns to a chart-friendly shape.
- Build ChartJS config from request contract metadata.
- Render chart HTML output for browser and file export workflows.

### Contract-first design
- Use JSON Schema in `chart-contract/` as the source of truth.
- Validate request payloads before data fetch and chart build.
- Keep examples in `chart-contract/examples/` aligned with schema changes.

## 2. Chart Contract Skills

### Preferred request model
- Keep chart configuration explicit (title, axes, legend, chart type).
- Keep stored procedure info explicit (`proc_schema`, `proc_name`, `result_set_index`, `proc_params`).
- Keep chart mapping options in JSON (`options_json`) for flexible field mapping.

### Current project preference
- Use stored procedure mode as default source of data.
- Do not require inline `dataset` for normal flow.
- Avoid hard allow-lists for `proc_schema` and `proc_name` unless required by policy.

### Output preference
- Primary output is HTML.
- Keep schema and code paths extensible for SVG/PDF later.

## 3. ChartJS Skills

### Supported chart families
- Line
- Bar (including grouped/stacked patterns)
- Pie
- Scatter

### Mapping patterns
- Common flexible keys: `xField`, `yField`, `groupField`, `valueField`, `categoryField`.
- Keep mapping names consistent across examples and docs.
- For scatter charts, prefer a single naming strategy in contract and template logic.

## 4. MySQL Skills

### Stored procedure execution patterns
- Call procedures using explicit schema and name values.
- Support `result_set_index` for procedures returning multiple result sets.
- Pass procedure parameters using predictable key/value naming.

### Reliability patterns
- Validate request payload before database calls.
- Validate requested result set exists before chart generation.
- Return clear errors for missing columns required by mapping options.

## 5. API + JSON Handling Skills

### External API integration
- Use `axios` (or equivalent) with timeout and error handling.
- Normalize external response JSON before chart mapping.

### JSON safety
- Parse `options_json` defensively.
- Emit targeted validation errors instead of generic failures.

## 6. OpenAI Integration Skills

### Safe usage
- Store keys in `.env`.
- Never place real API keys in files, commits, or prompts.
- Keep request/response handling isolated so it can be swapped or mocked.

### Typical usage
- Generate or refine chart request payloads from user intent.
- Validate generated payloads against JSON Schema before execution.

## 7. Migration Skills (CodexCharts -> BHRA-Importer)

### Recommended migration strategy
- Migrate by capability slices instead of file-copying everything.
- Start with contract + validator + request builder.
- Add stored-procedure export execution.
- Add HTML chart generation and file output.
- Integrate UI workflow for categorized export choices.

### Avoid during migration
- Avoid tight coupling between UI and chart engine internals.
- Avoid introducing output formats beyond HTML until baseline behavior is stable.
- Avoid broad refactors in first migration pass.

## 8. Baseline Dependency Set

Install as needed per project scope:

```sh
npm install express ejs typescript ts-node @types/node @types/express mysql2 chart.js axios openai dotenv ajv
```

## 9. Starter Operational Commands

```sh
npm install
npm run build
npm run dev
```

If no `dev` script exists, use project-specific run command.

## 10. Working Rules From This Project

- Default output target: HTML.
- Keep schema examples current with real request flows.
- Use TypeScript validator + request builder for every contract-driven request path.
- Treat migration as additive and reversible: verify each slice before moving to next.
