#!/usr/bin/env node
// run-migrations.mjs — apply pending KV migrations at deploy time.
//
// Discovers migration modules under migrations/ (filename order), reads the
// `migrations:applied` ledger from DATA_KV, runs any whose id is not yet in the
// ledger, and records each id after it succeeds. Idempotent migration bodies
// guard the "ran but ledger write failed" edge.
//
// Invoked from the data-deploy workflow as:
//   node _code/scripts/run-migrations.mjs --root .
// where `.` is the operator's data repo checkout (its wrangler.jsonc pins the
// DATA_KV namespace id; CLOUDFLARE_API_TOKEN comes from the workflow env).
//
// Gracefully no-ops when the DATA_KV namespace id can't be resolved (a brand-new
// operator before their first deploy — there is no tenant data to migrate yet).

import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { resolveKvAccess, makeKvClient } from './kv-rest.mjs';
import { resolveD1Access, makeD1Client } from './d1-rest.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CODE_ROOT = path.resolve(SCRIPTS_DIR, '..');
const MIGRATIONS_DIR = path.join(CODE_ROOT, 'migrations');
const LEDGER_KEY = 'migrations:applied';

async function listMigrationFiles() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => e.name)
    .sort();
}

async function readLedger(kv) {
  const raw = await kv.get(LEDGER_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function main() {
  const rootArg = process.argv.indexOf('--root');
  const dataRoot = rootArg !== -1 ? path.resolve(process.argv[rootArg + 1]) : process.cwd();

  const files = await listMigrationFiles();
  if (files.length === 0) {
    console.log('run-migrations: no migrations found — nothing to do');
    return;
  }

  const access = await resolveKvAccess(dataRoot);
  if (!access.ok) {
    console.warn(`run-migrations: skipping — ${access.reason}`);
    return;
  }
  const kv = makeKvClient(access);

  // Resolve a D1 client too, for migrations that backfill domain data into D1 (read
  // the GitHub checkout / KV → INSERT). It's the SAME idempotent, KV-ledgered runner —
  // only the destination differs. A null `d1` (D1 not provisioned yet, or a brand-new
  // operator) is fine: slice-0 ships no .mjs migration that touches D1, and a migration
  // that needs D1 should guard on it. The KV `migrations:applied` ledger is unchanged.
  const d1Access = await resolveD1Access(dataRoot);
  const d1 = d1Access.ok ? makeD1Client(d1Access) : null;
  if (!d1) console.warn(`run-migrations: D1 client unavailable — ${d1Access.reason}`);

  const applied = await readLedger(kv);
  let ran = 0;

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, file)).href);
    const id = mod.id ?? file.replace(/\.mjs$/, '');
    if (applied.has(id)) {
      console.log(`run-migrations: ${id} already applied — skipping`);
      continue;
    }
    if (typeof mod.up !== 'function') {
      throw new Error(`migration ${file} exports no up() function`);
    }
    console.log(`run-migrations: applying ${id}…`);
    await mod.up({ kv, d1, dataRoot, log: (m) => console.log(`  [${id}] ${m}`) });
    applied.add(id);
    await kv.put(LEDGER_KEY, JSON.stringify([...applied]));
    ran++;
    console.log(`run-migrations: ${id} applied and recorded`);
  }

  console.log(`run-migrations: done (${ran} applied, ${files.length - ran} already current)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
