// The night-vibe palette folded into `read_user_profile` (data-read-tools D5): the profile
// read now carries the palette with each vibe's derived cadence status, and an empty palette
// is an onboarding gap in `missing[]`. The cadence status mirrors the member app's `statusOf`.

import { describe, expect, it } from "vitest";
import { assembleUserProfile } from "../src/tools.js";
import { fakeD1 } from "./fake-d1.js";

/** An ISO day (YYYY-MM-DD) `n` whole days before now — the anchor the status math floors over. */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** One `night_vibes` row (all columns the palette SELECT reads). */
function vibeRow(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant: "casey",
    id,
    vibe: id.replace(/-/g, " "),
    facets: null,
    cadence_days: null,
    pinned: 0,
    base_weight: null,
    weather_affinity: null,
    weather_antipathy: null,
    season: null,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

describe("assembleUserProfile — night-vibe palette (data-read-tools D5)", () => {
  it("includes the palette with each vibe's derived last_satisfied + cadence status", async () => {
    const { env } = fakeD1({
      tables: {
        night_vibes: [
          // Last satisfied 100 days ago, weekly cadence → debt ~14 → overdue.
          vibeRow("weeknight-pasta", { cadence_days: 7 }),
          // Never satisfied, created 2 days ago, monthly cadence → debt ~0.07 → ok.
          vibeRow("project-cook", { cadence_days: 30, created_at: `${daysAgoIso(2)}T00:00:00Z` }),
        ],
        cooking_log: [
          { tenant: "casey", id: 1, type: "recipe", recipe: "penne", date: daysAgoIso(100), satisfied_vibe: "weeknight-pasta" },
        ],
        // last_satisfied derives over vibe_satisfaction (migration 0047 backfilled this from the
        // provenance-stamped cook above): cosine-match record for the aimed vibe, 100 days ago.
        vibe_satisfaction: [
          { tenant: "casey", cooking_log_id: 1, vibe_id: "weeknight-pasta", date: daysAgoIso(100), score: null },
        ],
      },
    });

    const profile = await assembleUserProfile(env, "casey");

    expect(profile.night_vibes).toHaveLength(2);
    const pasta = profile.night_vibes.find((v) => v.id === "weeknight-pasta")!;
    expect(pasta.last_satisfied).toBe(daysAgoIso(100));
    expect(pasta.status).toBe("overdue");

    const project = profile.night_vibes.find((v) => v.id === "project-cook")!;
    expect(project.last_satisfied).toBeNull();
    expect(project.status).toBe("ok");

    // A non-empty palette is not an onboarding gap.
    expect(profile.missing).not.toContain("vibes");
  });

  it("lists 'vibes' in missing[] for an empty palette and omits it for a non-empty one", async () => {
    const empty = await assembleUserProfile(fakeD1({}).env, "ghost");
    expect(empty.night_vibes).toEqual([]);
    expect(empty.missing).toContain("vibes");

    const seeded = await assembleUserProfile(
      fakeD1({ tables: { night_vibes: [vibeRow("taco-tuesday", { cadence_days: 7 })] } }).env,
      "casey",
    );
    expect(seeded.night_vibes).toHaveLength(1);
    expect(seeded.missing).not.toContain("vibes");
  });
});
