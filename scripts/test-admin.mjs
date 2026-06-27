#!/usr/bin/env node
// test-admin.mjs — run the operator admin SPA's Elm unit tests (admin/tests/*.elm).
//
// The admin code's verification is mostly the COMPILER (impossible-states modeling); these
// tests cover the bit it can't prove — the URL `Route` parsing/round-trips and the
// run-gate safety convention (`needsConfirm`). See admin/CLAUDE.md.
//
// Mirrors build-admin.mjs: invoke elm + elm-test via npx so neither pins a heavy binary in
// node_modules. We use the **classic** `elm-test` (not elm-test-rs): it delegates package
// fetching to the elm compiler, which honors a corporate proxy / custom CA bundle (the Rust
// runner's own HTTP client does not). `npx -p elm -p elm-test elm-test` puts both bins on
// PATH so elm-test auto-detects the compiler.
//
// Set ELM_VERSION / ELM_TEST_VERSION to override. Usage: node scripts/test-admin.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ELM_VERSION = process.env.ELM_VERSION ?? "0.19.1-6";
const ELM_TEST_VERSION = process.env.ELM_TEST_VERSION ?? "0.19.1-revision12";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_DIR = path.join(REPO_ROOT, "admin");

execFileSync(
  "npx",
  ["--yes", "-p", `elm@${ELM_VERSION}`, "-p", `elm-test@${ELM_TEST_VERSION}`, "elm-test"],
  { cwd: ADMIN_DIR, stdio: "inherit" },
);
