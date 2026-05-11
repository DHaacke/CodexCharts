#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");

const SERVER_URL = "http://localhost:3000/health";

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[idx + 1];
}

const RUN_SCRIPT = getArgValue("--script") || "run:line";
const OUTPUT_PATH = getArgValue("--output") || "chart-contract/output/line-chart.html";
const LABEL = getArgValue("--label") || "line";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return true;
      }
    } catch {
      // Server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function main() {
  console.log("[1/4] Killing any process on port 3000...");
  run("node", ["scripts/kill-port.js"]);

  console.log("[2/4] Starting dev server in background...");
  const server = spawn("npm", ["run", "dev:server"], {
    detached: true,
    stdio: "ignore",
  });
  server.unref();

  console.log(`[3/4] Waiting for health check: ${SERVER_URL}`);
  const healthy = await waitForHealth(SERVER_URL);
  if (!healthy) {
    console.error("Server did not become healthy in time.");
    console.error("Run this to debug startup: npm run dev:server");
    process.exit(1);
  }

  console.log(`[4/4] Generating ${LABEL} chart...`);
  run("npm", ["run", RUN_SCRIPT]);

  console.log("Done.");
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log("Server is still running on port 3000.");
  console.log("Stop it with: npm run kill:port");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
