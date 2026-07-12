import { ShopCommitRequestSchema, type ShopCommitRequest, type ShopCommitResult, type ShopReceipt, type ShopReceiptLine } from "@yamp/contract";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { readStoreRow } from "./corpus-db.js";
import { readGrocerySnapshot } from "./grocery-snapshot.js";
import { readGroceryList } from "./session-db.js";
import { readStoreFlyer } from "./flyer-warm.js";
import { shopReceiptSpendStatements } from "./spend.js";
import { ToolError } from "./errors.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function shopRequestHash(value: ShopCommitRequest): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return `sha256:${[...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function purchaseCount(quantity: string | number): { count: number; assumed: boolean } {
  if (typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0) return { count: quantity, assumed: false };
  const raw = String(quantity).trim();
  const match = raw.match(/^(\d+)\b/);
  if (match && Number(match[1]) > 0) return { count: Number(match[1]), assumed: false };
  return { count: 1, assumed: true };
}
function n(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function norm(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

interface PriceResult { source: ShopReceiptLine["price_source"]; unit: number | null; savings: number | null }

async function estimateLine(env: Env, tenant: string, store: { slug: string; location_id?: string } | null, key: string, name: string, now: number): Promise<PriceResult> {
  if (store?.location_id) {
    const cached = await db(env).first<{ price_regular: number | null; price_promo: number | null; price_captured_at: string | null }>(
      "SELECT price_regular,price_promo,price_captured_at FROM sku_cache WHERE ingredient=?1 AND location_id=?2 AND price_captured_at IS NOT NULL ORDER BY price_captured_at DESC LIMIT 1", key, store.location_id,
    );
    if (cached && cached.price_captured_at && now - Date.parse(cached.price_captured_at) <= 30 * 24 * 60 * 60 * 1000 && cached.price_regular != null) {
      const promo = cached.price_promo ?? cached.price_regular;
      return { source: "sku_cache", unit: promo > 0 && promo < cached.price_regular ? promo : cached.price_regular, savings: promo > 0 && promo < cached.price_regular ? n(cached.price_regular - promo) : 0 };
    }
    const flyer = await readStoreFlyer(env.KROGER_KV as never, store.slug, store.location_id).catch(() => null);
    if (flyer && now - flyer.as_of <= 14 * 24 * 60 * 60 * 1000) {
      const wanted = new Set([norm(key), norm(name)]);
      const item = flyer.items.find((row) => row.matched_terms.some((term) => wanted.has(norm(term))) || wanted.has(norm(row.description)));
      if (item) return { source: "flyer", unit: item.price.promo > 0 ? item.price.promo : item.price.regular, savings: item.savings };
    }
  }
  const paid = await db(env).first<{ unit_price: number }>(
    "SELECT unit_price FROM spend_events WHERE tenant=?1 AND line_key=?2 AND voided_at IS NULL AND unit_price IS NOT NULL ORDER BY occurred_on DESC,send_id DESC LIMIT 1", tenant, key,
  );
  return paid ? { source: "last_paid", unit: paid.unit_price, savings: null } : { source: "unpriced", unit: null, savings: null };
}

interface ExistingCommit { request_hash: string; receipt_json: string }

export async function commitCheckedShop(env: Env, tenant: string, raw: ShopCommitRequest): Promise<ShopCommitResult> {
  const parsed = ShopCommitRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ToolError("validation_failed", parsed.error.issues[0]?.message ?? "Invalid shop commit");
  const request = parsed.data;
  const requestHash = await shopRequestHash(request);
  const prior = await db(env).first<ExistingCommit>("SELECT request_hash,receipt_json FROM shop_commits WHERE tenant=?1 AND session_id=?2", tenant, request.session_id);
  if (prior) {
    const receipt = JSON.parse(prior.receipt_json) as ShopReceipt;
    return prior.request_hash === requestHash
      ? { outcome: "replayed", receipt, snapshot: await readGrocerySnapshot(env, tenant) }
      : { outcome: "idempotency_conflict", receipt };
  }

  const registry = request.mode === "store_walk" ? await readStoreRow(env, request.store_slug!) : null;
  if (request.mode === "store_walk" && !registry) throw new ToolError("not_found", `Unknown store: ${request.store_slug}`);
  const domain = registry?.domain ?? "grocery";
  const snapshot = await readGrocerySnapshot(env, tenant);
  const rows = (await readGroceryList(env, tenant)).filter((row) => row.status === "active" && row.checked_at != null && row.domain === domain);
  const keys = rows.map((row) => row.normalized_name!).sort();
  if (snapshot.snapshot_version !== request.snapshot_version || keys.length !== request.expected_checked_keys.length || keys.some((key, i) => key !== request.expected_checked_keys[i])) {
    return { outcome: "checked_set_changed", current_checked_keys: keys, snapshot };
  }
  if (!rows.length) throw new ToolError("validation_failed", "A shop commit requires at least one eligible checked row");

  const committedAt = new Date().toISOString();
  const store = registry ? { slug: registry.slug, location_id: registry.location_id } : null;
  const departmentRows = await db(env).all<{ id: string; category: string | null }>(`SELECT id,category FROM ingredient_identity WHERE id IN (${rows.map((_, i) => `?${i + 1}`).join(",")})`, ...rows.map((r) => r.normalized_name));
  const departments = new Map(departmentRows.map((r) => [r.id, r.category]));
  const lines: ShopReceiptLine[] = [];
  for (const row of rows.sort((a, b) => a.normalized_name!.localeCompare(b.normalized_name!))) {
    const quantity = purchaseCount(row.quantity);
    const price = row.kind === "grocery" && row.domain === "grocery" ? await estimateLine(env, tenant, store, row.normalized_name!, row.display_name ?? row.name, Date.parse(committedAt)) : { source: "unpriced" as const, unit: null, savings: null };
    lines.push({
      key: row.normalized_name!, name: row.display_name ?? row.name, quantity: row.quantity,
      purchase_count: quantity.count, quantity_assumed: quantity.assumed, kind: row.kind, domain: row.domain,
      pantry_received: row.kind === "grocery" && row.domain === "grocery", price_source: price.source,
      unit_price: price.unit, amount: price.unit == null ? null : n(price.unit * quantity.count),
      savings: price.savings == null ? null : n(price.savings * quantity.count), department: departments.get(row.normalized_name!) ?? null,
      provenance: row.source === "menu" || row.for_recipes.length ? "planned" : "impulse",
    });
  }
  const receipt: ShopReceipt = {
    session_id: request.session_id, mode: request.mode, store_slug: registry?.slug ?? null, domain,
    occurred_at: request.occurred_at, committed_at: committedAt, lines,
    totals: { items: lines.length, priced: lines.filter((l) => l.amount != null).length, amount: n(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)), savings: n(lines.reduce((sum, l) => sum + (l.savings ?? 0), 0)) },
  };
  const d = db(env);
  const binds: unknown[] = [tenant, request.session_id, requestHash, request.mode, registry?.slug ?? null, domain, request.occurred_at, committedAt, JSON.stringify(receipt), rows.length];
  const rowPredicates = rows.map((row) => {
    const base = binds.length;
    binds.push(row.normalized_name!, row.row_version, row.checked_at!);
    return `(normalized_name=?${base + 1} AND row_version=?${base + 2} AND checked_at=?${base + 3})`;
  });
  const stmts: D1PreparedStatement[] = [d.prepare(
    "INSERT INTO shop_commits (tenant,session_id,request_hash,mode,store_slug,domain,occurred_at,committed_at,receipt_json) " +
      "SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9 WHERE ?10=(SELECT COUNT(*) FROM grocery_list WHERE tenant=?1 AND status='active' AND checked_at IS NOT NULL AND domain=?6) " +
      `AND ?10=(SELECT COUNT(*) FROM grocery_list WHERE tenant=?1 AND (${rowPredicates.join(" OR ")})) ON CONFLICT(tenant,session_id) DO NOTHING`, ...binds,
  )];
  for (const line of lines) stmts.push(d.prepare("INSERT INTO shop_commit_lines (tenant,session_id,line_key,line_json) SELECT ?1,?2,?3,?4 WHERE EXISTS (SELECT 1 FROM shop_commits WHERE tenant=?1 AND session_id=?2 AND request_hash=?5)", tenant, request.session_id, line.key, JSON.stringify(line), requestHash));
  for (const line of lines.filter((l) => l.pantry_received)) stmts.push(d.prepare(
    "INSERT INTO pantry (tenant,name,normalized_name,display_name,quantity,category,added_at,last_verified_at) " +
      "SELECT ?1,?2,?3,?2,?4,?5,?6,?6 WHERE EXISTS (SELECT 1 FROM shop_commits WHERE tenant=?1 AND session_id=?7 AND request_hash=?8) " +
      "ON CONFLICT(tenant,normalized_name) DO UPDATE SET quantity=excluded.quantity,last_verified_at=excluded.last_verified_at",
    tenant, line.name, line.key, String(line.quantity), line.department, request.occurred_at.slice(0, 10), request.session_id, requestHash,
  ));
  stmts.push(...shopReceiptSpendStatements(env, tenant, request.session_id, request.mode, registry?.slug ?? null, request.occurred_at, lines, { requestHash }));
  for (const row of rows) stmts.push(d.prepare("DELETE FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND row_version=?3 AND checked_at=?4 AND EXISTS (SELECT 1 FROM shop_commits WHERE tenant=?1 AND session_id=?5 AND request_hash=?6)", tenant, row.normalized_name!, row.row_version, row.checked_at!, request.session_id, requestHash));
  await d.batch(stmts);
  const claimed = await d.first<ExistingCommit>("SELECT request_hash,receipt_json FROM shop_commits WHERE tenant=?1 AND session_id=?2", tenant, request.session_id);
  if (!claimed) {
    const fresh = await readGrocerySnapshot(env, tenant);
    const current = (await readGroceryList(env, tenant)).filter((row) => row.status === "active" && row.checked_at != null && row.domain === domain).map((row) => row.normalized_name!).sort();
    return { outcome: "checked_set_changed", current_checked_keys: current, snapshot: fresh };
  }
  if (claimed.request_hash !== requestHash) return { outcome: "idempotency_conflict", receipt: JSON.parse(claimed.receipt_json) as ShopReceipt };
  return { outcome: "committed", receipt, snapshot: await readGrocerySnapshot(env, tenant) };
}
