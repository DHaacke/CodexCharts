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
            text: "You are a chart renderer. Return ONLY a complete HTML document that renders the chart from the provided chart request JSON. Do not include markdown fences. Never include hardcoded mock/fallback rows (for example Trout/Salmon/Pike or any fabricated sample data). Use only data fetched from the configured stored-procedure endpoint. Respect mapping field names exactly as provided, including case. Add a runtime guard before chart creation: verify at least one returned row contains every mapped field required by the chart type, and if any are missing, show an error listing missing field names and stop rendering. Endpoint behavior: if data_source.endpoint is provided, fetch that URL; otherwise use /api/stored-proc. If data_source.http_method is provided, use it; otherwise use POST. For POST, send JSON body with proc_schema, proc_name, proc_params, result_set_index. For GET, send those values as query string parameters and do not send a body. At the top of the page, render a compact visible transport summary that shows the endpoint, method, and proc_name. If fetch fails, render a visible error message that includes status code and method+endpoint."
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
  const finalHtml = applyHtmlTransportOverrides(html, chartRequest);

  const resolvedOutPath = path.resolve(process.cwd(), outPath);
  fs.writeFileSync(resolvedOutPath, finalHtml, "utf8");

  console.log(`Validated and sent request: ${resolvedRequestPath}`);
  console.log(`Saved chart output to: ${resolvedOutPath}`);
}

main().catch((err) => {
  fail((err as Error).message);
});
