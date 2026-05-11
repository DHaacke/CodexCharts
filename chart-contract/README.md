# Codex Chart Request Contract

This folder gives you a manual-first JSON contract you can edit and send to Codex API to generate chart output.

## Files

- `chart-request.template.json`: Master editable request template.
- `chart-request.schema.json`: JSON Schema for validation.
- `examples/*.json`: Working starter payloads by chart type.

## Recommended flow

1. Copy `chart-request.template.json` to a new payload file.
2. Set `chart.type` and update `mapping` fields to match your result columns.
3. Set stored procedure details in `data_source`.
4. Set `output.format` to `html` now, with optional future `svg` or `pdf`.

### Endpoint/method override for your backend

If your backend route is not the default generated path, set these optional fields under `data_source`:

- `endpoint` (example: `/api/data/procedure`)
- `endpoint` (example: `/api/stored-proc`)
- `http_method` (`POST` or `GET`)

Behavior expected by generator:

- `POST`: sends JSON body with `proc_schema`, `proc_name`, `proc_params`, `result_set_index`
- `GET`: sends those values as query string parameters

## Why this shape is easier to maintain

- Separates `data_source` (where data comes from) from `mapping` (how data is charted).
- Keeps chart library options in `options` as native JSON (not escaped JSON string).
- Uses stored procedure execution as the single source of chart data.

## Alternative design options

### Option A: One universal object (current files)

Pros:
- One payload format for all chart types.
- Easy for manual editing and later automation.

Cons:
- Some fields are irrelevant depending on chart type.

### Option B: Type-specific payloads

Use separate contracts for line/bar/pie/scatter.

Pros:
- Stronger per-chart validation.
- Smaller payloads.

Cons:
- More maintenance and more code paths.

### Option C: SQL-first contract

Replace stored procedure fields with a named query ID and parameter bag.

Pros:
- Better control and security over what can be executed.

Cons:
- Requires backend query registry.

## Notes for MySQL stored procedures

- Keep procedure names allow-listed server-side.
- Validate and sanitize `proc_params`.
- Enforce max row limits to prevent oversized chart payloads.
- Use `result_set_index` when procedures return multiple result sets.

## Minimal payload (example)

```json
{
  "request_version": "1.0",
  "output": { "format": "html", "container_id": "chart-root" },
  "chart": { "type": "bar", "title": "Sales", "show_legend": true },
  "data_source": {
    "proc_schema": "ri",
    "proc_name": "sp_sales",
    "proc_params": { "year": 2026 },
    "result_set_index": 0
  },
  "mapping": {
    "categoryField": "category_name",
    "valueField": "sales_total"
  },
  "options": {}
}
```

## TypeScript Validator + Request Builder

This workspace includes a small CLI at `src/send-chart-request.ts` that:

- Loads a request JSON file.
- Validates it against `chart-contract/chart-request.schema.json`.
- Applies one runtime rule for scatter (`mapping.xField` and `mapping.yField` are required).
- Posts the payload to a Codex-compatible endpoint.
- Writes the returned HTML/text to an output file.

### Setup

```bash
npm install
npm run build
```

### Environment variables

- `OPENAI_API_KEY` or `OPEN_AI_KEY` (required)
- `CODEX_API_URL` (optional, default: `https://api.openai.com/v1/responses`)
- `CODEX_MODEL` (optional, default: `gpt-5.3-codex`)

The CLI auto-loads `.env`, so you do not need to export variables manually if your `.env` file is set.

### Run the line example and get a chart file

```bash
npm run run:chart -- --request chart-contract/examples/line.stored-proc.example.json --out chart-contract/output/line-chart.html
```

If the API returns HTML/text successfully, the chart is saved to:

- `chart-contract/output/line-chart.html`

You can then open it in a browser.
