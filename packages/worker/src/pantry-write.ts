// Pure pantry mutation logic (data-write-tools capability). The tool wrapper
// supplies the current items and today's date; this applies add/remove/verify/dispose
// operations and reports what was applied vs. what conflicted (e.g. a remove
// whose target isn't present), so the agent can ask the user to resolve. A `dispose`
// removal additionally returns a waste-event DRAFT (waste only) for the row plane to
// persist; field validation (the location/category vocabularies and the D21 legacy
// shim) runs here so the MCP tool and the /api pantry area enforce identical rules.
// Shape violations that must be a whole-call `validation_failed` are surfaced by
// `pantryOperationShapeError` (distinct from per-op conflicts) so wrappers can throw
// a ToolError; this module stays pure (no env, no throws).

import {
  PANTRY_LOCATIONS,
  PANTRY_CATEGORIES,
  WASTE_REASONS,
  LEGACY_CATEGORY_TO_LOCATION,
} from "./department.js";

export type PantryItem = Record<string, unknown> & {
  name?: unknown;
  /** The STORED canonical dedup key (the D1 `normalized_name` / PK). Carried on the shape so the
   *  match/merge keys on the stored id, never a re-derivation of the (independent) display. */
  normalized_name?: unknown;
  /** The human-facing label, stored independently of `name` (resolver input) and the key. */
  display_name?: unknown;
};

export interface PantryOperation {
  op: "add" | "remove" | "verify" | "dispose";
  /** For add: the full item object. */
  item?: Record<string, unknown>;
  /** For remove/verify/dispose: the item name (or read from `item.name`). */
  name?: string;
  /** dispose: consumed (`used`, pure removal) vs tossed (`waste`, records an event). */
  disposition?: "used" | "waste";
  /** dispose waste: the canonical waste-reason enum (required). */
  reason?: string;
  /** dispose waste: the client-minted idempotency key (ULID); server-minted when absent. */
  event_id?: string;
  /** dispose waste: ISO date (YYYY-MM-DD) the toss happened; defaults to today. */
  occurred_at?: string;
}

export interface AppliedOp {
  op: PantryOperation["op"];
  name: string;
  merged?: boolean;
  /** dispose only: which disposition was applied. */
  disposition?: "used" | "waste";
}

export interface ConflictOp {
  op: PantryOperation["op"];
  name: string;
  reason: string;
}

/** One accepted-and-dropped/converted field report (the D21 per-op warning shape). */
export interface WarningOp {
  op: PantryOperation["op"];
  name: string;
  field: string;
  reason: string;
}

/** A waste event awaiting persistence: the disposed ROW's snapshot plus the op's waste
 *  fields. `category` is the row's stored category — the department stamp's step-2 input
 *  (design D5); the row plane resolves the memo, mints a missing id, and stamps. */
export interface WasteEventDraft {
  /** The client-minted event id, when the op supplied one. */
  id?: string;
  /** The row's display label at capture (`display_name ?? name`). */
  name: string;
  /** The row's stored canonical ingredient id. */
  item_id: string;
  prepared_from: string | null;
  quantity: string | null;
  /** The row's stored category at capture (department-stamp input, not persisted as-is). */
  category: string | null;
  reason: string;
  occurred_at?: string;
}

export interface PantryApplyResult {
  items: PantryItem[];
  applied: AppliedOp[];
  conflicts: ConflictOp[];
  /** D21 accepted-and-dropped / converted field reports; empty when none. */
  warnings: WarningOp[];
  /** Waste-event drafts for applied `disposition: "waste"` disposes; empty when none. */
  wasteEvents: WasteEventDraft[];
}

function nameOf(op: PantryOperation): string {
  if (typeof op.name === "string") return op.name;
  const n = op.item?.name;
  return typeof n === "string" ? n : "";
}

function matches(item: PantryItem, name: string, normalize: (s: string) => string): boolean {
  // Key the EXISTING item on its STORED `normalized_name` (the trusted key) when present, else the
  // re-derived `normalize(item.name)` for a fixture — never on a re-derivation of a display that may
  // no longer equal the key. Only the QUERY side (`name`) derives its key via `normalize`.
  const key =
    typeof item.normalized_name === "string"
      ? item.normalized_name
      : typeof item.name === "string"
        ? normalize(item.name)
        : null;
  return key !== null && key === normalize(name);
}

/** The client-minted event-id format (D15): 1–64 chars of [A-Za-z0-9_-] (a ULID fits). */
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shape-validate one operation. Returns a message for a violation that must be a
 * whole-call `validation_failed` (missing/unknown disposition, waste without/with an
 * unknown reason, malformed event id or date) — matching the `/api` area's
 * shape-validation posture — or null when the op is well-shaped. Semantic misses
 * (no such row) are per-op conflicts in `applyPantryOperations`, never reported here.
 */
export function pantryOperationShapeError(op: PantryOperation, index: number): string | null {
  if (op.op !== "dispose") return null;
  if (op.disposition !== "used" && op.disposition !== "waste") {
    return `operations[${index}]: dispose requires disposition "used" | "waste"`;
  }
  if (op.disposition === "waste") {
    if (typeof op.reason !== "string" || !(WASTE_REASONS as readonly string[]).includes(op.reason)) {
      return `operations[${index}]: a waste dispose requires reason, one of ${WASTE_REASONS.join(" | ")}`;
    }
  }
  if (op.event_id !== undefined && (typeof op.event_id !== "string" || !EVENT_ID_RE.test(op.event_id))) {
    return `operations[${index}]: event_id must be 1-64 chars of [A-Za-z0-9_-]`;
  }
  if (op.occurred_at !== undefined && (typeof op.occurred_at !== "string" || !ISO_DATE_RE.test(op.occurred_at))) {
    return `operations[${index}]: occurred_at must be an ISO date (YYYY-MM-DD)`;
  }
  return null;
}

/**
 * Field-validate an add's item against the controlled vocabularies (design D7), shared by
 * the tool and the `/api` area through the one apply path. Returns either a per-op conflict
 * reason (off-vocabulary `location` — never a silent write) or a sanitized item copy plus
 * any D21 warnings: a legacy location-flavored `category` (pantry|fridge|freezer|spices) is
 * transposed onto `location` (category left unset) for one deprecation window; any other
 * off-vocabulary `category` is accepted-and-dropped (stored NULL, warned, never rejected —
 * the classifier fills the NULL).
 */
function validateItemFields(
  op: PantryOperation,
  name: string,
  item: Record<string, unknown>,
  warnings: WarningOp[],
): { conflict: string } | { item: Record<string, unknown> } {
  const next = { ...item };
  if (next.location !== undefined && next.location !== null) {
    if (typeof next.location !== "string" || !(PANTRY_LOCATIONS as readonly string[]).includes(next.location)) {
      return { conflict: `location must be one of ${PANTRY_LOCATIONS.join(" | ")}` };
    }
  }
  if (next.category !== undefined && next.category !== null) {
    const raw = typeof next.category === "string" ? next.category.trim().toLowerCase() : null;
    if (raw !== null && (PANTRY_CATEGORIES as readonly string[]).includes(raw)) {
      next.category = raw;
    } else if (raw !== null && raw in LEGACY_CATEGORY_TO_LOCATION) {
      // The D21 shim: a stale writer's legacy category IS a location — preserve the intent.
      if (next.location === undefined || next.location === null) {
        next.location = LEGACY_CATEGORY_TO_LOCATION[raw];
      }
      delete next.category;
      warnings.push({
        op: op.op,
        name,
        field: "category",
        reason: `legacy location value "${raw}" transposed onto location — write location directly; category is the food taxonomy now`,
      });
    } else {
      delete next.category;
      warnings.push({
        op: op.op,
        name,
        field: "category",
        reason: `off-vocabulary category dropped (stored uncategorized; the classifier derives it) — use one of ${PANTRY_CATEGORIES.join(" | ")}`,
      });
    }
  }
  return { item: next };
}

/**
 * Apply pantry operations in order, returning the new item list plus a report. `normalize`
 * maps a name to its match/dedup key; it defaults to `.toLowerCase()` (today's behavior, so
 * existing callers/tests are unaffected). Production injects `IngredientContext.resolve` —
 * pantry is food by construction (kitchen inventory), so it always keys on the canonical id,
 * merging surface-form variants ("scallions" ≡ "green onions").
 */
export function applyPantryOperations(
  items: PantryItem[],
  operations: PantryOperation[],
  today: string,
  normalize: (s: string) => string = (s) => s.toLowerCase(),
): PantryApplyResult {
  let next: PantryItem[] = items.map((it) => ({ ...it }));
  const applied: AppliedOp[] = [];
  const conflicts: ConflictOp[] = [];
  const warnings: WarningOp[] = [];
  const wasteEvents: WasteEventDraft[] = [];

  for (const op of operations) {
    const name = nameOf(op);

    if (op.op === "add") {
      if (!name) {
        conflicts.push({ op: "add", name, reason: "add requires a name (set `name` or `item.name`)" });
        continue;
      }
      const validated = validateItemFields(op, name, op.item ?? {}, warnings);
      if ("conflict" in validated) {
        conflicts.push({ op: "add", name, reason: validated.conflict });
        continue;
      }
      const incoming = validated.item;
      const existingIdx = next.findIndex((it) => matches(it, name, normalize));
      if (existingIdx >= 0) {
        const existing = next[existingIdx];
        next[existingIdx] = {
          ...existing,
          ...incoming,
          // Keep-first display (C3): the surviving row keeps its existing `name` and `display_name`
          // rather than adopting the incoming surface form, so a merge never fragments the label.
          name: existing.name,
          display_name: existing.display_name,
          added_at: existing.added_at,
          last_verified_at: today,
        };
        applied.push({ op: "add", name, merged: true });
      } else {
        const item: PantryItem = {
          added_at: today,
          last_verified_at: today,
          prepared_from: null,
          ...incoming,
          name,
        };
        next.push(item);
        applied.push({ op: "add", name });
      }
      continue;
    }

    if (op.op === "remove") {
      const before = next.length;
      next = next.filter((it) => !matches(it, name, normalize));
      if (next.length === before) {
        conflicts.push({ op: "remove", name, reason: "no pantry item with that name" });
      } else {
        applied.push({ op: "remove", name });
      }
      continue;
    }

    if (op.op === "dispose") {
      // A dispose of an untracked item is a per-op conflict (design D3) — the event snapshots
      // the ROW's stored identity, so there is no rowless waste capture. The row plane
      // short-circuits an already-recorded event_id to applied BEFORE this runs (replay).
      const idx = next.findIndex((it) => matches(it, name, normalize));
      if (idx < 0) {
        conflicts.push({ op: "dispose", name, reason: "no pantry item with that name" });
        continue;
      }
      const row = next[idx];
      next.splice(idx, 1);
      applied.push({ op: "dispose", name, disposition: op.disposition });
      if (op.disposition === "waste") {
        const draft: WasteEventDraft = {
          name:
            typeof row.display_name === "string" && row.display_name
              ? row.display_name
              : typeof row.name === "string" && row.name
                ? row.name
                : name,
          item_id: typeof row.normalized_name === "string" ? row.normalized_name : normalize(name),
          prepared_from: typeof row.prepared_from === "string" ? row.prepared_from : null,
          quantity: typeof row.quantity === "string" ? row.quantity : null,
          category: typeof row.category === "string" ? row.category : null,
          reason: op.reason ?? "other",
        };
        if (op.event_id !== undefined) draft.id = op.event_id;
        if (op.occurred_at !== undefined) draft.occurred_at = op.occurred_at;
        wasteEvents.push(draft);
      }
      continue;
    }

    // verify
    const target = next.find((it) => matches(it, name, normalize));
    if (!target) {
      conflicts.push({ op: "verify", name, reason: "no pantry item with that name" });
    } else {
      target.last_verified_at = today;
      applied.push({ op: "verify", name });
    }
  }

  return { items: next, applied, conflicts, warnings, wasteEvents };
}

/** Reset last_verified_at to `today` on the named items. Returns verified + missing names. */
export function markVerified(
  items: PantryItem[],
  names: string[],
  today: string,
  normalize: (s: string) => string = (s) => s.toLowerCase(),
): { items: PantryItem[]; verified: string[]; missing: string[] } {
  const next = items.map((it) => ({ ...it }));
  const verified: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const target = next.find((it) => matches(it, name, normalize));
    if (target) {
      target.last_verified_at = today;
      verified.push(name);
    } else {
      missing.push(name);
    }
  }
  return { items: next, verified, missing };
}
