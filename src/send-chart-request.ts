import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import Ajv2020 from "ajv/dist/2020";
import dotenv from "dotenv";
import * as XLSX from "xlsx";

interface ChartRequest {
  request_version: string;
  output: {
    format: "html" | "csv" | "xlsx";
    container_id: string;
    width?: number;
    height?: number;
    theme?: "light" | "dark" | "auto";
  };
  chart: {
    type: "line" | "bar" | "pie" | "scatter";
    title: string;
    subtitle?: string;
    show_legend: boolean;
    x_axis_label?: string;
    y_axis_label?: string;
    stacked?: boolean;
  };
  data_source: {
    proc_schema: string;
    proc_name: string;
    endpoint?: string;
    http_method?: "GET" | "POST";
    proc_params?: Record<string, string | number | boolean | null>;
    result_set_index: number;
  };
  mapping: {
    xField?: string;
    yField?: string;
    groupField?: string;
    categoryField?: string;
    valueField?: string;
  };
  options?: Record<string, unknown>;
  appearance?: {
    page_background?: string;
    card_background?: string;
    title_color?: string;
    text_color?: string;
    axis_color?: string;
    grid_color?: string;
    x_axis_label_color?: string;
    x_axis_value_color?: string;
    y_axis_label_color?: string;
    y_axis_value_color?: string;
    legend_text_color?: string;
    series_colors?: string[];
  };
  notes?: string;
  export_options?: {
    column_order?: string[];
    include_remaining_columns?: boolean;
    xlsx?: {
      sheet_name?: string;
      result_set_indices?: number[];
      sheet_names?: Record<string, string>;
      sheet_name_prefix?: string;
      template_path?: string;
      template_sheet_name?: string;
    };
  };
}

interface CodexResponse {
  status?: string;
  output_text?: string;
  output_html?: string;
  [key: string]: unknown;
}

type DataRow = Record<string, unknown>;

type ColorLookup = Record<string, string>;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[idx + 1];
}

function hasArgFlag(...flags: string[]): boolean {
  return flags.some((flag) => process.argv.includes(flag));
}

function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    fail(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    fail(`Invalid JSON in ${filePath}: ${(err as Error).message}`);
  }
}

function validateAgainstSchema(request: unknown, schema: object): ChartRequest {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile<ChartRequest>(schema);
  const ok = validate(request);
  if (!ok) {
    const errors = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? "validation error"}`)
      .join("\n");
    fail(`Schema validation failed:\n${errors}`);
  }
  return request as ChartRequest;
}

function validateScatterNumericMapping(request: ChartRequest): void {
  if (request.chart.type !== "scatter") {
    return;
  }

  if (!request.mapping.xField || !request.mapping.yField) {
    fail("Scatter charts require mapping.xField and mapping.yField.");
  }
}

function validateRequiredMappings(request: ChartRequest): void {
  const mapping = request.mapping;

  if (request.chart.type === "line" || request.chart.type === "scatter") {
    if (!mapping.xField || !mapping.yField) {
      fail(`${request.chart.type} charts require mapping.xField and mapping.yField.`);
    }
    return;
  }

  if (request.chart.type === "bar" || request.chart.type === "pie") {
    if (!mapping.categoryField || !mapping.valueField) {
      fail(`${request.chart.type} charts require mapping.categoryField and mapping.valueField.`);
    }
  }
}

function loadColorLookup(): ColorLookup {
  const colorFilePath = path.resolve(process.cwd(), "scripts/colors.js");

  if (!fs.existsSync(colorFilePath)) {
    return {};
  }

  const loaded = require(colorFilePath) as unknown;
  if (!loaded || typeof loaded !== "object") {
    return {};
  }

  const lookup: ColorLookup = {};
  for (const [key, value] of Object.entries(loaded as Record<string, unknown>)) {
    if (typeof value !== "string") {
      continue;
    }
    lookup[key.toLowerCase()] = value;
  }

  return lookup;
}

function resolveColorNamesInString(value: string | undefined, colorLookup: ColorLookup): string | undefined {
  if (!value || Object.keys(colorLookup).length === 0) {
    return value;
  }

  return value.replace(/\b([A-Za-z][A-Za-z0-9_-]*)\b/g, (token) => {
    const resolved = colorLookup[token.toLowerCase()];
    return resolved ?? token;
  });
}

function resolveAppearanceColors(request: ChartRequest, colorLookup: ColorLookup): ChartRequest {
  if (!request.appearance) {
    return request;
  }

  const appearance = request.appearance;
  const resolvedAppearance = {
    ...appearance,
    page_background: resolveColorNamesInString(appearance.page_background, colorLookup),
    card_background: resolveColorNamesInString(appearance.card_background, colorLookup),
    title_color: resolveColorNamesInString(appearance.title_color, colorLookup),
    text_color: resolveColorNamesInString(appearance.text_color, colorLookup),
    axis_color: resolveColorNamesInString(appearance.axis_color, colorLookup),
    grid_color: resolveColorNamesInString(appearance.grid_color, colorLookup),
    x_axis_label_color: resolveColorNamesInString(appearance.x_axis_label_color, colorLookup),
    x_axis_value_color: resolveColorNamesInString(appearance.x_axis_value_color, colorLookup),
    y_axis_label_color: resolveColorNamesInString(appearance.y_axis_label_color, colorLookup),
    y_axis_value_color: resolveColorNamesInString(appearance.y_axis_value_color, colorLookup),
    legend_text_color: resolveColorNamesInString(appearance.legend_text_color, colorLookup),
    series_colors: appearance.series_colors?.map((entry) => resolveColorNamesInString(entry, colorLookup) ?? entry)
  };

  return {
    ...request,
    appearance: resolvedAppearance
  };
}

function buildCodexPayload(chartRequest: ChartRequest, model: string): Record<string, unknown> {
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are a chart renderer. Return ONLY a complete HTML document that renders the chart from the provided chart request JSON. Do not include markdown fences. Never include hardcoded mock/fallback rows (for example Trout/Salmon/Pike or any fabricated sample data). Use only data fetched from the configured stored-procedure endpoint. Respect mapping field names exactly as provided, including case. Add a runtime guard before chart creation: verify at least one returned row contains every mapped field required by the chart type, and if any are missing, show an error listing missing field names and stop rendering. Endpoint behavior: if data_source.endpoint is provided, fetch that URL; otherwise use /api/stored-proc. If data_source.http_method is provided, use it; otherwise use POST. For POST, send JSON body with proc_schema, proc_name, proc_params, result_set_index. For GET, send those values as query string parameters and do not send a body. At the top of the page, render a compact visible transport summary that shows the endpoint, method, and proc_name. If fetch fails, render a visible error message that includes status code and method+endpoint. If appearance.series_colors is present, apply those colors to datasets in order (cycle if needed) using borderColor and backgroundColor. If appearance.axis_color or appearance.grid_color is present, apply those to scales/ticks/grid where applicable. If appearance.x_axis_label_color is present, apply it to the x-axis title. If appearance.x_axis_value_color is present, apply it to the x-axis tick labels (value labels). If appearance.y_axis_label_color is present, apply it to the y-axis title. If appearance.y_axis_value_color is present, apply it to the y-axis tick labels (value labels). If appearance.legend_text_color is present, apply it to legend labels and text. If options.borderWidth is present, apply it to all line datasets as the line stroke width. For line charts with date/timestamp x-values and mapping.x_axis_tick_format present, use type:'time' for the x-axis scale and convert all x-values to numeric millisecond timestamps using new Date(xValue).getTime(). If mapping.x_axis_tick_format is 'abbreviated_month', format x-axis tick labels to show abbreviated month names (Jan, Feb, etc) positioned at the start of each month. If chart.show_data_labels is true, display the numeric values directly on bars (for bar/line charts) or slices (for pie charts). If chart.legend_position is provided, set the legend position to that value (top, bottom, left, right). If chart.animation_duration is present, set animations to that millisecond duration (0 disables animation). If chart.y_axis_min or chart.y_axis_max is present, set the y-axis minimum and/or maximum values accordingly. If options.border_radius is present and chart type is bar, apply rounded corners to bars with that radius value. If options.point_style is present, use that shape (circle, rect, triangle, star, etc.) for data point markers on scatter and line charts. If chart.show_grid is false, hide the grid by setting grid.display to false on all scales. If appearance.grid_style or chart.grid_style is present, apply color, borderWidth (width), and borderDash (dash_pattern) to grid lines. If mapping.labelTemplate is present, build display labels from it by replacing {fieldName} placeholders from each row, falling back to data_source.proc_params when needed. Use those computed labels for pie chart legend labels and tooltip labels, and for other chart types where a display label is needed."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(chartRequest)
          }
        ]
      }
    ]
  };
}

async function postToCodexApi(
  endpoint: string,
  apiKey: string,
  payload: Record<string, unknown>
): Promise<CodexResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    fail(`API request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as CodexResponse;
}

function extractHtmlFromResponse(result: CodexResponse): string {
  if (typeof result.output_html === "string" && result.output_html.trim().length > 0) {
    return result.output_html;
  }

  if (typeof result.output_text === "string" && result.output_text.trim().length > 0) {
    return result.output_text;
  }

  const output = result.output;
  if (Array.isArray(output)) {
    const textParts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }

        const text = (block as { text?: unknown }).text;
        if (typeof text === "string" && text.trim().length > 0) {
          textParts.push(text);
        }
      }
    }

    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  const fallback = JSON.stringify(result, null, 2);
  fail(`No HTML/text content found in API response. Raw response:\n${fallback}`);
}

function applyHtmlTransportOverrides(html: string, request: ChartRequest): string {
  const endpoint = request.data_source.endpoint;
  const method = request.data_source.http_method;
  const requestUrl = buildRequestUrl(request);

  let updated = html;

  updated = updated.replace(
    /const summaryEl\s*=\s*document\.getElementById\(['"]transport-summary['"]\);/,
    "const transportEl = document.getElementById('transport-summary');"
  );

  updated = updated.replace(/\bsummaryEl\b/g, "transportEl");

  if (endpoint && endpoint.trim().length > 0) {
    const escaped = endpoint.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    updated = updated.replace(/const endpoint\s*=\s*['"][^'"]+['"];/g, `const endpoint = '${escaped}';`);
  }

  if (method === "GET" || method === "POST") {
    updated = updated.replace(/method:\s*['"](GET|POST)['"]/g, `method: '${method}'`);
  }

  updated = updated.replace(
    /(?:summaryEl|transportEl)\.textContent\s*=\s*`[^`]*`;/,
    `transportEl.textContent = \`Endpoint: ${endpoint || "/api/stored-proc"} | Method: ${method || "POST"} | Proc: ${request.data_source.proc_name} | Request URL: ${requestUrl}\`;`
  );

  return updated;
}

function sanitizeCssToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    return undefined;
  }

  if (!/^[#(),.%\-\s\w]+$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function buildThemeVars(request: ChartRequest): string {
  const appearance = request.appearance ?? {};
  const vars: Array<[string, string]> = [];

  const pushIf = (name: string, value: string | undefined): void => {
    const sanitized = sanitizeCssToken(value);
    if (sanitized) {
      vars.push([name, sanitized]);
    }
  };

  pushIf("--custom-page-bg", appearance.page_background);
  pushIf("--custom-card-bg", appearance.card_background);
  pushIf("--custom-title", appearance.title_color);
  pushIf("--custom-text", appearance.text_color);
  pushIf("--custom-axis", appearance.axis_color);
  pushIf("--custom-grid", appearance.grid_color);
  pushIf("--custom-x-axis-label", appearance.x_axis_label_color);
  pushIf("--custom-x-axis-value", appearance.x_axis_value_color);
  pushIf("--custom-y-axis-label", appearance.y_axis_label_color);
  pushIf("--custom-y-axis-value", appearance.y_axis_value_color);
  pushIf("--custom-legend-text", appearance.legend_text_color);

  if (vars.length === 0) {
    return "";
  }

  return vars.map(([k, v]) => `${k}: ${v};`).join(" ");
}

function buildLayoutVars(request: ChartRequest): string {
  const requestedWidth =
    typeof request.output.width === "number" && Number.isFinite(request.output.width) && request.output.width >= 100
      ? `${request.output.width}px`
      : "calc(100vw - 64px)";

  const requestedCardHeight =
    typeof request.output.height === "number" && Number.isFinite(request.output.height) && request.output.height >= 100
      ? `${request.output.height}px`
      : "calc(100vh - 80px)";

  const requestedPlotHeight =
    typeof request.output.height === "number" && Number.isFinite(request.output.height) && request.output.height >= 100
      ? `calc(${request.output.height}px - 156px)`
      : "calc(100vh - 236px)";

  return `--requested-card-width: ${requestedWidth}; --requested-card-height: ${requestedCardHeight}; --requested-plot-height: ${requestedPlotHeight};`;
}

function getThemeMode(request: ChartRequest): "light" | "dark" | "auto" {
  const theme = request.output.theme;
  if (theme === "light" || theme === "dark" || theme === "auto") {
    return theme;
  }
  return "auto";
}

function applyProfessionalTheme(html: string, request: ChartRequest): string {
  if (html.includes("chart-theme-injected")) {
    return html;
  }

  const themeVars = buildThemeVars(request);
  const layoutVars = buildLayoutVars(request);
  const themeMode = getThemeMode(request);

  const themedHead = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet" />
  <style id="chart-theme-injected">
    :root {
      ${themeVars}
      ${layoutVars}
      --bg-a: #d7e7df;
      --bg-b: #bfd6ce;
      --card: rgba(243, 250, 246, 0.82);
      --ink: #184f3f;
      --ink-soft: #2f6f5d;
      --line: rgba(24, 79, 63, 0.2);
      --shadow: 0 28px 60px rgba(23, 58, 52, 0.22);
      --glow-a: rgba(255, 255, 255, 0.52);
      --glow-b: rgba(255, 255, 255, 0.4);
      --panel-bg: rgba(255, 255, 255, 0.7);
      --error-bg: rgba(255, 236, 236, 0.88);
      --error-border: rgba(167, 48, 48, 0.28);
      --error-text: #7f1d1d;
      --custom-x-axis-label: #184f3f;
      --custom-x-axis-value: #2f6f5d;
      --custom-y-axis-label: #184f3f;
      --custom-y-axis-value: #2f6f5d;
      --custom-legend-text: #184f3f;
    }

    body[data-theme='dark'] {
      --bg-a: #10221d;
      --bg-b: #0b1815;
      --card: rgba(19, 39, 34, 0.9);
      --ink: #d7ece5;
      --ink-soft: #b7d8ce;
      --line: rgba(143, 191, 174, 0.28);
      --shadow: 0 28px 60px rgba(2, 10, 8, 0.5);
      --glow-a: rgba(0, 0, 0, 0.22);
      --glow-b: rgba(0, 0, 0, 0.35);
      --panel-bg: rgba(12, 30, 25, 0.72);
      --error-bg: rgba(84, 28, 28, 0.55);
      --error-border: rgba(228, 119, 119, 0.4);
      --error-text: #ffd1d1;
      color-scheme: dark;
    }

    @media (prefers-color-scheme: dark) {
      body[data-theme='auto'] {
        --bg-a: #10221d;
        --bg-b: #0b1815;
        --card: rgba(19, 39, 34, 0.9);
        --ink: #d7ece5;
        --ink-soft: #b7d8ce;
        --line: rgba(143, 191, 174, 0.28);
        --shadow: 0 28px 60px rgba(2, 10, 8, 0.5);
        --glow-a: rgba(0, 0, 0, 0.22);
        --glow-b: rgba(0, 0, 0, 0.35);
        --panel-bg: rgba(12, 30, 25, 0.72);
        --error-bg: rgba(84, 28, 28, 0.55);
        --error-border: rgba(228, 119, 119, 0.4);
        --error-text: #ffd1d1;
        color-scheme: dark;
      }
    }

    html, body {
      min-height: 100%;
    }

    body {
      margin: 0;
      font-family: "Source Sans 3", "Segoe UI", sans-serif !important;
      color: var(--ink);
      display: block !important;
      align-items: initial !important;
      justify-content: initial !important;
      background:
        radial-gradient(circle at 8% 0%, var(--glow-a), transparent 38%),
        radial-gradient(circle at 90% 100%, var(--glow-b), transparent 35%),
        var(--custom-page-bg, linear-gradient(145deg, var(--bg-a), var(--bg-b))) !important;
      padding: clamp(16px, 2.5vw, 34px);
      box-sizing: border-box;
    }

    .page-shell {
      width: min(var(--requested-card-width), calc(100vw - 32px));
      max-width: none;
      margin: 0 auto;
    }

    .wrap {
      max-width: none !important;
      width: 100%;
      margin: 0 !important;
      padding: 0 !important;
    }

    .chart-card {
      background: var(--custom-card-bg, var(--card));
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      min-height: min(var(--requested-card-height), calc(100vh - 32px));
      padding: clamp(14px, 2.5vw, 28px);
      backdrop-filter: blur(2px);
      box-sizing: border-box;
    }

    h1, h2, h3, .chart-title, canvas + div {
      font-family: "Merriweather", Georgia, serif !important;
      color: var(--custom-title, var(--ink)) !important;
    }

    #transport-summary {
      font-size: 13px !important;
      font-weight: 600;
      color: var(--custom-text, var(--ink-soft)) !important;
      background: var(--panel-bg) !important;
      border: 1px solid var(--line) !important;
      border-radius: 10px !important;
      padding: 8px 12px !important;
      margin-bottom: 12px !important;
    }

    #error {
      border-radius: 10px !important;
      border: 1px solid var(--error-border) !important;
      background: var(--error-bg) !important;
      color: var(--error-text) !important;
    }

    .card {
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      margin: 0 !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      padding: clamp(16px, 1.8vw, 24px) !important;
      backdrop-filter: none !important;
      box-sizing: border-box;
    }

    .canvas-wrap {
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
    }

    #chart-wrap {
      width: 100% !important;
      min-height: min(72vh, 740px);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.34);
      border: 1px solid var(--custom-grid, var(--line));
      padding: clamp(8px, 1.4vw, 16px);
      box-sizing: border-box;
    }

    #chart-wrap canvas,
    canvas#chart-root,
    #chart-root {
      width: 100% !important;
      height: max(280px, min(var(--requested-plot-height), calc(100vh - 220px))) !important;
      display: block;
    }

    #chartCanvas {
      width: 100% !important;
      height: 100% !important;
      display: block;
    }

    @media (max-width: 700px) {
      :root {
        --requested-card-width: calc(100vw - 24px);
      }

      #chart-wrap canvas,
      canvas#chart-root,
      #chart-root {
        height: max(240px, min(var(--requested-plot-height), calc(100vh - 180px))) !important;
      }
    }
  </style>`;

  let themed = html.replace(/<\/head>/i, `${themedHead}\n</head>`);

  themed = themed.replace(/<body([^>]*)>/i, `<body$1 data-theme="${themeMode}"><div class="page-shell"><div class="chart-card">`);
  themed = themed.replace(/<\/body>/i, "</div></div></body>");

  return themed;
}

function ensureChartJsTimeAdapter(html: string): string {
  const usesTimeScale = /type:\s*['"]time['"]/.test(html);
  const hasAdapter = /chartjs-adapter-date-fns|chartjs-adapter-luxon|chartjs-adapter-moment/i.test(html);

  if (!usesTimeScale || hasAdapter) {
    return html;
  }

  return html.replace(
    /<script\s+src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^>]*><\/script>/i,
    (match) => `${match}\n  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>`
  );
}

function normalizeAbbreviatedMonthTicks(html: string): string {
  const fragileCallbackPattern =
    /if \(xTickFormat === 'abbreviated_month'\) \{\s*const d = new Date\(value\);\s*if \(d\.getDate\(\) === 1\) return monthFmt\.format\(d\);\s*return '';\s*\}/g;

  let normalized = html.replace(
    fragileCallbackPattern,
    [
      "if (xTickFormat === 'abbreviated_month') {",
      "                    const label = typeof this.getLabelForValue === 'function' ? this.getLabelForValue(value) : String(value);",
      "                    const d = new Date(label);",
      "                    if (!Number.isFinite(d.getTime())) return '';",
      "                    const prevLabel = Number(value) > 0 && typeof this.getLabelForValue === 'function' ? this.getLabelForValue(Number(value) - 1) : null;",
      "                    const prev = prevLabel ? new Date(prevLabel) : null;",
      "                    const monthChanged = !prevLabel || !prev || !Number.isFinite(prev.getTime()) || prev.getMonth() !== d.getMonth() || prev.getFullYear() !== d.getFullYear();",
      "                    return monthChanged ? monthFmt.format(d) : '';",
      "                  }"
    ].join("\n")
  );

  normalized = normalized.replace(
    /time:\s*\{\s*unit:\s*'day'\s*\},/g,
    "time: mapping.x_axis_tick_format === 'abbreviated_month' ? { unit: 'month' } : { unit: 'day' },"
  );

  normalized = normalized.replace(
    /\.map\(p => \(\{ x: p\.xRaw, y: p\.y, _label:/g,
    ".map(p => ({ x: new Date(p.xRaw).getTime(), y: p.y, _label:"
  );

  return normalized;
}

function buildRequestUrl(request: ChartRequest): string {
  const endpoint = request.data_source.endpoint || "/api/stored-proc";
  const method = (request.data_source.http_method || "POST").toUpperCase();

  if (method !== "GET") {
    return endpoint;
  }

  const url = new URL(endpoint, "https://example.invalid");
  url.searchParams.set("proc_schema", request.data_source.proc_schema);
  url.searchParams.set("proc_name", request.data_source.proc_name);
  url.searchParams.set("result_set_index", String(request.data_source.result_set_index ?? 0));
  
  // Expand proc_params as individual query params (proc_params.key=value)
  const procParams = request.data_source.proc_params ?? {};
  Object.entries(procParams).forEach(([k, v]) => {
    url.searchParams.set(`proc_params.${k}`, v == null ? "" : String(v));
  });
  
  return `${url.pathname}${url.search}`;
}

function buildStoredProcUrlForNode(request: ChartRequest, resultSetIndex: number): string {
  const method = (request.data_source.http_method || "POST").toUpperCase();
  const endpoint = request.data_source.endpoint || "/api/stored-proc";
  const baseUrl = process.env.STORED_PROC_BASE_URL ?? "http://localhost:3000";
  const absoluteEndpoint = /^https?:\/\//i.test(endpoint) ? endpoint : new URL(endpoint, baseUrl).toString();

  if (method !== "GET") {
    return absoluteEndpoint;
  }

  const url = new URL(absoluteEndpoint);
  url.searchParams.set("proc_schema", request.data_source.proc_schema);
  url.searchParams.set("proc_name", request.data_source.proc_name);
  url.searchParams.set("result_set_index", String(resultSetIndex));

  const procParams = request.data_source.proc_params ?? {};
  Object.entries(procParams).forEach(([k, v]) => {
    url.searchParams.set(`proc_params.${k}`, v == null ? "" : String(v));
  });

  return url.toString();
}

function toDataRows(value: unknown): DataRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((row): row is DataRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({ ...row }));
}

function extractRowsFromStoredProcResponse(payload: unknown): DataRow[] {
  if (Array.isArray(payload)) {
    return toDataRows(payload);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = payload as { rows?: unknown; data?: unknown };
  const rows = toDataRows(candidate.rows);
  if (rows.length > 0) {
    return rows;
  }

  return toDataRows(candidate.data);
}

async function fetchStoredProcRows(request: ChartRequest, resultSetIndex: number): Promise<DataRow[]> {
  const method = (request.data_source.http_method || "POST").toUpperCase();
  const url = buildStoredProcUrlForNode(request, resultSetIndex);

  const requestInit: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (method === "POST") {
    requestInit.body = JSON.stringify({
      proc_schema: request.data_source.proc_schema,
      proc_name: request.data_source.proc_name,
      proc_params: request.data_source.proc_params ?? {},
      result_set_index: resultSetIndex
    });
  }

  const response = await fetch(url, requestInit);
  if (!response.ok) {
    const body = await response.text();
    fail(`Stored-procedure request failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as unknown;
  return extractRowsFromStoredProcResponse(json);
}

function getPreferredColumns(request: ChartRequest): string[] {
  const explicit = request.export_options?.column_order ?? [];
  if (explicit.length > 0) {
    return Array.from(new Set(explicit.filter((c) => typeof c === "string" && c.trim().length > 0)));
  }

  const values = [
    request.mapping.xField,
    request.mapping.yField,
    request.mapping.groupField,
    request.mapping.categoryField,
    request.mapping.valueField
  ];

  const unique = new Set<string>();
  values.forEach((field) => {
    if (field && field.trim().length > 0) {
      unique.add(field);
    }
  });

  return Array.from(unique);
}

function getColumnHeaders(rows: DataRow[], request: ChartRequest): string[] {
  const configuredOrder = request.export_options?.column_order ?? [];
  const includeRemaining = request.export_options?.include_remaining_columns ?? true;

  const fromRows = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => fromRows.add(key));
  });

  const configured = Array.from(new Set(configuredOrder.filter((c) => typeof c === "string" && c.trim().length > 0)));
  const fromRowsOrdered = Array.from(fromRows);

  if (configured.length > 0) {
    if (!includeRemaining) {
      return configured;
    }

    const remaining = fromRowsOrdered.filter((col) => !configured.includes(col));
    return [...configured, ...remaining];
  }

  if (fromRowsOrdered.length > 0) {
    return fromRowsOrdered;
  }

  return getPreferredColumns(request);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "string" ? value : String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: DataRow[], headers: string[]): string {
  if (headers.length === 0) {
    return "";
  }

  const lines = [headers.map((h) => csvEscape(h)).join(",")];
  rows.forEach((row) => {
    const line = headers.map((header) => csvEscape(row[header])).join(",");
    lines.push(line);
  });

  return `${lines.join("\n")}\n`;
}

function writeXlsx(rows: DataRow[], headers: string[], outPath: string, sheetName = "Data"): void {
  const workbook = XLSX.utils.book_new();
  const resolvedSheetName = sanitizeSheetName(sheetName);

  if (rows.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet(headers.length > 0 ? [headers] : [["No data"]]);
    XLSX.utils.book_append_sheet(workbook, emptySheet, resolvedSheetName);
    XLSX.writeFile(workbook, outPath);
    return;
  }

  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers.length > 0 ? headers : undefined });
  XLSX.utils.book_append_sheet(workbook, sheet, resolvedSheetName);
  XLSX.writeFile(workbook, outPath);
}

function sanitizeSheetName(name: string): string {
  const invalidChars = /[\\/?*\[\]:]/g;
  const cleaned = name.replace(invalidChars, " ").trim();
  if (cleaned.length === 0) {
    return "Data";
  }
  return cleaned.slice(0, 31);
}

function createWorksheet(rows: DataRow[], headers: string[]): XLSX.WorkSheet {
  if (rows.length === 0) {
    return XLSX.utils.aoa_to_sheet(headers.length > 0 ? [headers] : [["No data"]]);
  }

  return XLSX.utils.json_to_sheet(rows, { header: headers.length > 0 ? headers : undefined });
}

function getResultSetIndicesForXlsx(request: ChartRequest): number[] {
  const configured = request.export_options?.xlsx?.result_set_indices;
  if (Array.isArray(configured) && configured.length > 0) {
    const unique = Array.from(new Set(configured.filter((n) => Number.isInteger(n) && n >= 0)));
    if (unique.length > 0) {
      return unique;
    }
  }

  return [request.data_source.result_set_index ?? 0];
}

function getSheetNameForIndex(request: ChartRequest, resultSetIndex: number, fallbackIndex: number): string {
  const configuredNames = request.export_options?.xlsx?.sheet_names;
  const configured = configuredNames?.[String(resultSetIndex)];
  if (configured && configured.trim().length > 0) {
    return sanitizeSheetName(configured);
  }

  const singleSheetName = request.export_options?.xlsx?.sheet_name;
  const allIndices = getResultSetIndicesForXlsx(request);
  if (singleSheetName && singleSheetName.trim().length > 0 && allIndices.length === 1) {
    return sanitizeSheetName(singleSheetName);
  }

  const prefix = request.export_options?.xlsx?.sheet_name_prefix?.trim() || "Result";
  const multiName = `${prefix}_${resultSetIndex}`;
  const singleName = `Data${fallbackIndex > 0 ? `_${fallbackIndex + 1}` : ""}`;

  return sanitizeSheetName(allIndices.length > 1 ? multiName : singleName);
}

function writeXlsxMultiSheet(
  sheetEntries: Array<{ resultSetIndex: number; rows: DataRow[]; headers: string[] }>,
  request: ChartRequest,
  outPath: string
): void {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  sheetEntries.forEach((entry, idx) => {
    let sheetName = getSheetNameForIndex(request, entry.resultSetIndex, idx);
    if (usedNames.has(sheetName)) {
      let suffix = 2;
      while (usedNames.has(`${sheetName}_${suffix}`)) {
        suffix += 1;
      }
      sheetName = sanitizeSheetName(`${sheetName}_${suffix}`);
    }

    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(workbook, createWorksheet(entry.rows, entry.headers), sheetName);
  });

  XLSX.writeFile(workbook, outPath);
}

function getDefaultOutputPath(request: ChartRequest): string {
  switch (request.output.format) {
    case "csv":
      return "chart-output.csv";
    case "xlsx":
      return "chart-output.xlsx";
    case "html":
    default:
      return "chart-output.html";
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getTimestampSuffix(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${yy}-${mm}-${dd}-${hh}${min}`;
}

function addTimestampToOutputPath(outPath: string, date = new Date()): string {
  const parsed = path.parse(outPath);
  const stamp = getTimestampSuffix(date);
  const withStamp = `${parsed.name}-${stamp}${parsed.ext}`;
  return path.join(parsed.dir, withStamp);
}

function getTemplatePythonExecutable(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), ".venv/bin/python"),
    path.resolve(process.cwd(), ".venv/bin/python3"),
    process.env.PYTHON,
    "python3",
    "python"
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
      continue;
    }
    return candidate;
  }

  return undefined;
}

function shouldUseTemplateXlsxExport(request: ChartRequest, sheetEntriesCount: number): boolean {
  if (request.output.format !== "xlsx") {
    return false;
  }

  if (sheetEntriesCount !== 1) {
    return false;
  }

  const explicitTemplatePath = request.export_options?.xlsx?.template_path;
  if (explicitTemplatePath && explicitTemplatePath.trim().length > 0) {
    return true;
  }

  const defaultTemplatePath = getDefaultTemplatePath(request);
  return fs.existsSync(defaultTemplatePath);
}

function getTemplatePath(request: ChartRequest): string {
  const configured = request.export_options?.xlsx?.template_path;
  if (configured && configured.trim().length > 0) {
    return path.resolve(process.cwd(), configured);
  }
  return getDefaultTemplatePath(request);
}

function getDefaultTemplatePath(request: ChartRequest): string {
  const templateByType: Record<ChartRequest["chart"]["type"], string> = {
    line: "chart-contract/templates/line-series-template.xlsx",
    bar: "chart-contract/templates/bar-grouped-template.xlsx",
    pie: "chart-contract/templates/pie-template.xlsx",
    scatter: "chart-contract/templates/scatter-template.xlsx"
  };
  return path.resolve(process.cwd(), templateByType[request.chart.type]);
}

function getTemplateFillScriptPath(request: ChartRequest): string {
  const scriptByType: Record<ChartRequest["chart"]["type"], string> = {
    line: "scripts/fill_excel_template.py",
    bar: "scripts/fill_excel_template_bar.py",
    pie: "scripts/fill_excel_template_pie.py",
    scatter: "scripts/fill_excel_template_scatter.py"
  };
  return path.resolve(process.cwd(), scriptByType[request.chart.type]);
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function buildTemplateTabularData(
  request: ChartRequest,
  rows: DataRow[]
): { headers: string[]; rows: Array<Record<string, string | number | null>> } {
  const mapping = request.mapping;
  const xField = mapping.xField;
  const yField = mapping.yField;
  const groupField = mapping.groupField;
  const categoryField = mapping.categoryField;
  const valueField = mapping.valueField;

  if (request.chart.type === "pie" && categoryField && valueField) {
    const headers = ["label", "value"];
    const tabularRows = rows.map((row) => {
      const labelValue = row[categoryField];
      const out: Record<string, string | number | null> = {
        label: labelValue == null ? null : String(labelValue),
        value: toNumberOrNull(row[valueField])
      };
      return out;
    });
    return { headers, rows: tabularRows };
  }

  if (request.chart.type === "scatter" && xField && yField && !groupField) {
    const headers = ["x", "Series"];
    const tabularRows = rows.map((row) => {
      const out: Record<string, string | number | null> = {
        x: toNumberOrNull(row[xField]),
        Series: toNumberOrNull(row[yField])
      };
      return out;
    });
    return { headers, rows: tabularRows };
  }

  const effectiveXField = xField ?? (request.chart.type === "bar" ? categoryField : undefined);
  const effectiveYField = yField ?? (request.chart.type === "bar" ? valueField : undefined);

  if (!effectiveXField || !effectiveYField) {
    const headers = getColumnHeaders(rows, request).slice(0, 4);
    const tabularRows = rows.map((row) => {
      const out: Record<string, string | number | null> = {};
      headers.forEach((h) => {
        const value = row[h];
        out[h] = value == null ? null : (typeof value === "number" ? value : String(value));
      });
      return out;
    });
    return { headers, rows: tabularRows };
  }

  const xValues: string[] = [];
  const xSeen = new Set<string>();
  const groupValues: string[] = [];
  const groupSeen = new Set<string>();

  rows.forEach((row) => {
    const xRaw = row[effectiveXField];
    if (xRaw != null) {
      const x = String(xRaw);
      if (!xSeen.has(x)) {
        xSeen.add(x);
        xValues.push(x);
      }
    }

    if (groupField) {
      const gRaw = row[groupField];
      if (gRaw != null) {
        const g = String(gRaw);
        if (!groupSeen.has(g)) {
          groupSeen.add(g);
          groupValues.push(g);
        }
      }
    }
  });

  const effectiveGroups = (groupValues.length > 0 ? groupValues : ["Series"])
    .slice(0, 3);

  const byX: Record<string, Record<string, number | null>> = {};
  xValues.forEach((x) => {
    byX[x] = {};
    effectiveGroups.forEach((g) => {
      byX[x][g] = null;
    });
  });

  rows.forEach((row) => {
    const xRaw = row[effectiveXField];
    if (xRaw == null) {
      return;
    }
    const x = String(xRaw);
    if (!byX[x]) {
      return;
    }

    const g = groupField ? String(row[groupField] ?? "Series") : "Series";
    if (!effectiveGroups.includes(g)) {
      return;
    }

    byX[x][g] = toNumberOrNull(row[effectiveYField]);
  });

  const headers = ["date", ...effectiveGroups];
  const tabularRows = xValues.map((x) => {
    const out: Record<string, string | number | null> = { date: x };
    effectiveGroups.forEach((g) => {
      out[g] = byX[x]?.[g] ?? null;
    });
    return out;
  });

  return { headers, rows: tabularRows };
}

function writeXlsxFromTemplate(
  request: ChartRequest,
  rows: DataRow[],
  outPath: string
): void {
  const templatePath = getTemplatePath(request);
  if (!fs.existsSync(templatePath)) {
    fail(`Template workbook not found: ${templatePath}`);
  }

  const python = getTemplatePythonExecutable();
  if (!python) {
    fail("Could not determine a Python executable for template-based XLSX export.");
  }

  const payload = {
    templatePath,
    outputPath: outPath,
    sheetName: request.export_options?.xlsx?.template_sheet_name || "Data",
    ...buildTemplateTabularData(request, rows)
  };

  const payloadPath = path.join(
    os.tmpdir(),
    `codexcharts-template-payload-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  try {
    fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");

    const scriptPath = getTemplateFillScriptPath(request);
    if (!fs.existsSync(scriptPath)) {
      fail(`Template fill script not found: ${scriptPath}`);
    }

    const result = spawnSync(python, [scriptPath, "--payload", payloadPath], {
      encoding: "utf8"
    });

    if (result.status !== 0) {
      const errorText = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      fail(`Template XLSX generation failed${errorText ? `:\n${errorText}` : "."}`);
    }
  } finally {
    if (fs.existsSync(payloadPath)) {
      fs.unlinkSync(payloadPath);
    }
  }
}

function tryOpenFile(filePath: string): void {
  const platform = process.platform;
  let command = "";
  let args: string[] = [];

  if (platform === "darwin") {
    command = "open";
    args = [filePath];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", filePath];
  } else {
    command = "xdg-open";
    args = [filePath];
  }

  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit code ${String(result.status ?? "unknown")}`;
    console.warn(`Warning: Could not open output file automatically (${detail}).`);
  }
}

async function main(): Promise<void> {
  dotenv.config();

  const requestPath = getArgValue("--request");
  const shouldOpenOutput = hasArgFlag("--open-output", "--open-latest");

  if (!requestPath) {
    fail("Missing --request argument. Example: --request chart-contract/examples/line.stored-proc.example.json");
  }

  const schemaPath = path.resolve(process.cwd(), "chart-contract/chart-request.schema.json");
  const resolvedRequestPath = path.resolve(process.cwd(), requestPath);

  const schema = readJsonFile<object>(schemaPath);
  const request = readJsonFile<unknown>(resolvedRequestPath);
  const chartRequest = validateAgainstSchema(request, schema);
  validateRequiredMappings(chartRequest);
  validateScatterNumericMapping(chartRequest);

  const colorLookup = loadColorLookup();
  const resolvedChartRequest = resolveAppearanceColors(chartRequest, colorLookup);

  const outPath = getArgValue("--out") ?? getDefaultOutputPath(resolvedChartRequest);
  const outPathWithTimestamp = addTimestampToOutputPath(outPath);
  const resolvedOutPath = path.resolve(process.cwd(), outPathWithTimestamp);

  if (resolvedChartRequest.output.format === "csv" || resolvedChartRequest.output.format === "xlsx") {
    const resultSetIndices =
      resolvedChartRequest.output.format === "xlsx"
        ? getResultSetIndicesForXlsx(resolvedChartRequest)
        : [resolvedChartRequest.data_source.result_set_index ?? 0];

    const sheetEntries: Array<{ resultSetIndex: number; rows: DataRow[]; headers: string[] }> = [];
    for (const resultSetIndex of resultSetIndices) {
      const rows = await fetchStoredProcRows(resolvedChartRequest, resultSetIndex);
      const headers = getColumnHeaders(rows, resolvedChartRequest);
      sheetEntries.push({ resultSetIndex, rows, headers });
    }

    if (resolvedChartRequest.output.format === "csv") {
      const first = sheetEntries[0] ?? {
        resultSetIndex: resolvedChartRequest.data_source.result_set_index ?? 0,
        rows: [],
        headers: getColumnHeaders([], resolvedChartRequest)
      };
      const csv = toCsv(first.rows, first.headers);
      fs.writeFileSync(resolvedOutPath, csv, "utf8");
    } else if (sheetEntries.length <= 1) {
      const first = sheetEntries[0] ?? {
        resultSetIndex: resolvedChartRequest.data_source.result_set_index ?? 0,
        rows: [],
        headers: getColumnHeaders([], resolvedChartRequest)
      };
      if (shouldUseTemplateXlsxExport(resolvedChartRequest, sheetEntries.length)) {
        try {
          writeXlsxFromTemplate(resolvedChartRequest, first.rows, resolvedOutPath);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`Warning: Template XLSX export failed, falling back to plain workbook. ${message}`);
          const singleSheetName =
            resolvedChartRequest.export_options?.xlsx?.sheet_name?.trim() ||
            resolvedChartRequest.export_options?.xlsx?.sheet_names?.[String(first.resultSetIndex)] ||
            "Data";
          writeXlsx(first.rows, first.headers, resolvedOutPath, singleSheetName);
        }
      } else {
        const singleSheetName =
          resolvedChartRequest.export_options?.xlsx?.sheet_name?.trim() ||
          resolvedChartRequest.export_options?.xlsx?.sheet_names?.[String(first.resultSetIndex)] ||
          "Data";
        writeXlsx(first.rows, first.headers, resolvedOutPath, singleSheetName);
      }
    } else {
      writeXlsxMultiSheet(sheetEntries, resolvedChartRequest, resolvedOutPath);
    }

    const totalRows = sheetEntries.reduce((sum, entry) => sum + entry.rows.length, 0);

    console.log(`Validated and exported request: ${resolvedRequestPath}`);
    console.log(`Fetched ${totalRows} row(s) across ${sheetEntries.length} result set(s).`);
    console.log(`Saved ${resolvedChartRequest.output.format.toUpperCase()} output to: ${resolvedOutPath}`);
    if (shouldOpenOutput) {
      tryOpenFile(resolvedOutPath);
      console.log(`Opened output file: ${resolvedOutPath}`);
    }
    return;
  }

  const endpoint = process.env.CODEX_API_URL ?? "https://api.openai.com/v1/responses";
  const model = process.env.CODEX_MODEL ?? "gpt-5.3-codex";
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_KEY;

  if (!apiKey) {
    fail("OPENAI_API_KEY (or OPEN_AI_KEY) is not set.");
  }

  const payload = buildCodexPayload(resolvedChartRequest, model);
  const result = await postToCodexApi(endpoint, apiKey, payload);
  const html = extractHtmlFromResponse(result);
  const withAdapter = ensureChartJsTimeAdapter(html);
  const withMonthTicks = normalizeAbbreviatedMonthTicks(withAdapter);
  const withTransport = applyHtmlTransportOverrides(withMonthTicks, resolvedChartRequest);
  const finalHtml = applyProfessionalTheme(withTransport, resolvedChartRequest);
  fs.writeFileSync(resolvedOutPath, finalHtml, "utf8");

  console.log(`Validated and sent request: ${resolvedRequestPath}`);
  console.log(`Saved chart output to: ${resolvedOutPath}`);
  if (shouldOpenOutput) {
    tryOpenFile(resolvedOutPath);
    console.log(`Opened output file: ${resolvedOutPath}`);
  }
}

main().catch((err) => {
  fail((err as Error).message);
});
