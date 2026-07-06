// Roll up a run's locally-dropped items into the compact `local_rejects` wire summary
// (satellite-source-audit, Decision D) the three delivery envelopes carry additively. Each local drop
// is tagged with the category it maps to — a shared-contract parse failure (`contract_invalid`) or a
// JUDGMENT_KEYS hit (`judgment_smuggled`) — and the summary keeps ONE { category, count, sample } per
// category, where `sample` is ONE redacted/truncated example reason (never a raw offending body, which
// could carry session/PII fragments — a leak risk). A whole-task failure ({ error }) is NOT a local
// item reject; it rides the existing `failed`/`reason` path, out of this summary's scope.

import { truncate, type LocalReject, type LocalRejectCategory } from "@grocery-agent/contract";

/** One locally-dropped item, tagged with the category its drop maps to. */
export interface LocalDrop {
  category: LocalRejectCategory;
  /** The validator's reason string — the first seen per category becomes the summary's redacted sample. */
  reason: string;
}

/** Max length of a summary `sample` — one short, redacted example, never the raw offending body. */
const SAMPLE_MAX = 200;

/**
 * Aggregate local drops PER CATEGORY into the wire summary: one `{ category, count, sample }` per
 * category that occurred, `sample` = the first reason seen for it (truncated). Returns an empty array
 * for no drops — the caller attaches the field only when non-empty, so a clean run stays additive
 * (omitting `local_rejects` keeps the delivery on `contract_version: "v2"`).
 */
export function summarizeLocalRejects(drops: LocalDrop[]): LocalReject[] {
  const byCategory = new Map<LocalRejectCategory, { count: number; sample: string }>();
  for (const d of drops) {
    const e = byCategory.get(d.category);
    if (e) e.count++;
    else byCategory.set(d.category, { count: 1, sample: truncate(d.reason, SAMPLE_MAX) });
  }
  return [...byCategory.entries()].map(([category, { count, sample }]) => ({ category, count, sample }));
}
