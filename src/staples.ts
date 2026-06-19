// Pure helpers for the staples list (staples.toml). Mirrors stockup.ts:
// read existing, apply add-only (deduped by normalized name) and remove-by-name
// ops, preserve the leading doc header, return the new text plus what changed.
// The per-tenant `read_staples` / `update_staples` tools wrap these; keeping
// them pure makes them unit-testable off `workerd`.

import { parseToml } from "./parse.js";
import { stringifyTomlWithHeader } from "./serialize.js";
import { normalizeName } from "./grocery.js";

export const STAPLES_PATH = "staples.toml";

const STAPLES_HEADER =
  "# staples.toml — must-have items list (agent-writable via update_staples).\n" +
  "# Add-only with dedup by normalized name; remove by name. Absent file is\n" +
  "# valid — all staples-driven behaviors degrade gracefully to no-ops.";

export interface StaplesItem {
  name: string;
  perishable?: boolean;
}

function rowsOf(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

function compactItem(item: StaplesItem): Record<string, unknown> {
  const out: Record<string, unknown> = { name: item.name };
  if (item.perishable === true) out.perishable = true;
  return out;
}

/**
 * Parse staples.toml and return the items array. Returns [] when the file is
 * absent or unparseable — the caller can treat either as an empty list.
 */
export function parseStaples(raw: string | null): StaplesItem[] {
  if (!raw) return [];
  let parsed: Record<string, unknown> = {};
  try {
    parsed = parseToml(raw, STAPLES_PATH);
  } catch {
    return [];
  }
  return rowsOf(parsed).map((r) => ({
    name: typeof r.name === "string" ? r.name : String(r.name ?? ""),
    ...(r.perishable === true ? { perishable: true } : {}),
  }));
}

/**
 * Apply add/remove operations to staples.toml. Adds are deduped by normalized
 * name (existing rows untouched); removes match by normalized name (absent name
 * is a silent no-op). Returns the new file text and the counts.
 */
export function updateStaples(
  existingRaw: string | null,
  add: StaplesItem[],
  remove: string[],
): { text: string; added: number; removed: number; changed: boolean } {
  let parsed: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      parsed = parseToml(existingRaw, STAPLES_PATH);
    } catch {
      parsed = {};
    }
  }

  let rows = [...rowsOf(parsed)];

  // Build a normalized-name index of current rows.
  const have = new Map<string, number>(
    rows
      .map((r, i) => [normalizeName(typeof r.name === "string" ? r.name : ""), i] as [string, number])
      .filter(([k]) => k !== ""),
  );

  let added = 0;
  for (const item of add) {
    const key = normalizeName(item.name);
    if (!key || have.has(key)) continue;
    have.set(key, rows.length);
    rows.push(compactItem(item));
    added++;
  }

  let removed = 0;
  const removeKeys = new Set(remove.map((n) => normalizeName(n)).filter(Boolean));
  if (removeKeys.size > 0) {
    const before = rows.length;
    rows = rows.filter((r) => {
      const key = normalizeName(typeof r.name === "string" ? r.name : "");
      return !removeKeys.has(key);
    });
    removed = before - rows.length;
  }

  const text = stringifyTomlWithHeader(existingRaw ?? STAPLES_HEADER, { ...parsed, items: rows });
  return { text, added, removed, changed: added > 0 || removed > 0 };
}
