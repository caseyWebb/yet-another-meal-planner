// 0002-cooking-log-d1 — backfill each tenant's GitHub cooking_log.toml into the D1
// `cooking_log` table. The FIRST data-backfill migration: it reads the data-repo
// checkout (dataRoot), parses each users/<username>/cooking_log.toml, and INSERTs a
// row per entry through the `d1` client (run-migrations.mjs resolves it from the
// operator's wrangler.jsonc). The SCHEMA (migrations/d1/0003_cooking_log.sql) is
// applied by `wrangler d1 migrations apply` BEFORE this runs — guaranteed by the
// deploy step ordering.
//
// Idempotent independent of the ledger: per tenant we DELETE every cooking_log row
// for that tenant, then re-INSERT from the file. So a re-run (or a "ran but ledger
// write failed" replay) converges on the file's contents rather than duplicating.
// A tenant with no cooking_log.toml contributes nothing (no delete, no insert). A
// null `d1` (D1 not provisioned yet / brand-new operator) makes the whole migration
// a no-op — the next deploy with D1 provisioned backfills.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

export const id = '0002-cooking-log-d1';

const COOKING_LOG_TYPES = new Set(['recipe', 'ready_to_eat', 'ad_hoc']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function listTenants(usersDir) {
  let entries;
  try {
    entries = await readdir(usersDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// Accept a quoted ISO string OR a bare TOML date (smol-toml parses those as Date),
// mirroring the build's old isoOf. Returns YYYY-MM-DD, or null when not a valid date.
function isoOf(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && ISO_DATE_RE.test(v)) return v;
  return null;
}

// Coerce one parsed [[entries]] row into a cooking_log column tuple, or null when it
// is structurally invalid (no valid date / unknown type). Historical entries are
// migrated VERBATIM — slug resolution is a write-time `log_cooked` concern, not a
// backfill one, so an entry whose recipe slug was later removed still migrates.
function coerceRow(raw) {
  const date = isoOf(raw.date);
  if (date === null) return null;
  if (!COOKING_LOG_TYPES.has(raw.type)) return null;
  const type = raw.type;
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
  if (type === 'recipe') {
    const recipe = str(raw.recipe);
    if (recipe === null) return null;
    return { date, type, recipe, name: null, protein: null, cuisine: null };
  }
  const name = str(raw.name);
  if (name === null) return null;
  return { date, type, recipe: null, name, protein: str(raw.protein), cuisine: str(raw.cuisine) };
}

function rowsOf(text) {
  if (!text) return [];
  const data = parseToml(text);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries.map(coerceRow).filter((r) => r !== null);
}

export async function up({ d1, dataRoot, log }) {
  if (!d1) {
    log('D1 client unavailable — skipping cooking-log backfill (will run on a later deploy)');
    return;
  }

  const usersDir = path.join(dataRoot, 'users');
  const tenants = await listTenants(usersDir);
  if (tenants.length === 0) {
    log('no users/ tenants found — nothing to backfill');
    return;
  }

  let migrated = 0;
  let rowsTotal = 0;
  for (const tenant of tenants) {
    const text = await readOptional(path.join(usersDir, tenant, 'cooking_log.toml'));
    if (text === null) {
      log(`${tenant}: no cooking_log.toml — skipping`);
      continue;
    }
    const rows = rowsOf(text);

    // Delete-then-insert per tenant: idempotent regardless of the ledger.
    await d1.query('DELETE FROM cooking_log WHERE tenant = ?1', [tenant]);
    for (const r of rows) {
      await d1.query(
        'INSERT INTO cooking_log (tenant, date, type, recipe, name, protein, cuisine) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        [tenant, r.date, r.type, r.recipe, r.name, r.protein, r.cuisine],
      );
    }
    migrated++;
    rowsTotal += rows.length;
    log(`${tenant}: backfilled ${rows.length} cooking-log row(s)`);
  }
  log(`backfilled ${rowsTotal} row(s) across ${migrated} tenant(s)`);
}
