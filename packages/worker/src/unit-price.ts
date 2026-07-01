// Deterministic price-per-unit core (design D10). One pure module, two callers:
// the `compare_unit_price` MCP tool and the matcher's step-5 tiebreaker. It
// parses raw price + size strings, converts to a per-dimension base unit, and
// divides — the LLM never does the arithmetic. Ranking happens WITHIN a single
// dimension (volume / weight / count); cross-dimension or unparseable items are
// returned as `incomparable` rather than mis-ranked.

export type Dimension = "volume" | "weight" | "count";

/** A size resolved to a dimension and a quantity expressed in that dimension's base unit. */
export interface ParsedSize {
  dimension: Dimension;
  /** Quantity in the dimension's base unit (volume→ml, weight→g, count→ct). */
  quantity: number;
}

interface UnitDef {
  dimension: Dimension;
  /** Multiplier to the dimension's base unit. */
  factor: number;
}

// Base units: volume→milliliter, weight→gram, count→each. "fl oz" is volume and
// is looked up as an exact token, so it never collides with weight "oz".
const UNIT_TABLE: Record<string, UnitDef> = {
  // volume
  "fl oz": { dimension: "volume", factor: 29.5735 },
  floz: { dimension: "volume", factor: 29.5735 },
  "fluid ounce": { dimension: "volume", factor: 29.5735 },
  "fluid ounces": { dimension: "volume", factor: 29.5735 },
  ml: { dimension: "volume", factor: 1 },
  milliliter: { dimension: "volume", factor: 1 },
  milliliters: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1000 },
  ltr: { dimension: "volume", factor: 1000 },
  liter: { dimension: "volume", factor: 1000 },
  liters: { dimension: "volume", factor: 1000 },
  gal: { dimension: "volume", factor: 3785.41 },
  gallon: { dimension: "volume", factor: 3785.41 },
  gallons: { dimension: "volume", factor: 3785.41 },
  qt: { dimension: "volume", factor: 946.353 },
  quart: { dimension: "volume", factor: 946.353 },
  quarts: { dimension: "volume", factor: 946.353 },
  pt: { dimension: "volume", factor: 473.176 },
  pint: { dimension: "volume", factor: 473.176 },
  pints: { dimension: "volume", factor: 473.176 },
  cup: { dimension: "volume", factor: 236.588 },
  cups: { dimension: "volume", factor: 236.588 },
  // weight
  oz: { dimension: "weight", factor: 28.3495 },
  ounce: { dimension: "weight", factor: 28.3495 },
  ounces: { dimension: "weight", factor: 28.3495 },
  lb: { dimension: "weight", factor: 453.592 },
  lbs: { dimension: "weight", factor: 453.592 },
  pound: { dimension: "weight", factor: 453.592 },
  pounds: { dimension: "weight", factor: 453.592 },
  g: { dimension: "weight", factor: 1 },
  gram: { dimension: "weight", factor: 1 },
  grams: { dimension: "weight", factor: 1 },
  kg: { dimension: "weight", factor: 1000 },
  kilogram: { dimension: "weight", factor: 1000 },
  kilograms: { dimension: "weight", factor: 1000 },
  // count
  ct: { dimension: "count", factor: 1 },
  cnt: { dimension: "count", factor: 1 },
  count: { dimension: "count", factor: 1 },
  ea: { dimension: "count", factor: 1 },
  each: { dimension: "count", factor: 1 },
  pk: { dimension: "count", factor: 1 },
  pack: { dimension: "count", factor: 1 },
  packs: { dimension: "count", factor: 1 },
  piece: { dimension: "count", factor: 1 },
  pieces: { dimension: "count", factor: 1 },
};

const BASE_UNIT: Record<Dimension, string> = { volume: "ml", weight: "g", count: "ct" };

/** Parse a leading numeric quantity: integer, decimal, fraction, or mixed number. */
function parseNumber(raw: string): number | null {
  const s = raw.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  if (/^\d*\.?\d+$/.test(s)) return parseFloat(s);
  return null;
}

/** Resolve a unit token (already lowercased/trimmed) to its dimension + base factor. */
function lookupUnit(token: string): UnitDef | null {
  return UNIT_TABLE[token] ?? null;
}

/**
 * Parse a raw Kroger size string ("16.9 fl oz", "1/2 gal", "6 ct", "12 x 1 oz")
 * into a dimension and a base-unit quantity. Returns null for anything the
 * grammar can't handle ("Family Size", "1 bunch") — the caller routes those to
 * `incomparable`.
 */
export function parseSize(raw: string): ParsedSize | null {
  if (!raw) return null;
  let s = raw.toLowerCase().trim();

  // Multi-pack prefix: "12 x 1 oz", "6x12 fl oz". The leading count multiplies
  // the per-unit size.
  let multiplier = 1;
  const pack = s.match(/^(\d+)\s*[x×]\s*(.+)$/);
  if (pack) {
    multiplier = parseInt(pack[1], 10);
    s = pack[2].trim();
  }

  const m = s.match(/^([\d.\/\s]+?)\s*([a-z][a-z ]*)$/);
  if (!m) return null;
  const num = parseNumber(m[1]);
  if (num === null) return null;
  const unit = lookupUnit(m[2].trim());
  if (!unit) return null;

  const quantity = num * unit.factor * multiplier;
  // A degenerate quantity (zero/negative/non-finite — e.g. "0 x 1 oz", a "1/0"
  // fraction, a zero multiplier) routes to `incomparable` rather than yielding a
  // 0 or non-finite unit price that could sort first and mis-pick as cheapest.
  if (!(quantity > 0) || !Number.isFinite(quantity)) return null;
  return { dimension: unit.dimension, quantity };
}

/** Resolve an explicit quantity + unit override into a base-unit quantity. */
export function resolveOverride(quantity: number, unit: string): ParsedSize | null {
  const def = lookupUnit(unit.toLowerCase().trim());
  if (!def) return null;
  const q = quantity * def.factor;
  // Same finite-positive guard as parseSize: a quantity_override of 0 (or a
  // non-finite product) is incomparable, not a divide-by-zero unit price.
  if (!(q > 0) || !Number.isFinite(q)) return null;
  return { dimension: def.dimension, quantity: q };
}

/**
 * Strip currency formatting and parse a US-formatted price string or number.
 * Fails closed (returns null → `incomparable`) on input that can't be parsed
 * unambiguously, rather than silently mis-scaling it: a leading negative sign
 * (nonsensical for a price; the old code dropped it), a decimal-comma locale
 * ("1.234,56"), or a malformed multi-dot string ("1.2.3"). Kroger's own prices
 * arrive as numbers, so the numeric branch is unchanged.
 */
export function parsePrice(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  // A leading minus (after an optional currency symbol) → reject, so we neither
  // silently drop the sign nor rank a negative price as "cheapest".
  if (/^[^\d]*-/.test(trimmed)) return null;
  const numeric = trimmed.replace(/[^0-9.,]/g, "");
  if (numeric === "") return null;
  // A comma after the last dot is a decimal-comma locale ("1.234,56") — ambiguous.
  const lastDot = numeric.lastIndexOf(".");
  if (lastDot !== -1 && numeric.indexOf(",") > lastDot) return null;
  const cleaned = numeric.replace(/,/g, ""); // strip US grouping separators
  if ((cleaned.match(/\./g)?.length ?? 0) > 1) return null; // >1 decimal point → malformed
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface UnitPriceItem {
  id: string;
  price: string | number;
  size: string;
  quantity_override?: number;
  unit_override?: string;
}

export interface RankedUnitPrice {
  id: string;
  unit_price: number;
  base_unit: string;
}

export interface UnitPriceResult {
  ranked: RankedUnitPrice[];
  cheapest: string | null;
  incomparable: string[];
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Rank items by ascending price-per-base-unit within a single dimension. The
 * dimension chosen is the largest parseable group (ties broken by first
 * appearance, then volume→weight→count). Items outside that dimension, with
 * unparseable sizes, or with unparseable prices land in `incomparable`.
 */
export function compareUnitPrice(items: UnitPriceItem[]): UnitPriceResult {
  interface Resolved {
    id: string;
    price: number;
    size: ParsedSize;
  }
  const resolved: Resolved[] = [];
  const incomparable: string[] = [];

  for (const it of items) {
    const price = parsePrice(it.price);
    const size =
      it.unit_override !== undefined && it.quantity_override !== undefined
        ? resolveOverride(it.quantity_override, it.unit_override)
        : parseSize(it.size);
    if (price === null || size === null) {
      incomparable.push(it.id);
      continue;
    }
    resolved.push({ id: it.id, price, size });
  }

  if (resolved.length === 0) {
    return { ranked: [], cheapest: null, incomparable };
  }

  // Group by dimension, then choose the largest group (most comparable items).
  const groups = new Map<Dimension, Resolved[]>();
  for (const r of resolved) {
    const g = groups.get(r.size.dimension) ?? [];
    g.push(r);
    groups.set(r.size.dimension, g);
  }
  // First-seen order for tie-breaking among equally-sized groups.
  const order: Dimension[] = [];
  for (const r of resolved) if (!order.includes(r.size.dimension)) order.push(r.size.dimension);
  let chosen: Dimension = order[0];
  for (const dim of order) {
    if ((groups.get(dim)?.length ?? 0) > (groups.get(chosen)?.length ?? 0)) chosen = dim;
  }

  const chosenGroup = groups.get(chosen) ?? [];
  for (const r of resolved) {
    if (r.size.dimension !== chosen) incomparable.push(r.id);
  }

  const ranked: RankedUnitPrice[] = chosenGroup
    .map((r) => ({ id: r.id, unit_price: round(r.price / r.size.quantity), base_unit: BASE_UNIT[chosen] }))
    .sort((a, b) => a.unit_price - b.unit_price);

  return { ranked, cheapest: ranked[0]?.id ?? null, incomparable };
}
