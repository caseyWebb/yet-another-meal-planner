// kv-rest.mjs — minimal Cloudflare KV REST client for build/deploy scripts.
// Shared by build-indexes.mjs (publishing the recipe index) and
// run-migrations.mjs (applying deploy-time KV migrations) so the
// token/account/namespace resolution lives in one place.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';

/**
 * Resolve KV access for a binding from env + the data repo's wrangler.jsonc.
 * Returns { ok: true, token, accountId, namespaceId } when everything is
 * present, or { ok: false, reason } when it is not (caller decides whether that
 * is fatal or a graceful skip). Never throws for the expected "not configured
 * yet" cases — only network/parse faults surface as the reason string.
 *
 * `root` is the data repo checkout (where wrangler.jsonc lives).
 */
export async function resolveKvAccess(root, binding = 'DATA_KV') {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return { ok: false, reason: 'CLOUDFLARE_API_TOKEN not set' };

  let namespaceId;
  try {
    const wranglerPath = path.join(root, 'wrangler.jsonc');
    const cfg = JSON5.parse(await readFile(wranglerPath, 'utf8'));
    namespaceId = (cfg.kv_namespaces ?? []).find((b) => b.binding === binding)?.id;
  } catch {
    // wrangler.jsonc absent or unreadable — treated as "not provisioned yet".
  }
  if (!namespaceId) {
    return { ok: false, reason: `${binding} namespace id not in wrangler.jsonc (run deploy first to provision)` };
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

  return { ok: true, token, accountId, namespaceId };
}

function valueUrl(access, key) {
  return `https://api.cloudflare.com/client/v4/accounts/${access.accountId}/storage/kv/namespaces/${access.namespaceId}/values/${encodeURIComponent(key)}`;
}

/** GET a key's value, or null on 404. Throws on other non-OK responses. */
export async function kvGet(access, key) {
  const res = await fetch(valueUrl(access, key), {
    headers: { Authorization: `Bearer ${access.token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV get ${key} failed — ${res.status}: ${await res.text()}`);
  return await res.text();
}

/** PUT a key's value (text). Throws on a non-OK response. */
export async function kvPut(access, key, value) {
  const res = await fetch(valueUrl(access, key), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res.ok) throw new Error(`KV put ${key} failed — ${res.status}: ${await res.text()}`);
}

/** A small { get, put } client bound to a resolved access record. */
export function makeKvClient(access) {
  return {
    get: (key) => kvGet(access, key),
    put: (key, value) => kvPut(access, key, value),
  };
}
