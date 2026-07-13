import type { Env } from "./env.js";
import { deleteExpiredInstacartLinks, readInstacartLink, upsertInstacartLink } from "./db.js";
import { computeToBuyView } from "./to-buy.js";
import type { ToBuyView, ToBuyViewLine } from "./order-shapes.js";
import type { InstacartHandoffErrorCode, InstacartHandoffResult } from "./instacart-shapes.js";
export type { InstacartHandoffErrorCode, InstacartHandoffResult } from "./instacart-shapes.js";

export const INSTACART_ORIGINS = {
  development: "https://connect.dev.instacart.tools",
  production: "https://connect.instacart.com",
} as const;
const LINK_DAYS = 30;
const CACHE_SAFETY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export interface InstacartConfig { apiKey: string; environment: keyof typeof INSTACART_ORIGINS; origin: string }
export function getInstacartConfig(env: Pick<Env, "INSTACART_API_KEY" | "INSTACART_API_ENV">): InstacartConfig | null {
  const apiKey = env.INSTACART_API_KEY?.trim();
  const environment = env.INSTACART_API_ENV;
  if (!apiKey || (environment !== "development" && environment !== "production")) return null;
  return { apiKey, environment, origin: INSTACART_ORIGINS[environment] };
}

export interface InstacartLineItem {
  name: string;
  display_text: string;
  line_item_measurements: [{ quantity: number; unit: "package" }];
}
export interface InstacartPayload {
  title: "Yamp grocery list";
  link_type: "shopping_list";
  expires_in: 30;
  line_items: InstacartLineItem[];
}

function packageQuantity(line: ToBuyViewLine): number {
  const n = Number(line.quantity);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Locale-independent UTF-16 code-unit order, matching canonical JSON construction. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildInstacartPayload(view: ToBuyView): InstacartPayload {
  const line_items = [...view.to_buy]
    .sort((a, b) => compareCodeUnits(a.key, b.key))
    .map((line) => ({
      name: line.name.trim(),
      display_text: (line.display_name ?? line.name).trim(),
      line_item_measurements: [{ quantity: packageQuantity(line), unit: "package" as const }] as [{ quantity: number; unit: "package" }],
    }));
  return { title: "Yamp grocery list", link_type: "shopping_list", expires_in: LINK_DAYS, line_items };
}

export async function hashInstacartPayload(payload: InstacartPayload): Promise<string> {
  const bytes = new TextEncoder().encode(`instacart-products-link-v1\n${JSON.stringify(payload)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validMarketplaceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "instacart.com" || url.hostname.endsWith(".instacart.com"));
  } catch { return false; }
}

export interface InstacartClient {
  create(payload: InstacartPayload): Promise<{ ok: true; url: string } | { ok: false; code: InstacartHandoffErrorCode; retryable: boolean }>;
}

export function createInstacartClient(config: InstacartConfig, fetcher: typeof fetch = fetch): InstacartClient {
  return {
    async create(payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetcher(`${config.origin}/idp/v1/products/products_link`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(payload), signal: controller.signal,
          // A redirected POST would forward the Bearer token and request body. Refuse
          // redirects at fetch itself; the two permitted origins are compile-time fixed.
          redirect: "error",
        });
        if (!response.ok) {
          if (response.status === 400) return { ok: false, code: "invalid_request", retryable: false };
          if (response.status === 401) return { ok: false, code: "unauthorized", retryable: false };
          if (response.status === 403) return { ok: false, code: "forbidden", retryable: false };
          if (response.status === 429) return { ok: false, code: "rate_limited", retryable: true };
          return { ok: false, code: "upstream_unavailable", retryable: response.status >= 500 };
        }
        let body: unknown;
        try { body = await response.json(); } catch { return { ok: false, code: "invalid_response", retryable: false }; }
        const url = (body as { products_link_url?: unknown })?.products_link_url;
        return validMarketplaceUrl(url)
          ? { ok: true, url }
          : { ok: false, code: "invalid_response", retryable: false };
      } catch {
        return { ok: false, code: "upstream_unavailable", retryable: true };
      } finally { clearTimeout(timer); }
    },
  };
}

export interface InstacartHandoffDeps {
  readToBuy?: (env: Env, tenant: string) => Promise<ToBuyView>;
  client?: InstacartClient;
  now?: () => Date;
}

export async function createInstacartHandoff(env: Env, tenant: string, deps: InstacartHandoffDeps = {}): Promise<InstacartHandoffResult> {
  const config = getInstacartConfig(env);
  if (!config) return { status: "unavailable", code: "not_configured" };
  const view = await (deps.readToBuy ?? ((e, t) => computeToBuyView(e, t)))(env, tenant);
  const underived = [...view.underived].sort(compareCodeUnits);
  if (view.to_buy.length === 0) return { status: "empty", item_count: 0, underived };
  const payload = buildInstacartPayload(view);
  const contentHash = await hashInstacartPayload(payload);
  const now = (deps.now ?? (() => new Date()))();
  const reusableAfter = new Date(now.getTime() + CACHE_SAFETY_MS).toISOString();
  const cached = await readInstacartLink(env, tenant, contentHash);
  if (cached && cached.expires_at > reusableAfter && validMarketplaceUrl(cached.url)) {
    return { status: "ready", url: cached.url, expires_at: cached.expires_at, reused: true, item_count: payload.line_items.length, underived, destination: "instacart_marketplace" };
  }
  const created = await (deps.client ?? createInstacartClient(config)).create(payload);
  if (!created.ok) return { status: "error", code: created.code, retryable: created.retryable };
  // Injection is a testability seam, not a trust boundary bypass. Revalidate every
  // successful client result before it can be cached or returned.
  if (!validMarketplaceUrl(created.url)) return { status: "error", code: "invalid_response", retryable: false };
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + LINK_DAYS * 86_400_000).toISOString();
  await upsertInstacartLink(env, { tenant, content_hash: contentHash, url: created.url, expires_at: expiresAt, created_at: createdAt });
  // Cleanup is opportunistic; a valid newly cached handoff must not be downgraded
  // because an unrelated expired-row sweep failed after the authoritative upsert.
  await deleteExpiredInstacartLinks(env, tenant, createdAt).catch(() => {});
  return { status: "ready", url: created.url, expires_at: expiresAt, reused: false, item_count: payload.line_items.length, underived, destination: "instacart_marketplace" };
}
