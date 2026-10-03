#!/usr/bin/env node
// Build using the same Docker image and workspace command as the project's Docker workflow,
// stage that exact output, and launch Electron against it.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO = path.resolve(DESKTOP, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Compose builds the exact Dockerfile used for the normal development environment. `run`
// mounts this checkout, so Vite's output is the same `apps/web/dist` that Docker serves.
run("docker", ["compose", "run", "--build", "--rm", "--no-deps", "dev", "sh", "-lc",
  "PUBLIC_BASE=./ npm run build --workspace @gnw/web"]);
// Historical builds may have been staged by Docker as root. Clear that generated tree from the
// container so staging works even when the host user cannot unlink its old files.
run("docker", ["compose", "run", "--rm", "--no-deps", "dev", "rm", "-rf", "/app/desktop/build/web"]);
run(process.execPath, [path.join(HERE, "stage-web.mjs")]);

const electronCli = path.join(DESKTOP, "node_modules", "electron", "cli.js");
if (!fs.existsSync(electronCli)) {
  console.error("desktop dev: Electron is not installed; run `npm ci --prefix desktop` once.");
  process.exit(1);
}
const env = { ...process.env };
delete env.GNW_WEB_ROOT;
const child = spawn(process.execPath, [electronCli, ...process.argv.slice(2)], {
  cwd: DESKTOP,
  stdio: "inherit",
  env,
});
child.on("error", (error) => { console.error(`desktop dev: ${error.message}`); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
