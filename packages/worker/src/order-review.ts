import {
  KNOWN_ORDER_REVIEW_CONTRACT_VERSION,
  emptyOrderReviewStage,
  orderReviewFingerprint,
  parseOrderReviewStage,
  type BrandSaveReceipt,
  type CatalogSearchResult,
  type OrderReviewData,
  type OrderReviewProduct,
  type OrderReviewSendResult,
  type OrderReviewStage,
} from "@yamp/contract";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { isFulfillable, isOnSale, relevanceScore } from "./matching.js";
import type { KrogerCandidate } from "./kroger.js";
import { readBrandTiers, readPreferences } from "./profile-db.js";
import { KROGER_STORE } from "./flyer-warm.js";
import { readGrocerySnapshot } from "./grocery-snapshot.js";
import { runPlaceOrder, type OrderWiring } from "./order-tools.js";
import type { PlaceOrderOutcome, ResolvedLine } from "./order-shapes.js";
import type { BrandTierPref } from "./preferences.js";
import { parseSize } from "./unit-price.js";

export interface OrderReviewDeps { wiring: OrderWiring }

export async function requireKrogerOrderReview(env: Env, tenant: string): Promise<void> {
  const stores = (await readPreferences(env, tenant))?.stores as Record<string, unknown> | undefined;
  const primary = typeof stores?.primary === "string" && stores.primary.trim()
    ? stores.primary.trim().toLowerCase() : KROGER_STORE;
  if (primary === KROGER_STORE) return;
  const fulfillment = typeof stores?.fulfillment === "string" ? stores.fulfillment : null;
  throw new ToolError("unsupported", fulfillment === "satellite"
    ? "the primary store is satellite-fulfilled — the cart is filled by the satellite helper, not a Kroger order"
    : "the primary store is a walk store — shop it as an in-store walk, not a Kroger order",
  { primary, flow: fulfillment === "satellite" ? "satellite-cart-fill" : "in-store-walk" });
}

function effectivePrice(candidate: KrogerCandidate): number {
  return isOnSale(candidate) ? candidate.price.promo : candidate.price.regular;
}

function compareCatalogCandidates(a: KrogerCandidate, b: KrogerCandidate): number {
  const sale = Number(isOnSale(b)) - Number(isOnSale(a));
  if (sale) return sale;
  const as = a.size ? parseSize(a.size) : null;
  const bs = b.size ? parseSize(b.size) : null;
  if (as && bs && as.dimension === bs.dimension) {
    const unit = effectivePrice(a) / as.quantity - effectivePrice(b) / bs.quantity;
    if (unit) return unit;
  }
  return effectivePrice(a) - effectivePrice(b) || a.productId.localeCompare(b.productId);
}

function product(candidate: KrogerCandidate): OrderReviewProduct {
  return {
    sku: candidate.productId,
    brand: candidate.brand,
    description: candidate.description,
    size: candidate.size,
    price: candidate.price,
    on_sale: isOnSale(candidate),
    fulfillment: { curbside: candidate.fulfillment.curbside, delivery: candidate.fulfillment.delivery },
    ...(candidate.aisleLocation ? { aisle: candidate.aisleLocation } : {}),
  };
}

function fromResolved(line: ResolvedLine): OrderReviewProduct {
  return {
    sku: line.sku, brand: line.brand, description: line.description, size: line.size,
    price: line.price ?? { regular: 0, promo: 0 }, on_sale: line.on_sale ?? false,
    fulfillment: line.fulfillment, ...(line.aisleLocation ? { aisle: line.aisleLocation } : {}),
  };
}

function normalizedStage(value?: unknown): OrderReviewStage {
  const stage = value == null ? emptyOrderReviewStage() : parseOrderReviewStage(value);
  return {
    skipped: [...new Set(stage.skipped)].sort(),
    quantities: Object.fromEntries(Object.entries(stage.quantities).sort(([a], [b]) => a.localeCompare(b))),
    selections: [...stage.selections].sort((a, b) => a.line_key.localeCompare(b.line_key)),
    impulses: [...stage.impulses].sort((a, b) => a.key.localeCompare(b.key)),
    saved_brands: [...stage.saved_brands].sort((a, b) => a.family_key.localeCompare(b.family_key) || a.brand.localeCompare(b.brand)),
  };
}

async function familyFingerprint(family: BrandTierPref | null): Promise<string> {
  return orderReviewFingerprint(family);
}

function reviewInput(stage: OrderReviewStage, preview: boolean) {
  const impulses = new Map(stage.impulses.map((impulse) => [impulse.key, impulse]));
  const nameOf = (key: string) => impulses.get(key)?.label ?? key;
  return {
    preview,
    exclude: stage.skipped.map(nameOf),
    quantities: Object.fromEntries(Object.entries(stage.quantities).map(([key, quantity]) => [nameOf(key), quantity])),
    overrides: [
      ...stage.selections.map((selection) => ({ name: impulses.get(selection.line_key)?.label ?? selection.line_key, sku: selection.sku })),
      ...stage.impulses.filter((impulse) => impulse.sku).map((impulse) => ({ name: impulse.label, sku: impulse.sku! })),
    ],
    menu_needs: stage.impulses.map((impulse) => ({ name: impulse.label, quantity: 1 })),
  };
}

async function sameIdentityOptions(wiring: OrderWiring, line: ResolvedLine): Promise<OrderReviewProduct[]> {
  const candidates = (await wiring.search(line.name)).filter(isFulfillable);
  const words = line.name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const max = candidates.length ? Math.max(...candidates.map((candidate) => relevanceScore(candidate, words))) : 0;
  return candidates
    .filter((candidate) => max > 0 && relevanceScore(candidate, words) === max && candidate.productId !== line.sku)
    .sort(compareCatalogCandidates)
    .slice(0, 12).map(product);
}

/** Shared write-free member/MCP preview. */
async function readOrderReviewUnchecked(
  env: Env,
  tenant: string,
  stageValue: unknown,
  deps: OrderReviewDeps,
): Promise<OrderReviewData> {
  await requireKrogerOrderReview(env, tenant);
  const stage = normalizedStage(stageValue);
  const [grocery, brands, outcome, locationId] = await Promise.all([
    readGrocerySnapshot(env, tenant), readBrandTiers(env, tenant),
    runPlaceOrder(env, tenant, reviewInput(stage, true), deps.wiring), deps.wiring.getLocationId(),
  ]);
  const groceryByKey = new Map(grocery.lines.map((line) => [line.key, line]));
  const selectionByKey = new Map(stage.selections.map((selection) => [selection.line_key, selection]));
  const impulseByLabel = new Map(stage.impulses.map((impulse) => [impulse.label.trim().toLowerCase(), impulse]));
  const matched = await Promise.all(outcome.resolved.map(async (line) => {
    const impulse = impulseByLabel.get(line.name.trim().toLowerCase());
    const publicKey = impulse?.key ?? line.key;
    const family = brands[line.key] ?? null;
    const options = await sameIdentityOptions(deps.wiring, line);
    return {
      line_key: publicKey, name: line.name, ...(groceryByKey.get(line.key)?.display_name ? { display_name: groceryByKey.get(line.key)!.display_name } : {}),
      quantity: line.quantity, assumed_quantity: line.assumed_quantity,
      for_recipes: groceryByKey.get(line.key)?.for_recipes ?? [], provenance: groceryByKey.has(line.key) ? "planned" as const : "impulse" as const,
      selected: fromResolved(line), selection_source: selectionByKey.get(publicKey)?.source ?? (impulse ? "impulse" as const : "matched" as const),
      options, ...(options[0] ? { featured_swap: options[0] } : {}), family_key: line.key,
      family_fingerprint: await familyFingerprint(family),
    };
  }));
  const decisions = await Promise.all(outcome.checkpoint.map(async (line) => {
    const impulse = impulseByLabel.get(line.name.trim().toLowerCase());
    const internalKey = line.key ?? grocery.lines.find((candidate) => candidate.name === line.name || candidate.display_name === line.name)?.key ?? line.name;
    const key = impulse?.key ?? internalKey;
    const family = brands[internalKey] ?? null;
    return {
      line_key: key, name: line.name, quantity: stage.quantities[key] ?? 1, assumed_quantity: stage.quantities[key] == null,
      for_recipes: groceryByKey.get(key)?.for_recipes ?? [], provenance: groceryByKey.has(key) ? "planned" as const : "impulse" as const,
      kind: line.kind === "ambiguous" ? "choose_one" as const : "unavailable" as const,
      candidates: line.candidates ?? [],
      family_key: internalKey, family_fingerprint: await familyFingerprint(family), can_save_brand: !impulse && line.kind === "ambiguous",
      can_search_broader: line.kind === "unavailable", can_search_manual: true,
    };
  }));
  const left_off = [
    ...stage.skipped.map((key) => ({ line_key: key, name: stage.impulses.find((impulse) => impulse.key === key)?.label ?? groceryByKey.get(key)?.display_name ?? groceryByKey.get(key)?.name ?? key, reason: "skipped" as const })),
    ...decisions.map((line) => ({ line_key: line.line_key, name: line.name, reason: line.kind === "choose_one" ? "undecided" as const : "unavailable" as const })),
    ...outcome.underived.map((name) => ({ line_key: name, name, reason: "underived" as const })),
  ];
  const total = matched.reduce((sum, line) => sum + effectivePrice({ ...line.selected, productId: line.selected.sku, categories: [], fulfillment: { ...line.selected.fulfillment, inStore: false }, aisleLocation: null }) * line.quantity, 0);
  const savings = matched.reduce((sum, line) => sum + (line.selected.on_sale ? Math.max(0, line.selected.price.regular - line.selected.price.promo) * line.quantity : 0), 0);
  const stable = {
    grocery_snapshot_version: grocery.snapshot_version, store: { name: "Kroger", location_id: locationId },
    stale_cart_count: grocery.in_cart_groups.reduce((sum, group) => sum + group.lines.length, 0), stage,
    brands, matched, decisions, left_off, underived: outcome.underived,
  };
  return {
    contract_version: KNOWN_ORDER_REVIEW_CONTRACT_VERSION,
    preview_fingerprint: await orderReviewFingerprint(stable), grocery_snapshot_version: grocery.snapshot_version,
    as_of: new Date().toISOString(), store: stable.store,
    quote_disclaimer: "Prices and promotions are current Kroger quotes; fulfillment may differ.",
    stale_cart_count: stable.stale_cart_count, cleared_cart_ack_required: stable.stale_cart_count > 0,
    matched, decisions, left_off, underived: [...outcome.underived].sort(),
    counts: { going_to_cart: matched.length, needs_decision: decisions.length, left_off: left_off.length },
    estimated_total: matched.length ? Math.round(total * 100) / 100 : null,
    flyer_savings: savings > 0 ? Math.round(savings * 100) / 100 : null, stage,
  };
}

async function authorizeStageSelections(
  env: Env, stage: OrderReviewStage, baseline: OrderReviewData, deps: OrderReviewDeps,
): Promise<void> {
  const lines = new Map([...baseline.matched, ...baseline.decisions].map((line) => [line.line_key, line]));
  const impulses = new Set(stage.impulses.map((impulse) => impulse.key));
  for (const selection of stage.selections) {
    const line = lines.get(selection.line_key);
    if (!line && !impulses.has(selection.line_key)) throw new ToolError("validation_failed", `unknown review line_key: ${selection.line_key}`);
    let issued = false;
    if (selection.source === "same_identity" && line) {
      const candidates = "selected" in line ? [line.selected, ...line.options] : line.candidates;
      issued = candidates.some((candidate) => candidate.sku === selection.sku);
    } else if (selection.source === "broader" && line && "kind" in line && line.kind === "unavailable" && selection.divergence?.rung !== "manual") {
      const ladder = await buildBroaderLadder(env, line.family_key);
      for (const rung of ladder) {
        const phrase = rung.search_term ?? rung.display_name ?? rung.id.replaceAll("_", " ");
        const found = (await deps.wiring.search(phrase)).filter(isFulfillable);
        if (!found.length) continue;
        issued = found.slice(0, 12).some((candidate) => candidate.productId === selection.sku);
        break;
      }
    } else if ((selection.source === "manual" || selection.source === "impulse") && selection.divergence?.rung === "manual") {
      const query = selection.divergence.searched_label.trim();
      if (query.length >= 2 && query.length <= 80) issued = (await deps.wiring.search(query)).filter(isFulfillable).slice(0, 20).some((candidate) => candidate.productId === selection.sku);
    }
    if (!issued) throw new ToolError("validation_failed", `SKU ${selection.sku} was not issued for ${selection.line_key}`);
  }
  for (const impulse of stage.impulses.filter((item) => item.sku)) {
    if (stage.selections.some((selection) => selection.line_key === impulse.key && selection.sku === impulse.sku)) continue;
    throw new ToolError("validation_failed", `impulse SKU ${impulse.sku} requires an authorized manual selection`);
  }
}

/** Shared write-free member/MCP preview with stateless server-evidence validation. */
export async function readOrderReview(
  env: Env, tenant: string, stageValue: unknown, deps: OrderReviewDeps,
): Promise<OrderReviewData> {
  const stage = normalizedStage(stageValue);
  if (stage.selections.length || stage.impulses.some((impulse) => impulse.sku)) {
    const baseline = await readOrderReviewUnchecked(env, tenant, emptyOrderReviewStage(), deps);
    await authorizeStageSelections(env, stage, baseline, deps);
  }
  return readOrderReviewUnchecked(env, tenant, stage, deps);
}

export function compareOrderReviews(previous: OrderReviewData, current: OrderReviewData) {
  const divergences: { category: "list" | "store" | "availability" | "selection" | "quantity" | "price" | "promotion" | "brand_preference"; line_key?: string; message: string }[] = [];
  if (previous.grocery_snapshot_version !== current.grocery_snapshot_version) divergences.push({ category: "list", message: "The grocery list changed." });
  if (previous.store?.location_id !== current.store?.location_id) divergences.push({ category: "store", message: "The selected Kroger location changed." });
  const before = new Map([...previous.matched, ...previous.decisions].map((line) => [line.line_key, line]));
  const after = new Map([...current.matched, ...current.decisions].map((line) => [line.line_key, line]));
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key); const b = after.get(key);
    if (!a || !b) { divergences.push({ category: "availability", line_key: key, message: `${key} changed availability.` }); continue; }
    if (a.quantity !== b.quantity) divergences.push({ category: "quantity", line_key: key, message: `${key} changed quantity.` });
    if ("selected" in a && "selected" in b) {
      if (a.selected.sku !== b.selected.sku) divergences.push({ category: "selection", line_key: key, message: `${key} changed selection.` });
      if (a.selected.price.regular !== b.selected.price.regular || a.selected.price.promo !== b.selected.price.promo) divergences.push({ category: "price", line_key: key, message: `${key} changed price.` });
      if (a.selected.on_sale !== b.selected.on_sale) divergences.push({ category: "promotion", line_key: key, message: `${key} changed promotion.` });
    }
    if (a.family_fingerprint !== b.family_fingerprint) divergences.push({ category: "brand_preference", line_key: key, message: `${key} brand preferences changed.` });
  }
  return divergences.length ? divergences : [{ category: "availability" as const, message: "Current Kroger facts changed." }];
}

async function persistedSendSummary(env: Env, tenant: string, sendId: string) {
  const rows = await db(env).all<{ unit_price: number | null; savings: number | null; quantity: number }>(
    "SELECT l.unit_price, l.savings, l.quantity FROM order_send_lines l JOIN order_sends s ON s.id=l.send_id WHERE s.tenant=?1 AND s.id=?2",
    tenant, sendId,
  );
  if (!rows.length) return null;
  return {
    item_count: rows.length,
    estimated_total: Math.round(rows.reduce((sum, row) => sum + (row.unit_price ?? 0) * row.quantity, 0) * 100) / 100,
    flyer_savings: Math.round(rows.reduce((sum, row) => sum + (row.savings ?? 0) * row.quantity, 0) * 100) / 100,
  };
}

async function verifiedBrands(env: Env, tenant: string, stage: OrderReviewStage) {
  const families = await readBrandTiers(env, tenant);
  return stage.saved_brands.filter((marker) => {
    const family = families[marker.family_key];
    return family && !family.any_brand && family.tiers[0]?.some((brand) => brand.toLowerCase() === marker.brand.toLowerCase());
  });
}

function sendSteps(outcome: PlaceOrderOutcome) {
  return {
    list: outcome.list, cart: outcome.cart,
    send: { ...outcome.send },
    cache: {
      committed: outcome.sku_cache.committed, inserted: outcome.sku_cache.inserted ?? [],
      updated: outcome.sku_cache.updated ?? [], unchanged: outcome.sku_cache.unchanged ?? [],
      ...(outcome.sku_cache.error ? { error: outcome.sku_cache.error } : {}),
    },
  };
}

function resolutionSignature(value: { matched: OrderReviewData["matched"]; decisions: OrderReviewData["decisions"] }): string {
  return JSON.stringify({
    resolved: value.matched.map((line) => ({ key: line.line_key, sku: line.selected.sku, quantity: line.quantity, price: line.selected.price, on_sale: line.selected.on_sale })).sort((a, b) => a.key.localeCompare(b.key)),
    checkpoint: value.decisions.map((line) => ({ key: line.line_key, kind: line.kind })).sort((a, b) => a.key.localeCompare(b.key)),
  });
}

/** Fingerprinted final preflight; no write happens before equality and gate checks. */
export async function sendOrderReview(
  env: Env, tenant: string,
  input: { stage: unknown; preview_fingerprint: string; cleared_cart_ack: boolean; rendered_preview?: OrderReviewData },
  deps: OrderReviewDeps,
): Promise<OrderReviewSendResult> {
  await requireKrogerOrderReview(env, tenant);
  const stage = normalizedStage(input.stage);
  const current = await readOrderReview(env, tenant, stage, deps);
  // A host may stage locally from an empty-stage authoritative preview. Accept that
  // exact baseline fingerprint while applying the complete posted stage; any external
  // list/store/price/preference drift changes the freshly recomputed baseline too.
  const baseline = stage.skipped.length || Object.keys(stage.quantities).length || stage.selections.length || stage.impulses.length || stage.saved_brands.length
    ? await readOrderReview(env, tenant, emptyOrderReviewStage(), deps) : current;
  if (current.preview_fingerprint !== input.preview_fingerprint && baseline.preview_fingerprint !== input.preview_fingerprint) {
    return { status: "review_changed", preview: current, divergences: input.rendered_preview ? compareOrderReviews(input.rendered_preview, current) : [{ category: "availability", message: "Current order facts changed." }] };
  }
  if (current.cleared_cart_ack_required && !input.cleared_cart_ack) return { status: "cart_clearance_required", preview: current };
  const expectedResolution = resolutionSignature(current);
  const impulseByLabel = new Map(stage.impulses.map((impulse) => [impulse.label.trim().toLowerCase(), impulse.key]));
  let outcome: PlaceOrderOutcome;
  try {
    outcome = await runPlaceOrder(env, tenant, reviewInput(stage, false), deps.wiring, {
      beforeCommit: (resolved, checkpoint) => {
        const actual = JSON.stringify({
          resolved: resolved.map((line) => ({ key: impulseByLabel.get(line.name.trim().toLowerCase()) ?? line.key, sku: line.sku, quantity: line.quantity, price: line.price ?? { regular: 0, promo: 0 }, on_sale: line.on_sale ?? false })).sort((a, b) => a.key.localeCompare(b.key)),
          checkpoint: checkpoint.map((line) => ({ key: impulseByLabel.get(line.name.trim().toLowerCase()) ?? line.key ?? line.name, kind: line.kind === "ambiguous" ? "choose_one" : "unavailable" })).sort((a, b) => a.key.localeCompare(b.key)),
        });
        if (actual !== expectedResolution) throw new ToolError("conflict", "review changed during final revalidation");
      },
    });
  } catch (error) {
    if (error instanceof ToolError && error.code === "conflict") {
      const refreshed = await readOrderReview(env, tenant, stage, deps);
      return { status: "review_changed", preview: refreshed, divergences: compareOrderReviews(current, refreshed) };
    }
    throw error;
  }
  const steps = sendSteps(outcome);
  if (!outcome.list.advanced && outcome.list.error?.includes("order review changed while claiming")) {
    const refreshed = await readOrderReview(env, tenant, stage, deps);
    return { status: "review_changed", preview: refreshed, divergences: compareOrderReviews(current, refreshed) };
  }
  if (outcome.send.recorded && outcome.send.id) {
    const summary = await persistedSendSummary(env, tenant, outcome.send.id);
    if (summary) steps.send = { ...steps.send, ...summary };
    else steps.send = { recorded: false, error: "persisted send summary unavailable" };
  }
  const unresolved = new Map(current.left_off.map((line) => [line.line_key, line]));
  for (const checkpoint of outcome.checkpoint) {
    const key = current.decisions.find((line) => line.name === checkpoint.name)?.line_key ?? checkpoint.name;
    unresolved.set(key, { line_key: key, name: checkpoint.name, reason: "revalidation_failed" });
  }
  const common = { steps, left_off: [...unresolved.values()], verified_saved_brands: await verifiedBrands(env, tenant, stage) };
  return outcome.cart.written ? { status: "sent", ...common } : { status: "send_failed", ...common };
}

export async function saveOrderBrandPreference(
  env: Env, tenant: string,
  input: { family_key: string; brand: string; expected_family_fingerprint: string },
): Promise<BrandSaveReceipt> {
  await requireKrogerOrderReview(env, tenant);
  const familyKey = input.family_key.trim(); const brand = input.brand.trim();
  if (!familyKey || !brand) throw new ToolError("validation_failed", "family_key and brand are required");
  const current = (await readBrandTiers(env, tenant))[familyKey] ?? null;
  const currentFingerprint = await familyFingerprint(current);
  const tiers = (current?.tiers ?? []).map((tier) => tier.filter((entry) => entry.toLowerCase() !== brand.toLowerCase()));
  if (!tiers.length) tiers.push([]);
  if (!tiers[0].some((entry) => entry.toLowerCase() === brand.toLowerCase())) tiers[0].push(brand);
  const desired = { tiers: tiers.filter((tier) => tier.length > 0), any_brand: false };
  const exact = current != null && JSON.stringify(current) === JSON.stringify(desired);
  if (input.expected_family_fingerprint !== currentFingerprint && !exact) {
    return { status: "conflict", family_key: familyKey, family: current, family_fingerprint: currentFingerprint };
  }
  if (!exact) {
    if (current) {
      const result = await db(env).run(
        "UPDATE brand_prefs SET tiers=?1, any_brand=0 WHERE tenant=?2 AND term=?3 AND tiers=?4 AND any_brand=?5",
        JSON.stringify(desired.tiers), tenant, familyKey, JSON.stringify(current.tiers), current.any_brand ? 1 : 0,
      );
      if (result.changes !== 1) {
        const latest = (await readBrandTiers(env, tenant))[familyKey] ?? null;
        return { status: "conflict", family_key: familyKey, family: latest, family_fingerprint: await familyFingerprint(latest) };
      }
    } else {
      const result = await db(env).run(
        "INSERT INTO brand_prefs (tenant, term, tiers, any_brand) VALUES (?1, ?2, ?3, 0) ON CONFLICT(tenant, term) DO NOTHING",
        tenant, familyKey, JSON.stringify(desired.tiers),
      );
      if (result.changes !== 1) {
        const latest = (await readBrandTiers(env, tenant))[familyKey] ?? null;
        return { status: "conflict", family_key: familyKey, family: latest, family_fingerprint: await familyFingerprint(latest) };
      }
    }
  }
  return { status: "saved", family_key: familyKey, brand, family: desired, family_fingerprint: await familyFingerprint(desired), changed: !exact };
}

/** Transport-facing guard: the family and brand must still be present on the named
 * same-identity review line under the supplied current preview fingerprint. */
export async function saveOrderReviewBrand(
  env: Env, tenant: string,
  input: { family_key: string; line_key: string; brand: string; expected_family_fingerprint: string; preview_fingerprint: string; stage: unknown },
  deps: OrderReviewDeps,
): Promise<BrandSaveReceipt> {
  const stage = normalizedStage(input.stage);
  const review = await readOrderReview(env, tenant, stage, deps);
  const baseline = await readOrderReview(env, tenant, emptyOrderReviewStage(), deps);
  if (review.preview_fingerprint !== input.preview_fingerprint && baseline.preview_fingerprint !== input.preview_fingerprint)
    return { status: "conflict", family_key: input.family_key, family: (await readBrandTiers(env, tenant))[input.family_key] ?? null, family_fingerprint: await familyFingerprint((await readBrandTiers(env, tenant))[input.family_key] ?? null) };
  const line = [...review.matched, ...review.decisions].find((candidate) => candidate.line_key === input.line_key && candidate.family_key === input.family_key);
  const allowedSource = line && "selected" in line
    ? line.selection_source === "matched" || line.selection_source === "same_identity"
    : line?.kind === "choose_one" && line.can_save_brand;
  const brands = line && "selected" in line ? [line.selected, ...line.options] : line?.candidates ?? [];
  if (!line || !allowedSource || !brands.some((candidate) => candidate.brand.trim().toLowerCase() === input.brand.trim().toLowerCase()))
    throw new ToolError("validation_failed", "brand must be a current same-identity review candidate");
  return saveOrderBrandPreference(env, tenant, input);
}

interface LadderRow { id: string; display_name: string | null; search_term: string | null; kind?: "general" | "containment" }

export async function buildBroaderLadder(env: Env, requested: string): Promise<LadderRow[]> {
  const node = await db(env).first<{ id: string; representative: string | null; concrete: number; display_name: string | null; search_term: string | null }>(
    "SELECT id, representative, concrete, display_name, search_term FROM ingredient_identity WHERE id=?1", requested,
  );
  if (!node) return [];
  const survivor = node.representative ?? node.id;
  const ancestors = await db(env).all<LadderRow>(
    "SELECT COALESCE(r.id,i.id) AS id, COALESCE(r.display_name,i.display_name) AS display_name, " +
      "COALESCE(r.search_term,i.search_term) AS search_term, e.kind FROM ingredient_edge e " +
      "JOIN ingredient_identity i ON i.id=e.dst LEFT JOIN ingredient_identity r ON r.id=i.representative " +
      "WHERE e.src=?1 AND e.kind IN ('general','containment') AND COALESCE(r.concrete,i.concrete)=1 " +
      "ORDER BY CASE e.kind WHEN 'general' THEN 0 ELSE 1 END, COALESCE(r.id,i.id)",
    survivor,
  );
  const rows: LadderRow[] = [...ancestors];
  if (survivor.includes("::")) {
    const base = survivor.split("::")[0];
    const baseNode = await db(env).first<LadderRow>("SELECT id, display_name, search_term FROM ingredient_identity WHERE id=?1", base);
    rows.push(baseNode ?? { id: base, display_name: null, search_term: base.replaceAll("_", " ") });
  }
  rows.push({ id: survivor, display_name: node.display_name, search_term: node.search_term });
  const seen = new Set<string>();
  return rows.filter((row) => {
    const phrase = (row.search_term ?? row.display_name ?? row.id.replaceAll("_", " ")).trim().toLowerCase();
    if (!phrase || seen.has(phrase)) return false; seen.add(phrase); return true;
  }).slice(0, 3);
}

export async function searchOrderBroader(
  env: Env, tenant: string, lineKey: string, previewFingerprint: string, stage: unknown, deps: OrderReviewDeps,
): Promise<CatalogSearchResult> {
  await requireKrogerOrderReview(env, tenant);
  const review = await readOrderReview(env, tenant, stage, deps);
  if (review.preview_fingerprint !== previewFingerprint) throw new ToolError("conflict", "order review changed; refresh before searching");
  if (!review.decisions.some((line) => line.line_key === lineKey && line.kind === "unavailable"))
    throw new ToolError("validation_failed", "broader search is available only for a current unavailable review line");
  const ladder = await buildBroaderLadder(env, lineKey);
  for (const rung of ladder) {
    const phrase = rung.search_term ?? rung.display_name ?? rung.id.replaceAll("_", " ");
    const found = (await deps.wiring.search(phrase)).filter(isFulfillable);
    if (!found.length) continue;
    const tokens = phrase.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const candidates = found.sort((a, b) => relevanceScore(b, tokens) - relevanceScore(a, tokens) || compareCatalogCandidates(a, b)).slice(0, 12)
      .map((candidate) => ({ ...product(candidate), divergence: { rung: rung.kind ?? (rung.id === lineKey ? "search_term" as const : "base" as const), requested_label: lineKey, searched_label: phrase, ...(rung.kind ? { relation: rung.kind } : {}), missing_constraints: lineKey.split(/[_: -]+/).filter((token) => token.length > 2 && !`${candidate.description} ${candidate.categories.join(" ")}`.toLowerCase().includes(token.toLowerCase())), candidate_terms: candidate.description.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3).slice(0, 5) } }));
    return { contract_version: KNOWN_ORDER_REVIEW_CONTRACT_VERSION, preview_fingerprint: previewFingerprint, line_key: lineKey, query: phrase, mode: "broader", candidates };
  }
  return { contract_version: KNOWN_ORDER_REVIEW_CONTRACT_VERSION, preview_fingerprint: previewFingerprint, line_key: lineKey, query: "", mode: "broader", candidates: [] };
}

export async function searchOrderCatalog(env: Env, tenant: string, lineKey: string, previewFingerprint: string, stageValue: unknown, queryValue: string, deps: OrderReviewDeps): Promise<CatalogSearchResult> {
  await requireKrogerOrderReview(env, tenant);
  const query = queryValue.trim();
  if (query.length < 2 || query.length > 80) throw new ToolError("validation_failed", "query must be 2–80 characters");
  const stage = normalizedStage(stageValue);
  const review = await readOrderReview(env, tenant, stage, deps);
  if (review.preview_fingerprint !== previewFingerprint) throw new ToolError("conflict", "order review changed; refresh before searching");
  const known = [...review.matched, ...review.decisions].some((line) => line.line_key === lineKey) || stage.impulses.some((impulse) => impulse.key === lineKey);
  if (!known) throw new ToolError("validation_failed", "line_key must name a current review or staged impulse line");
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const candidates = (await deps.wiring.search(query)).filter(isFulfillable)
    .sort((a, b) => relevanceScore(b, tokens) - relevanceScore(a, tokens) || compareCatalogCandidates(a, b))
    .slice(0, 20).map((candidate) => ({ ...product(candidate), divergence: { rung: "manual" as const, requested_label: lineKey, searched_label: query, missing_constraints: [], candidate_terms: candidate.description.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3).slice(0, 5) } }));
  return { contract_version: KNOWN_ORDER_REVIEW_CONTRACT_VERSION, preview_fingerprint: previewFingerprint, line_key: lineKey, query, mode: "manual", candidates };
}
