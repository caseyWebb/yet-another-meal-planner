import type { AisleMapDocument, AisleMapEntry, AisleMapWrite, GroceryLine, OfflineWalkRouteGroup } from "@yamp/contract";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { readStoreRow } from "./corpus-db.js";

export const AISLE_MAP_STALE_MS = 180 * 24 * 60 * 60 * 1000;

interface StoreNoteRow {
  id: string; author: string; body: string; tags: string | null; private: number | null;
  created_at: string | null; updated_at: string | null;
}

function tagsOf(value: string | null): string[] {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []; }
  catch { return []; }
}

export function normalizeAisleId(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^aisle\s+/, "").replace(/\s+/g, " ");
}

export function parseLayoutNote(body: string): { aisle_id: string; label: string; order: number | null; sections: string[] } | null {
  const match = body.match(/^\s*(?:aisle\s+)?([^:]+?)\s*:\s*(.+?)\s*$/i);
  if (!match) return null;
  const label = match[1]!.trim();
  const aisle_id = normalizeAisleId(label);
  const sections = [...new Set(match[2]!.split(/[,;|]/).map((s) => s.trim()).filter(Boolean))];
  if (!aisle_id || sections.length === 0) return null;
  const number = label.match(/\d+(?:\.\d+)?/)?.[0];
  return { aisle_id, label, order: number == null ? null : Number(number), sections };
}

export function serializeLayoutNote(entry: { label: string; sections: string[] }): string {
  return `Aisle ${entry.label.trim().replace(/^aisle\s+/i, "")}: ${entry.sections.map((s) => s.trim()).filter(Boolean).join(", ")}`;
}

export function parseLocationNote(body: string): { item: string; aisle: string } | null {
  const aisleFirst = body.match(/^\s*aisle\s+([^:]+?)\s*:\s*(.+?)\s*$/i);
  if (aisleFirst) {
    const aisle = normalizeAisleId(aisleFirst[1]!);
    const item = norm(aisleFirst[2]!);
    return item && aisle ? { item, aisle } : null;
  }
  const match = body.match(/^\s*(.+?)\s*:\s*(?:aisle\s+)?([^,;]+?)(?:\s*[,;].*)?$/i);
  if (!match) return null;
  const item = match[1]!.trim().toLocaleLowerCase();
  const aisle = normalizeAisleId(match[2]!);
  return item && aisle ? { item, aisle } : null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return `sha256:${[...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function entryOf(row: StoreNoteRow): AisleMapEntry | null {
  const parsed = parseLayoutNote(row.body);
  if (!parsed) return null;
  return {
    ...parsed,
    visibility: row.private === 1 ? "private" : "shared",
    observed_at: row.updated_at ?? row.created_at ?? "",
    note_id: row.id,
    author: row.author,
  };
}

function entryCmp(a: AisleMapEntry, b: AisleMapEntry): number {
  return (a.order == null ? 1 : 0) - (b.order == null ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label) || a.aisle_id.localeCompare(b.aisle_id);
}

function noteRecency(row: StoreNoteRow): string { return row.updated_at ?? row.created_at ?? ""; }
function newestNote(a: StoreNoteRow, b: StoreNoteRow): number { return noteRecency(b).localeCompare(noteRecency(a)) || b.id.localeCompare(a.id); }

async function readAisleMapSnapshot(env: Env, storeSlug: string, viewerTenant: string, now = new Date()): Promise<{ map: AisleMapDocument; visibleLayout: StoreNoteRow[] }> {
  if (!(await readStoreRow(env, storeSlug))) throw new ToolError("not_found", `Unknown store: ${storeSlug}`);
  const rows = await db(env).all<StoreNoteRow>(
    "SELECT id,author,body,tags,private,created_at,updated_at FROM store_notes WHERE store=?1 AND (private=0 OR author=?2) ORDER BY id",
    storeSlug, viewerTenant,
  );
  const participating = rows.filter((row) => tagsOf(row.tags).includes("layout"));
  const parsed = participating.map((row) => ({ row, entry: entryOf(row) })).filter((x): x is { row: StoreNoteRow; entry: AisleMapEntry } => x.entry !== null);
  const winners = new Map<string, AisleMapEntry>();
  for (const { entry } of parsed) {
    const prior = winners.get(entry.aisle_id);
    if (!prior || entry.observed_at > prior.observed_at || (entry.observed_at === prior.observed_at && entry.note_id > prior.note_id)) winners.set(entry.aisle_id, entry);
  }
  const effective = [...winners.values()].map(({ author: _author, ...entry }) => entry).sort(entryCmp);
  const mine = parsed.filter(({ row }) => row.author === viewerTenant).map(({ entry }) => entry).sort(entryCmp);
  const as_of = effective.reduce<string | null>((latest, entry) => !latest || entry.observed_at > latest ? entry.observed_at : latest, null);
  const state = effective.length === 0 ? "unknown" : as_of && now.getTime() - Date.parse(as_of) > AISLE_MAP_STALE_MS ? "stale" : "mapped";
  const etag = `"${await digest(participating.map((row) => ({ id: row.id, body: row.body, tags: tagsOf(row.tags), private: row.private === 1, recency: row.updated_at ?? row.created_at ?? "" })))}"`;
  return { map: { store_slug: storeSlug, effective, mine, summary: { state, aisle_count: effective.length, as_of }, etag }, visibleLayout: participating };
}

export async function readAisleMap(env: Env, storeSlug: string, viewerTenant: string, now = new Date()): Promise<AisleMapDocument> {
  return (await readAisleMapSnapshot(env, storeSlug, viewerTenant, now)).map;
}

export async function reconcileAisleMap(env: Env, storeSlug: string, tenant: string, expectedEtag: string, input: AisleMapWrite): Promise<{ status: "ok" | "conflict"; map: AisleMapDocument }> {
  const snapshot = await readAisleMapSnapshot(env, storeSlug, tenant);
  const current = snapshot.map;
  if (current.etag !== expectedEtag) return { status: "conflict", map: current };
  const wanted = new Map<string, AisleMapWrite["entries"][number]>();
  for (const raw of input.entries) {
    const aisle_id = normalizeAisleId(raw.aisle_id || raw.label);
    if (!aisle_id || wanted.has(aisle_id)) throw new ToolError("validation_failed", `aisle ids must be non-empty and unique: ${aisle_id}`);
    const sections = [...new Set(raw.sections.map((s) => s.trim()).filter(Boolean))];
    if (!sections.length) throw new ToolError("validation_failed", `Aisle ${raw.label} needs at least one section`);
    wanted.set(aisle_id, { ...raw, aisle_id, sections });
  }
  const visibleLayout = snapshot.visibleLayout;
  const ownLayout = visibleLayout.filter((row) => row.author === tenant);
  const byAisle = new Map<string, StoreNoteRow[]>();
  for (const row of ownLayout) {
    const parsed = parseLayoutNote(row.body);
    if (parsed) byAisle.set(parsed.aisle_id, [...(byAisle.get(parsed.aisle_id) ?? []), row]);
  }
  const now = new Date().toISOString();
  const leaseCutoff = new Date(Date.parse(now) - 60_000).toISOString();
  const token = crypto.randomUUID();
  const expectedRows = JSON.stringify(visibleLayout.map((row) => ({ id: row.id, author: row.author, body: row.body, tags: row.tags, private: row.private, created_at: row.created_at, updated_at: row.updated_at })));
  const currentRowsSql = "(SELECT COALESCE(json_group_array(json_object('id',id,'author',author,'body',body,'tags',tags,'private',private,'created_at',created_at,'updated_at',updated_at)),'[]') FROM (SELECT id,author,body,tags,private,created_at,updated_at FROM store_notes WHERE store=?1 AND (private=0 OR author=?2) AND EXISTS (SELECT 1 FROM json_each(COALESCE(tags,'[]')) WHERE value='layout') ORDER BY id))";
  const claimExists = "EXISTS (SELECT 1 FROM aisle_map_reconcile_claims WHERE tenant=?2 AND store_slug=?1 AND token=?3)";
  const stmts: D1PreparedStatement[] = [db(env).prepare(
    `INSERT INTO aisle_map_reconcile_claims (tenant,store_slug,token,created_at) SELECT ?2,?1,?3,?4 WHERE ${currentRowsSql}=?5 ON CONFLICT(tenant,store_slug) DO UPDATE SET token=excluded.token,created_at=excluded.created_at WHERE aisle_map_reconcile_claims.created_at<?6`,
    storeSlug, tenant, token, now, expectedRows, leaseCutoff,
  )];
  for (const row of ownLayout) {
    const parsed = parseLayoutNote(row.body);
    const group = parsed ? byAisle.get(parsed.aisle_id) ?? [] : [];
    const survivor = group.sort(newestNote)[0];
    if (!parsed || !wanted.has(parsed.aisle_id) || row.id !== survivor?.id) stmts.push(db(env).prepare(`DELETE FROM store_notes WHERE id=?4 AND author=?2 AND ${claimExists}`, storeSlug, tenant, token, row.id));
  }
  let sequence = 0;
  for (const [aisleId, entry] of wanted) {
    const existing = (byAisle.get(aisleId) ?? []).sort(newestNote)[0];
    const body = serializeLayoutNote(entry);
    if (existing) {
      if (existing.body !== body || (existing.private === 1) !== (entry.visibility === "private")) stmts.push(db(env).prepare(`UPDATE store_notes SET body=?4,tags='[\"layout\"]',private=?5,updated_at=?6 WHERE id=?7 AND author=?2 AND ${claimExists}`, storeSlug, tenant, token, body, entry.visibility === "private" ? 1 : 0, now, existing.id));
    } else {
      const created = new Date(Date.parse(now) + sequence++).toISOString();
      stmts.push(db(env).prepare(`INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) SELECT ?4,?1,?2,?5,'[\"layout\"]',?6,?7,?7 WHERE ${claimExists}`, storeSlug, tenant, token, `${tenant} ${storeSlug} ${created}`, body, entry.visibility === "private" ? 1 : 0, created));
    }
  }
  stmts.push(db(env).prepare(`INSERT INTO aisle_map_reconcile_receipts (token,tenant,store_slug,created_at) SELECT ?3,?2,?1,?4 WHERE ${claimExists}`, storeSlug, tenant, token, now));
  stmts.push(db(env).prepare("DELETE FROM aisle_map_reconcile_claims WHERE tenant=?2 AND store_slug=?1 AND token=?3", storeSlug, tenant, token));
  await db(env).batch(stmts);
  const receipt = await db(env).first<{ token: string }>("SELECT token FROM aisle_map_reconcile_receipts WHERE token=?1", token);
  if (receipt) await db(env).run("DELETE FROM aisle_map_reconcile_receipts WHERE token=?1", token);
  const map = await readAisleMap(env, storeSlug, tenant);
  return receipt ? { status: "ok", map } : { status: "conflict", map };
}

function norm(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function isCold(line: GroceryLine): boolean { const section = norm(line.placement?.section ?? ""); return /(^| )(frozen|refrigerated|dairy|meat|seafood)( |$)/.test(section); }

export async function routeOfflineLines(env: Env, tenant: string, storeSlug: string, lines: GroceryLine[], map: AisleMapDocument): Promise<OfflineWalkRouteGroup[]> {
  const notes = await db(env).all<StoreNoteRow>("SELECT id,author,body,tags,private,created_at,updated_at FROM store_notes WHERE store=?1 AND (private=0 OR author=?2)", storeSlug, tenant);
  const locationWinners = new Map<string, { location: NonNullable<ReturnType<typeof parseLocationNote>>; row: StoreNoteRow }>();
  for (const row of notes.filter((n) => tagsOf(n.tags).includes("location"))) {
    const location = parseLocationNote(row.body);
    if (!location) continue;
    const prior = locationWinners.get(location.item);
    if (!prior || newestNote(row, prior.row) < 0) locationWinners.set(location.item, { location, row });
  }
  const locations = [...locationWinners.values()].map(({ location }) => location);
  const sections = new Map<string, AisleMapEntry>();
  for (const aisle of map.effective) for (const section of aisle.sections) sections.set(norm(section), aisle);
  const grouped = new Map<string, OfflineWalkRouteGroup>();
  const add = (id: string, label: string, source: OfflineWalkRouteGroup["placement_source"], key: string) => {
    const group = grouped.get(id) ?? { id, label, placement_source: source, line_keys: [], warning: map.summary.state === "stale" && source !== "unmapped" ? "stale_map" : null };
    group.line_keys.push(key); grouped.set(id, group);
  };
  for (const line of lines.filter((l) => l.status !== "in_cart" && l.status !== "ordered")) {
    if (isCold(line)) { add("cold-last", "Grab last", "cold_last", line.key); continue; }
    const exact = locations.find((location) => location.item === norm(line.key) || location.item === norm(line.display_name ?? line.name));
    const mapped = exact ? map.effective.find((a) => a.aisle_id === exact.aisle) : sections.get(norm(line.placement?.section ?? ""));
    if (mapped) add(`aisle:${mapped.aisle_id}`, `Aisle ${mapped.label}`, exact ? "location_note" : "section_map", line.key);
    else add("unmapped", "Anywhere / Not mapped", "unmapped", line.key);
  }
  const aisleOrder = new Map(map.effective.map((entry, i) => [`aisle:${entry.aisle_id}`, i]));
  return [...grouped.values()].sort((a, b) => (aisleOrder.get(a.id) ?? (a.id === "cold-last" ? 10_000 : 20_000)) - (aisleOrder.get(b.id) ?? (b.id === "cold-last" ? 10_000 : 20_000)) || a.label.localeCompare(b.label));
}
