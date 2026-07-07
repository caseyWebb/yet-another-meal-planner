#!/usr/bin/env node
// dev-app.mjs — `aubr dev:app`: the member app's HMR dev loop (member-app-shell).
// Spawns `wrangler dev` (packages/worker — the real Worker: auth, /api, data) and
// `vite` (packages/app — HMR at :5173, whose server.proxy carries /api to :8787 so
// cookies flow same-origin from the browser's view). A committed spawner instead of a
// package-manager `--parallel` flag: deterministic child handling, signal forwarding,
// and a non-zero exit when either side dies (design Decision 14).
//
// `aubr dev` stays plain `wrangler dev` (serving the last-built SPA from assets/ —
// the no-HMR path the Playwright harness also uses).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const children = [];
let shuttingDown = false;

function run(name, bin, args, cwd) {
  const child = spawn(path.join(cwd, "node_modules", ".bin", bin), args, {
    cwd,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // Either side dying ends the loop: kill the sibling and exit non-zero.
    console.error(`[dev-app] ${name} exited (${signal ?? `code ${code}`}) — shutting down`);
    shutdown(code === 0 ? 1 : (code ?? 1));
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

run("wrangler dev", "wrangler", ["dev"], path.join(ROOT, "packages", "worker"));
run("vite", "vite", [], path.join(ROOT, "packages", "app"));
