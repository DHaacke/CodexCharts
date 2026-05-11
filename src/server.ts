import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

type ProcParamValue = string | number | boolean | null;

type StoredProcRequest = {
  proc_schema?: string;
  proc_name?: string;
  proc_params?: Record<string, ProcParamValue>;
  result_set_index?: number;
};

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT ?? 10),
  multipleStatements: String(process.env.DB_MULTIPLESTATEMENT ?? "false").toLowerCase() === "true",
  charset: process.env.DB_CHARSET ?? "utf8mb4"
});

function parseParams(input: unknown): Record<string, ProcParamValue> {
  if (typeof input === "string") {
    try {
      return parseParams(JSON.parse(input));
    } catch {
      return {};
    }
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const out: Record<string, ProcParamValue> = {};
  const entries = Object.entries(input);
  
  // Handle flattened proc_params.key=value format from query strings
  const flatParamEntries = entries.filter(([k]) => k.startsWith("proc_params."));
  if (flatParamEntries.length > 0) {
    for (const [key, value] of flatParamEntries) {
      const paramKey = key.substring("proc_params.".length);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[paramKey] = value;
      } else {
        out[paramKey] = JSON.stringify(value);
      }
    }
    return out;
  }

  // Handle object or JSON string format
  for (const [key, value] of entries) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

function buildCallSql(procSchema: string, procName: string, paramCount: number): string {
  const fullName = procSchema ? `${procSchema}.${procName}` : procName;
  const placeholders = Array.from({ length: paramCount }, () => "?").join(", ");
  return `CALL ${fullName}(${placeholders})`;
}

function extractResultSet(results: unknown, index: number): unknown[] {
  if (Array.isArray(results)) {
    const candidate = results[index];
    if (Array.isArray(candidate)) {
      return candidate as unknown[];
    }

    if (candidate && typeof candidate === "object") {
      const rows = (candidate as { rows?: unknown }).rows;
      if (Array.isArray(rows)) {
        return rows;
      }
    }

    const firstArray = results.find(Array.isArray);
    if (Array.isArray(firstArray)) {
      return firstArray as unknown[];
    }
  }

  return [];
}

function normalizeRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }

    const obj = { ...(row as Record<string, unknown>) };
    // Compatibility alias for known stored-proc typo: adundance -> abundance.
    if (obj.abundance === undefined && obj.adundance !== undefined) {
      obj.abundance = obj.adundance;
    }
    return obj;
  });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/test", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodexCharts API Test</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #1f2937; }
    .card { max-width: 900px; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    code, pre { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
    button { margin-right: 8px; margin-top: 8px; padding: 8px 12px; }
    textarea { width: 100%; min-height: 120px; margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    #output { white-space: pre-wrap; background: #0b1020; color: #d1e7ff; padding: 12px; border-radius: 8px; min-height: 120px; }
  </style>
</head>
<body>
  <h1>CodexCharts API Test</h1>
  <div class="card">
    <div><strong>Health:</strong> <code>/health</code></div>
    <button id="checkHealth">Check health</button>
  </div>
  <div class="card">
    <div><strong>Stored proc test:</strong> <code>/api/stored-proc</code></div>
    <div>Defaults are prefilled for your line chart example.</div>
    <label>Procedure JSON payload</label>
    <textarea id="payload">{
  "proc_schema": "ri",
  "proc_name": "FWPSpeciesCountByYear",
  "proc_params": { "from_year": "2024", "to_year": "2026" },
  "result_set_index": 0
}</textarea>
    <div>
      <button id="postTest">POST test</button>
      <button id="getTest">GET test</button>
    </div>
  </div>
  <div class="card">
    <strong>Output</strong>
    <div id="output">Ready.</div>
  </div>
  <script>
    const output = document.getElementById('output');
    const payloadEl = document.getElementById('payload');

    const write = (value) => {
      output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    };

    document.getElementById('checkHealth').addEventListener('click', async () => {
      const res = await fetch('/health');
      write(await res.json());
    });

    async function callStoredProc(method) {
      let payload;
      try {
        payload = JSON.parse(payloadEl.value);
      } catch (err) {
        write('Invalid JSON payload: ' + err.message);
        return;
      }

      const endpoint = '/api/stored-proc';
      if (method === 'GET') {
        const qs = new URLSearchParams();
        qs.set('proc_schema', payload.proc_schema ?? '');
        qs.set('proc_name', payload.proc_name ?? '');
        qs.set('result_set_index', String(payload.result_set_index ?? 0));
        qs.set('proc_params', JSON.stringify(payload.proc_params ?? {}));
        const res = await fetch(endpoint + '?' + qs.toString(), { method: 'GET' });
        write(await res.json());
        return;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      write(await res.json());
    }

    document.getElementById('postTest').addEventListener('click', () => callStoredProc('POST'));
    document.getElementById('getTest').addEventListener('click', () => callStoredProc('GET'));
  </script>
</body>
</html>`);
});

app.all("/api/stored-proc", async (req, res) => {
  try {
    const body = (req.method === "GET" ? req.query : req.body) as StoredProcRequest;
    const procSchema = body.proc_schema ?? String(req.query.proc_schema ?? process.env.DB_NAME ?? "ri");
    const procName = body.proc_name ?? String(req.query.proc_name ?? "");
    const resultSetIndex = Number(body.result_set_index ?? req.query.result_set_index ?? 0);
    const rawProcParams = body.proc_params ?? req.query.proc_params ?? (req.method === "GET" ? req.query : undefined);
    const procParams = parseParams(rawProcParams);

    if (!procName) {
      res.status(400).json({ error: "proc_name is required" });
      return;
    }

    const paramValues = Object.values(procParams);
    const sql = buildCallSql(procSchema, procName, paramValues.length);
    const [results] = await pool.query(sql, paramValues);
    const rows = extractResultSet(results, resultSetIndex);
    const normalizedRows = normalizeRows(rows);

    res.json({
      proc_schema: procSchema,
      proc_name: procName,
      result_set_index: resultSetIndex,
      rows: normalizedRows,
      data: normalizedRows
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const port = Number(process.env.APP_PORT ?? 3000);
app.listen(port, () => {
  console.log(`Stored-proc API listening on http://localhost:${port}`);
});
