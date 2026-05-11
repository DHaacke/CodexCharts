#!/usr/bin/env node
const { execSync } = require('node:child_process');

const port = process.env.PORT || process.argv[2] || '3000';

function getPids() {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return output.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

const pids = getPids();

if (!pids.length) {
  console.log(`No process found on port ${port}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    process.kill(Number(pid), 'SIGKILL');
  } catch {
    // Ignore race conditions if the process exits between discovery and kill.
  }
}

console.log(`Killed process(es) on port ${port}: ${pids.join(' ')}`);
