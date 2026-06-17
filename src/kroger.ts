// Kroger public-tier API client (designs D1, D3, D4, D11, D12). Parallels the
// GitHub client but is a distinct external path. Authenticates with the
// `client_credentials` grant (no user context, no refresh token → the Worker
// stays authless/stateless), caches the access token and the resolved
// locationId in isolate memory, and handles `429`/`Retry-After`/backoff. Upstream
// failures surface as a typed KrogerError that the tool boundary maps to the
// structured `upstream_unavailable` error.

import type { Env } from "./env.js";
import { Semaphore, withPermit } from "./semaphore.js";

const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";
const PRODUCTS_URL = "https://api.kroger.com/v1/products";
const LOCATIONS_URL = "https://api.kroger.com/v1/locations";
// product.compact is the documented scope for the Products API on the public tier.
const SCOPE = "product.compact";
const MAX_ATTEMPTS = 3;
// A token is treated as expired this many ms early to avoid using one mid-flight.
const EXPIRY_SKEW_MS = 30_000;

/** Thrown by the client; the tool boundary maps it to `upstream_unavailable`. */
export class KrogerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "KrogerError";
    this.status = status;
  }
}

/** A product candidate normalized from the Products API response. */
export interface KrogerCandidate {
  productId: string;
  brand: string;
  description: string;
  categories: string[];
  size: string | null;
  price: { regular: number; promo: number };
  fulfillment: { curbside: boolean; delivery: boolean; inStore: boolean };
  /** Per-item aisle location at the requested store. Null when the API omits it. */
  aisleLocation: { number: string; description: string; side?: string } | null;
}

export interface SearchOptions {
  locationId: string;
  limit?: number;
  /** 0-based pagination offset (Kroger `filter.start`). */
  start?: number;
}

export interface KrogerClient {
  /** Resolve a `preferred_location` label (e.g. "Kroger - 76104") to a locationId, cached. */
  resolveLocationId(label: string): Promise<string>;
  /** Term search at a location; returns priced, fulfillment-tagged candidates. */
  search(term: string, opts: SearchOptions): Promise<KrogerCandidate[]>;
  /** Look up a single product by SKU at a location (for cache revalidation). */
  productById(productId: string, locationId: string): Promise<KrogerCandidate | null>;
}

/** Mutable caches that live for the isolate's lifetime (token + resolved location). */
export interface KrogerCache {
  token: { accessToken: string; expiresAt: number } | null;
  locationId: string | null;
}

// Module-level singleton: persists across requests served by the same isolate,
// which is exactly the "isolate memory" lifetime the design calls for.
const moduleCache: KrogerCache = { token: null, locationId: null };

export interface KrogerClientOptions {
  fetch?: typeof fetch;
  cache?: KrogerCache;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Max concurrent in-flight Kroger HTTP requests this client will issue (default 6). */
  maxConcurrency?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Backoff with jitter: base * 2^(attempt-1), plus up to base jitter. */
function backoffMs(attempt: number, random: () => number): number {
  const base = 200;
  return base * 2 ** (attempt - 1) + Math.floor(random() * base);
}

function normalizeProduct(p: Record<string, unknown>): KrogerCandidate {
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  const item = items[0] ?? {};
  const price = (item.price as Record<string, unknown> | undefined) ?? {};
  const f = (item.fulfillment as Record<string, unknown> | undefined) ?? {};
  const al = item.aisleLocation as Record<string, unknown> | undefined;
  const aisleLocation =
    al && typeof al.number === "string" && typeof al.description === "string"
      ? {
          number: al.number,
          description: al.description,
          ...(typeof al.side === "string" ? { side: al.side } : {}),
        }
      : null;
  return {
    productId: String(p.productId ?? ""),
    brand: typeof p.brand === "string" ? p.brand : "",
    description: typeof p.description === "string" ? p.description : "",
    categories: Array.isArray(p.categories) ? (p.categories as string[]) : [],
    size: typeof item.size === "string" ? item.size : null,
    price: {
      regular: Number(price.regular ?? 0) || 0,
      promo: Number(price.promo ?? 0) || 0,
    },
    fulfillment: {
      curbside: Boolean(f.curbside),
      delivery: Boolean(f.delivery),
      inStore: Boolean(f.inStore),
    },
    aisleLocation,
  };
}

export function createKrogerClient(env: Env, opts: KrogerClientOptions = {}): KrogerClient {
  const doFetch = opts.fetch ?? fetch;
  const cache = opts.cache ?? moduleCache;
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? defaultSleep;
  // Per-client cap on in-flight requests. Callers fan out with Promise.all and
  // stay bounded automatically; the 429 backoff below is the cross-isolate backstop.
  const limiter = new Semaphore(opts.maxConcurrency ?? 6);

  async function getToken(): Promise<string> {
    if (cache.token && cache.token.expiresAt > now() + EXPIRY_SKEW_MS) {
      return cache.token.accessToken;
    }
    const credentials = btoa(`${env.KROGER_CLIENT_ID}:${env.KROGER_CLIENT_SECRET}`);
    const res = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
    });
    if (!res.ok) {
      throw new KrogerError(res.status, `Kroger token request failed (${res.status})`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new KrogerError(502, "Kroger token response missing access_token");
    }
    cache.token = {
      accessToken: json.access_token,
      expiresAt: now() + (json.expires_in ?? 1800) * 1000,
    };
    return cache.token.accessToken;
  }

  /** GET, bounded by the per-client concurrency limiter (permit held across the
   *  whole retry loop, so a backing-off request doesn't free its slot for more load). */
  function authedGet(url: string): Promise<Response> {
    return withPermit(limiter, () => doAuthedGet(url));
  }

  /** GET with bearer auth, token refresh on 401, and 429/5xx backoff. */
  async function doAuthedGet(url: string): Promise<Response> {
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const token = await getToken();
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.ok) return res;
      lastStatus = res.status;

      // A 401 likely means a stale/invalid token; drop it and retry fresh.
      if (res.status === 401) {
        cache.token = null;
        if (attempt < MAX_ATTEMPTS) continue;
      }
      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = res.headers.get("Retry-After");
        const wait =
          retryAfter && /^\d+$/.test(retryAfter.trim())
            ? parseInt(retryAfter.trim(), 10) * 1000
            : backoffMs(attempt, random);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, random));
        continue;
      }
      throw new KrogerError(res.status, `Kroger request failed (${res.status})`);
    }
    throw new KrogerError(lastStatus, "Kroger request exhausted retries");
  }

  async function resolveLocationId(label: string): Promise<string> {
    if (cache.locationId) return cache.locationId;
    // A pre-resolved Kroger locationId (stored in stores/<slug>.toml `location_id`) is
    // a compact alphanumeric string with no spaces. Bypass the Locations API lookup and
    // cache it directly so repeated in-store walks skip the resolution round-trip.
    if (!/\s/.test(label)) {
      cache.locationId = label;
      return cache.locationId;
    }
    const zip = label.match(/\d{5}/)?.[0];
    if (!zip) {
      throw new KrogerError(400, `Cannot parse a ZIP code from preferred_location "${label}"`);
    }
    const params = new URLSearchParams({ "filter.zipCode.near": zip, "filter.limit": "1" });
    const res = await authedGet(`${LOCATIONS_URL}?${params.toString()}`);
    const json = (await res.json()) as { data?: { locationId?: string }[] };
    const loc = json.data?.[0];
    if (!loc?.locationId) {
      throw new KrogerError(404, `No Kroger location found near ${zip}`);
    }
    cache.locationId = loc.locationId;
    return cache.locationId;
  }

  async function search(term: string, opts2: SearchOptions): Promise<KrogerCandidate[]> {
    const params = new URLSearchParams({
      "filter.term": term,
      "filter.locationId": opts2.locationId,
      "filter.limit": String(opts2.limit ?? 10),
    });
    if (opts2.start) params.set("filter.start", String(opts2.start));
    const res = await authedGet(`${PRODUCTS_URL}?${params.toString()}`);
    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    return (json.data ?? []).map(normalizeProduct);
  }

  async function productById(productId: string, locationId: string): Promise<KrogerCandidate | null> {
    const params = new URLSearchParams({
      "filter.productId": productId,
      "filter.locationId": locationId,
    });
    const res = await authedGet(`${PRODUCTS_URL}?${params.toString()}`);
    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    const first = json.data?.[0];
    return first ? normalizeProduct(first) : null;
  }

  return { resolveLocationId, search, productById };
}

/** Test helper: clear the module-level isolate caches. */
export function __resetModuleCache(): void {
  moduleCache.token = null;
  moduleCache.locationId = null;
}
