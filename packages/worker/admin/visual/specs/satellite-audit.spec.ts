// Discovery › Satellites source-audit interactions (satellite-source-audit): the per-source quality
// dimension (accept/fail bar + the quarantine recommendation), the rejection-ledger drill-down
// (origin badges + clickable provenance + aggregated counts), and the reversible quarantine toggle.
// Fixtures (seed.mjs): the operator-global key's three recipe sources — a CLEAN source, a DEGRADING
// source (quarantine-recommended), and a QUARANTINED source. The mutating tests are self-restoring
// (they toggle the flag back) so the suite stays order-independent and idempotent across re-runs.
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

test("a degrading source shows the fail bar and the quarantine recommendation", async ({ discoveryPage }) => {
  const sats = discoveryPage.satellites();
  await sats.goto();
  const src = SEED.satellites.degrading.source;
  // The quality cell shows accept/fail only (recency stays the dot + meta).
  await expect(sats.qualityLabel(src)).toContainText("failing");
  const chip = sats.recommendationChip(src);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("failed validation");
  await sats.captureForReview("discovery-satellites-audit");
});

test("the rejection drill-down shows worker/local badges, clickable provenance, and aggregated counts", async ({ discoveryPage }) => {
  const sats = discoveryPage.satellites();
  await sats.goto();
  const drill = await sats.openDrilldown(SEED.satellites.degrading.source);
  // Both origins are present — worker (rejected on arrival) and local (dropped before the wire).
  await expect(drill.locator(".ig-o-worker").first()).toBeVisible();
  await expect(drill.locator(".ig-o-local").first()).toBeVisible();
  // The worker rejects carry a URL provenance → an actionable, new-tab link.
  await expect(drill.locator("a.ig-prov-url").first()).toHaveAttribute("target", "_blank");
  // The pre-aggregated local flood renders its summed count (ruling #3).
  await expect(drill).toContainText(`${SEED.satellites.degrading.localCount}×`);
  await sats.captureForReview("discovery-satellites-drilldown");
});

test("a clean source drills down to the empty state", async ({ discoveryPage }) => {
  const sats = discoveryPage.satellites();
  await sats.goto();
  const drill = await sats.openDrilldown(SEED.satellites.clean.source);
  await expect(drill).toContainText("this source is clean");
});

test("quarantine confirm holds a source, then un-quarantine releases it", async ({ discoveryPage }) => {
  const sats = discoveryPage.satellites();
  await sats.goto();
  const src = SEED.satellites.degrading.source;
  // Recommendation chip → confirm dialog → confirm holds the source (optimistic).
  const dialog = await sats.openQuarantineConfirm(src);
  await expect(dialog.title("Quarantine")).toBeVisible();
  await sats.confirmQuarantine();
  await expect(sats.quarantinedBlock(src)).toBeVisible();
  await sats.captureForReview("discovery-satellites-quarantined");
  // Restore: release it back to the seeded (degrading) state.
  await sats.unquarantine(src);
  await expect(sats.recommendationChip(src)).toBeVisible();
});

test("the seeded quarantined source shows the held block and toggles", async ({ discoveryPage }) => {
  const sats = discoveryPage.satellites();
  await sats.goto();
  const src = SEED.satellites.quarantined.source;
  // Held state is SSR-derived (quarantine flag) — the block + the "rejecting" quality label.
  await expect(sats.quarantinedBlock(src)).toBeVisible();
  await expect(sats.qualityLabel(src)).toContainText("rejecting");
  // Un-quarantine → it returns to the recommended (degrading) state.
  await sats.unquarantine(src);
  await expect(sats.recommendationChip(src)).toBeVisible();
  // Restore the seeded held state via the recommendation chip's confirm dialog.
  await sats.openQuarantineConfirm(src);
  await sats.confirmQuarantine();
  await expect(sats.quarantinedBlock(src)).toBeVisible();
});
