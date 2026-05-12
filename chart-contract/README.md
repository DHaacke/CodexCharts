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
4. Set `output.format` to one of `html`, `csv`, or `xlsx`.
5. Optionally set `appearance` to control page background, card colors, and chart series palette.
6. Optionally set `output.width` and `output.height` to control the rendered chart card size. If omitted, the page uses the available viewport width and height.

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
- Keeps visual styling in JSON via optional `appearance` for repeatable branding.

## Label templates

You can optionally set `mapping.labelTemplate` when you want display labels to include more than one field. This is especially useful for pie chart legends and tooltips.

Example:

```json
"mapping": {
  "categoryField": "species",
  "valueField": "abundance",
  "labelTemplate": "{species} {year}"
}
```

Behavior:

- Placeholders use row field names from the stored procedure result.
- If a placeholder is not present on the row, renderer falls back to matching `proc_params` when possible.
- If `labelTemplate` is omitted, renderer uses the normal category field label.

## Appearance options

Add an optional `appearance` object at the top level of your request to control all styling:

- `page_background`: CSS background value for the page/card scene.
- `card_background`: card fill color behind chart area.
- `title_color`: chart title and heading color.
- `text_color`: supporting text color.
- `axis_color`: preferred axis/tick color hint for renderer.
- `grid_color`: preferred grid/border color hint for renderer.
- `x_axis_label_color`: color for the x-axis label/title (defaults to dark forest #184f3f).
- `x_axis_value_color`: color for x-axis tick values (defaults to soft ink #2f6f5d).
- `y_axis_label_color`: color for the y-axis label/title (defaults to dark forest #184f3f).
- `y_axis_value_color`: color for y-axis tick values (defaults to soft ink #2f6f5d).
- `legend_text_color`: color for legend labels and text (defaults to dark forest #184f3f).
- `series_colors`: array of dataset colors (applied in order, cycled as needed).

Named colors are supported and resolved via `scripts/colors.js` (for example `forestdark`, `forestsoft`, `chartblue`, `cardlight`). You can also keep using standard CSS colors or direct hex/rgba values.

Example:

```json
"appearance": {
  "page_background": "linear-gradient(145deg, softmintlight, softmint)",
  "card_background": "cardlight",
  "title_color": "forestdark",
  "text_color": "forestsoft",
  "axis_color": "forestdark",
  "grid_color": "rgba(24,79,63,0.2)",
  "x_axis_label_color": "forestdark",
  "x_axis_value_color": "forestsoft",
  "y_axis_label_color": "forestdark",
  "y_axis_value_color": "forestsoft",
  "legend_text_color": "forestdark",
  "series_colors": ["chartblue", "chartorange", "chartgreen", "chartmauve"]
}
```

**Sensible defaults:**
If any appearance fields are omitted during processing, the system uses safe defaults: dark forest tones for labels, soft ink for values, matching the existing color palette. The gradient backgrounds and card styling remain consistent with the professional theme.



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
- For `html`, posts the payload to a Codex-compatible endpoint and writes returned HTML/text.
- For `csv`/`xlsx`, calls the stored-procedure endpoint and writes tabular export output.

### Setup

```bash
npm install
npm run build
```

### Environment variables

- `OPENAI_API_KEY` or `OPEN_AI_KEY` (required for `html` output)
- `CODEX_API_URL` (optional, default: `https://api.openai.com/v1/responses`)
- `CODEX_MODEL` (optional, default: `gpt-5.3-codex`)
- `STORED_PROC_BASE_URL` (optional, default: `http://localhost:3000`, used for `csv`/`xlsx` when `data_source.endpoint` is relative)

The CLI auto-loads `.env`, so you do not need to export variables manually if your `.env` file is set.

`OPENAI_API_KEY` is only required when `output.format` is `html`.

### Run the line example and get a chart file

```bash
npm run run:chart -- --request chart-contract/examples/line.stored-proc.example.json --out chart-contract/output/line-chart.html
```

If the API returns HTML/text successfully, the chart is saved to:

- `chart-contract/output/line-chart.html`

You can then open it in a browser.

### Open output automatically (optional)

Use one of these flags on any generator command:

- --open-output
- --open-latest (alias)

Examples:

- npm run run:line-series:csv -- --open-output
- npm run run:line-series:xlsx:all -- --open-output
- npm run run:line -- --open-latest

When enabled, the CLI opens the generated timestamped file after it is saved.

## Run Profiles

Use these copy/paste command profiles for common workflows.

### 1) Generate Only

Single chart HTML:

```bash
npm run run:line
```

Single chart CSV:

```bash
npm run run:line-series:csv
```

Single chart XLSX:

```bash
npm run run:line-series:xlsx
```

### 2) Generate + Open Output

Single chart HTML + open:

```bash
npm run run:line -- --open-output
```

Single chart CSV + open:

```bash
npm run run:line-series:csv -- --open-output
```

Single chart XLSX + open:

```bash
npm run run:line-series:xlsx -- --open-output
```

### 3) Generate All + Open Output

These commands start the local API server, generate output, and open the generated file.

Line:

```bash
npm run run:line:all -- --open-output
```

Line series (HTML):

```bash
npm run run:line-series:all -- --open-output
```

Line series (CSV):

```bash
npm run run:line-series:csv:all -- --open-output
```

Line series (XLSX):

```bash
npm run run:line-series:xlsx:all -- --open-output
```

Bar:

```bash
npm run run:bar:all -- --open-output
```

Pie:

```bash
npm run run:pie:all -- --open-output
```

Scatter:

```bash
npm run run:scatter:all -- --open-output
```

### Run CSV export

```bash
npm run run:chart -- --request chart-contract/examples/line.series.csv.example.json --out chart-contract/output/line-series-data.csv
```

Output filename is automatically timestamped, for example:

- `chart-contract/output/line-series-data-26-05-12-1423.csv`

### Run Excel export

```bash
npm run run:chart -- --request chart-contract/examples/line.series.xlsx.example.json --out chart-contract/output/line-series-data.xlsx
```

Output filename is automatically timestamped, for example:

- `chart-contract/output/line-series-data-26-05-12-1423.xlsx`

## Tabular Export Options (CSV/XLSX)

Use `export_options` to control column order and workbook sheets:

- `column_order`: Columns to place first in CSV/XLSX output.
- `include_remaining_columns`: When `true` (default), appends all remaining row columns after `column_order`.
- `xlsx.result_set_indices`: List of stored-procedure result set indices to export into separate worksheets.
- `xlsx.sheet_names`: Optional map from result-set index to worksheet name.
- `xlsx.sheet_name`: Optional worksheet name for single-sheet exports.
- `xlsx.sheet_name_prefix`: Prefix for unnamed sheets in multi-sheet mode (default: `Result`).

Example:

```json
"export_options": {
  "column_order": ["date", "series", "cfs"],
  "include_remaining_columns": true,
  "xlsx": {
    "result_set_indices": [0, 1],
    "sheet_names": {
      "0": "WaterYear",
      "1": "Average"
    },
    "sheet_name_prefix": "Result"
  }
}
```

## Implemented Export Behavior (May 12, 2026)

This is now fully implemented in the CLI exporter:

- `output.format = "csv"`:
  - Fetches stored-procedure rows from `data_source`.
  - Writes a CSV with headers.
  - Applies `export_options.column_order` first.
  - Appends remaining columns when `export_options.include_remaining_columns` is `true`.

- `output.format = "xlsx"`:
  - Fetches stored-procedure rows from `data_source`.
  - Single-sheet mode: uses `export_options.xlsx.sheet_name` (or defaults to `Data`).
  - Multi-sheet mode: when `export_options.xlsx.result_set_indices` has multiple values, writes one worksheet per result set.
  - Uses `export_options.xlsx.sheet_names` for per-index naming and `sheet_name_prefix` for unnamed sheets.
  - Applies `export_options.column_order` and `include_remaining_columns` to every worksheet.

- `output.format = "html"`:
  - Existing Codex rendering path is unchanged.
  - Continues to apply chart theming and renderer instructions.

## Output Filename Timestamping

All generated outputs (HTML/CSV/XLSX) append a timestamp before the extension using:

- `-YY-MM-DD-HHmm`

Examples:

- `line-chart-26-05-12-1423.html`
- `line-series-data-26-05-12-1423.csv`
- `line-series-data-26-05-12-1423.xlsx`

### Validation commands used

```bash
npm run build
npm run run:line-series:csv:all
npm run run:line-series:xlsx:all
```

### Workbook verification command

```bash
node -e "const XLSX=require('xlsx');const wb=XLSX.readFile('chart-contract/output/line-series-data.xlsx');console.log('Sheets:',wb.SheetNames.join(', '));for(const n of wb.SheetNames){const ws=wb.Sheets[n];const rows=XLSX.utils.sheet_to_json(ws,{header:1});console.log(n,'header=',JSON.stringify(rows[0]||[]),'rows=',Math.max((rows.length||1)-1,0));}"
```

Expected verification output for current example:

- Sheets: `WaterYear`, `Average`
- Header order: `date`, `series`, `cfs`, `sort`
- Row counts: `730` and `730`
