import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import dotenv from "dotenv";

interface ChartRequest {
  request_version: string;
  output: {
    format: "html" | "svg" | "pdf";
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
}

interface CodexResponse {
  status?: string;
  output_text?: string;
  output_html?: string;
  [key: string]: unknown;
}

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

function buildCodexPayload(chartRequest: ChartRequest, model: string): Record<string, unknown> {
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are a chart renderer. Return ONLY a complete HTML document that renders the chart from the provided chart request JSON. Do not include markdown fences. Never include hardcoded mock/fallback rows (for example Trout/Salmon/Pike or any fabricated sample data). Use only data fetched from the configured stored-procedure endpoint. Respect mapping field names exactly as provided, including case. Add a runtime guard before chart creation: verify at least one returned row contains every mapped field required by the chart type, and if any are missing, show an error listing missing field names and stop rendering. Endpoint behavior: if data_source.endpoint is provided, fetch that URL; otherwise use /api/stored-proc. If data_source.http_method is provided, use it; otherwise use POST. For POST, send JSON body with proc_schema, proc_name, proc_params, result_set_index. For GET, send those values as query string parameters and do not send a body. At the top of the page, render a compact visible transport summary that shows the endpoint, method, and proc_name. If fetch fails, render a visible error message that includes status code and method+endpoint. If appearance.series_colors is present, apply those colors to datasets in order (cycle if needed) using borderColor and backgroundColor. If appearance.axis_color or appearance.grid_color is present, apply those to scales/ticks/grid where applicable. If appearance.x_axis_label_color is present, apply it to the x-axis title. If appearance.x_axis_value_color is present, apply it to the x-axis tick labels (value labels). If appearance.y_axis_label_color is present, apply it to the y-axis title. If appearance.y_axis_value_color is present, apply it to the y-axis tick labels (value labels). If appearance.legend_text_color is present, apply it to legend labels and text. If mapping.labelTemplate is present, build display labels from it by replacing {fieldName} placeholders from each row, falling back to data_source.proc_params when needed. Use those computed labels for pie chart legend labels and tooltip labels, and for other chart types where a display label is needed."
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

function applyProfessionalTheme(html: string, request: ChartRequest): string {
  if (html.includes("chart-theme-injected")) {
    return html;
  }

  const themeVars = buildThemeVars(request);
  const layoutVars = buildLayoutVars(request);

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
      --shadow: 0 28px 60px rgba(23, 58, 52, 0.22);      --custom-x-axis-label: #184f3f;
      --custom-x-axis-value: #2f6f5d;
      --custom-y-axis-label: #184f3f;
      --custom-y-axis-value: #2f6f5d;
      --custom-legend-text: #184f3f;    }

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
        radial-gradient(circle at 8% 0%, rgba(255, 255, 255, 0.52), transparent 38%),
        radial-gradient(circle at 90% 100%, rgba(255, 255, 255, 0.4), transparent 35%),
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
      background: rgba(255, 255, 255, 0.7) !important;
      border: 1px solid var(--line) !important;
      border-radius: 10px !important;
      padding: 8px 12px !important;
      margin-bottom: 12px !important;
    }

    #error {
      border-radius: 10px !important;
      border: 1px solid rgba(167, 48, 48, 0.28) !important;
      background: rgba(255, 236, 236, 0.88) !important;
      color: #7f1d1d !important;
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

  themed = themed.replace(/<body([^>]*)>/i, "<body$1><div class=\"page-shell\"><div class=\"chart-card\">");
  themed = themed.replace(/<\/body>/i, "</div></div></body>");

  return themed;
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

async function main(): Promise<void> {
  dotenv.config();

  const requestPath = getArgValue("--request");
  const outPath = getArgValue("--out") ?? "chart-output.html";

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

  const endpoint = process.env.CODEX_API_URL ?? "https://api.openai.com/v1/responses";
  const model = process.env.CODEX_MODEL ?? "gpt-5.3-codex";
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_KEY;

  if (!apiKey) {
    fail("OPENAI_API_KEY (or OPEN_AI_KEY) is not set.");
  }

  const payload = buildCodexPayload(chartRequest, model);
  const result = await postToCodexApi(endpoint, apiKey, payload);
  const html = extractHtmlFromResponse(result);
  const withTransport = applyHtmlTransportOverrides(html, chartRequest);
  const finalHtml = applyProfessionalTheme(withTransport, chartRequest);

  const resolvedOutPath = path.resolve(process.cwd(), outPath);
  fs.writeFileSync(resolvedOutPath, finalHtml, "utf8");

  console.log(`Validated and sent request: ${resolvedRequestPath}`);
  console.log(`Saved chart output to: ${resolvedOutPath}`);
}

main().catch((err) => {
  fail((err as Error).message);
});
