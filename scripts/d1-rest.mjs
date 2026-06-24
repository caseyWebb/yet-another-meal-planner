// d1-rest.mjs — minimal Cloudflare D1 REST client for build/deploy scripts. Used by
// build-indexes.mjs to project the recipe index into the D1 `recipes` table from CI
// (the post-deploy populate, and the data-build-indexes workflow on recipe pushes).
// Resolves token/account/database from env + the operator's wrangler.jsonc.
//
// SCHEMA DDL does NOT go through here — that's the native `wrangler d1 migrations
// apply` pipeline. This client issues parameterised data queries only.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';

/**
 * Resolve D1 access for a binding from env + the data repo's wrangler.jsonc.
 * Returns { ok: true, token, accountId, databaseId } when everything is present, or
 * { ok: false, reason } when it is not (caller decides skip vs. fatal). Never throws
 * for the expected "not provisioned yet" cases — only network/parse faults surface as
 * the reason string. Mirrors resolveKvAccess; the `database_id` is the operator's,
 * pinned back into wrangler.jsonc by the deploy after the first auto-provision.
 *
 * `root` is the data repo checkout (where wrangler.jsonc lives).
 */
export async function resolveD1Access(root, binding = 'DB') {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return { ok: false, reason: 'CLOUDFLARE_API_TOKEN not set' };

  let databaseId;
  try {
    const wranglerPath = path.join(root, 'wrangler.jsonc');
    const cfg = JSON5.parse(await readFile(wranglerPath, 'utf8'));
    databaseId = (cfg.d1_databases ?? []).find((b) => b.binding === binding)?.database_id;
  } catch {
    // wrangler.jsonc absent or unreadable — treated as "not provisioned yet".
  }
  if (!databaseId) {
    return { ok: false, reason: `${binding} database id not in wrangler.jsonc (run deploy first to provision)` };
  }

  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { result } = await res.json();
      accountId = result?.[0]?.id;
    } catch (err) {
      return { ok: false, reason: `could not resolve Cloudflare account: ${err.message}` };
    }
  }
  if (!accountId) return { ok: false, reason: 'no Cloudflare account found for this token' };

  return { ok: true, token, accountId, databaseId };
}

function queryUrl(access) {
  return `https://api.cloudflare.com/client/v4/accounts/${access.accountId}/d1/database/${access.databaseId}/query`;
}

/**
 * Run a parameterised SQL statement against D1 over the REST endpoint. `params` are
 * positional (`?1`, `?2`, …). Returns the first result block's rows (D1 returns one
 * block per statement; callers send one statement). Throws on a non-OK response or a
 * D1-reported error.
 */
export async function d1Query(access, sql, params = []) {
  const res = await fetch(queryUrl(access), {
    method: 'POST',
    headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => e.message).join('; ') ?? (await res.text().catch(() => res.status));
    throw new Error(`D1 query failed — ${res.status}: ${detail}`);
  }
  // result is an array of statement blocks; we send one statement, so take the first.
  return body.result?.[0]?.results ?? [];
}

/** Run a (possibly multi-statement) SQL string with no params. Returns the raw result blocks. */
export async function d1Exec(access, sql) {
  const res = await fetch(queryUrl(access), {
    method: 'POST',
    headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => e.message).join('; ') ?? (await res.text().catch(() => res.status));
    throw new Error(`D1 exec failed — ${res.status}: ${detail}`);
  }
  return body.result ?? [];
}

/** A small { query, exec } client bound to a resolved access record. */
export function makeD1Client(access) {
  return {
    query: (sql, params) => d1Query(access, sql, params),
    exec: (sql) => d1Exec(access, sql),
  };
}
