// The D29-final household seam (src/household.ts): roster, attendance resolution with
// its fully-defined fail-opens, the hard-constraint UNION (never attendance-varied),
// the uniform taste blend, and the vibe-contribution rule — unit-tested NOW with
// synthetic multi-profile fixtures, so band 5 changes inputs (the loader), not code
// shape. Band-1 degeneracy: every function fed a singleton array is an identity.

import { describe, it, expect } from "vitest";
import {
  householdRoster,
  resolveAttendance,
  unionHardConstraints,
  blendTasteProfiles,
  vibeParticipates,
} from "../src/household.js";
import { ToolError } from "../src/errors.js";
import type { Env } from "../src/env.js";

describe("householdRoster (the ONE band-5 seam)", () => {
  it("returns the singleton [tenant] in band 1 (the founding member's id equals the tenant id, D10)", async () => {
    expect(await householdRoster({} as Env, "casey")).toEqual(["casey"]);
  });
});

describe("resolveAttendance", () => {
  const ROSTER = ["casey", "caitie", "kid-a"];

  it("no attendance → the whole roster, nothing ignored", () => {
    expect(resolveAttendance(ROSTER, undefined)).toEqual({ effective: ROSTER, ignored: [], notes: [] });
  });

  it("away subtracts; only intersects", () => {
    expect(resolveAttendance(ROSTER, { away: ["kid-a"] }).effective).toEqual(["casey", "caitie"]);
    expect(resolveAttendance(ROSTER, { only: ["casey"] }).effective).toEqual(["casey"]);
  });

  it("exactly one of away/only — both is a structured validation_failed, never a silent pick", () => {
    expect(() => resolveAttendance(ROSTER, { away: ["kid-a"], only: ["casey"] })).toThrowError(ToolError);
    try {
      resolveAttendance(ROSTER, { away: [], only: [] });
    } catch (e) {
      expect((e as ToolError).code).toBe("validation_failed");
    }
  });

  it("unknown handles are DROPPED (never errors) and echoed in ignored", () => {
    const r = resolveAttendance(ROSTER, { away: ["the-kids", "kid-a"] });
    expect(r.effective).toEqual(["casey", "caitie"]);
    expect(r.ignored).toEqual(["the-kids"]);
    expect(r.notes).toEqual([]);
  });

  it("an empty effective set FAILS OPEN to the full roster with a note — never a plan for nobody", () => {
    const away = resolveAttendance(ROSTER, { away: ROSTER });
    expect(away.effective).toEqual(ROSTER);
    expect(away.notes).toHaveLength(1);
    const only = resolveAttendance(ROSTER, { only: ["a-stranger"] });
    expect(only.effective).toEqual(ROSTER);
    expect(only.ignored).toEqual(["a-stranger"]);
    expect(only.notes).toHaveLength(1);
  });

  it("band-1 degeneracy: a singleton roster with any attendance input resolves to the tenant", () => {
    const r = resolveAttendance(["casey"], { away: ["the-kids"] });
    expect(r.effective).toEqual(["casey"]);
    expect(r.ignored).toEqual(["the-kids"]);
  });
});

describe("unionHardConstraints", () => {
  it("a singleton input is the identity (band 1)", () => {
    const rejects = new Set(["beef-ragu"]);
    const u = unionHardConstraints([{ memberId: "casey", rejects, dietaryAvoid: ["cilantro"] }]);
    expect([...u.rejects]).toEqual(["beef-ragu"]);
    expect(u.dietaryAvoid).toEqual(["cilantro"]);
  });

  it("UNIONS across a synthetic multi-profile household — the hard floor is roster-wide", () => {
    const u = unionHardConstraints([
      { memberId: "casey", rejects: new Set(["beef-ragu"]), dietaryAvoid: ["cilantro"] },
      { memberId: "caitie", rejects: new Set(["fish-tacos", "beef-ragu"]), dietaryAvoid: ["shellfish", "cilantro"] },
    ]);
    expect([...u.rejects].sort()).toEqual(["beef-ragu", "fish-tacos"]);
    expect(u.dietaryAvoid).toEqual(["cilantro", "shellfish"]);
  });
});

describe("blendTasteProfiles", () => {
  const A = { memberId: "casey", favoriteVecs: [[1, 0]] };
  const B = { memberId: "caitie", favoriteVecs: [[0, 1]] };

  it("a singleton profile is the identity blend (band 1 — today's ranking byte-for-byte)", () => {
    expect(blendTasteProfiles([A], ["casey"])).toEqual([[1, 0]]);
  });

  it("uniform weights over the effective eating set — a member not eating contributes nothing", () => {
    expect(blendTasteProfiles([A, B], ["casey", "caitie"])).toEqual([[1, 0], [0, 1]]);
    expect(blendTasteProfiles([A, B], ["casey"])).toEqual([[1, 0]]);
  });

  it("an eating set matching no loaded profile fails open to all profiles", () => {
    expect(blendTasteProfiles([A, B], ["a-stranger"])).toEqual([[1, 0], [0, 1]]);
  });
});

describe("vibeParticipates (the contribution rule)", () => {
  const ROSTER = ["casey", "caitie"];

  it("NULL/absent/empty members = everyone = always contributes", () => {
    expect(vibeParticipates(undefined, ["casey"], ROSTER)).toEqual({ participates: true, stale: false });
    expect(vibeParticipates([], ["casey"], ROSTER)).toEqual({ participates: true, stale: false });
  });

  it("an assigned vibe contributes only when its members intersect the effective eating set", () => {
    expect(vibeParticipates(["caitie"], ["casey"], ROSTER)).toEqual({ participates: false, stale: false });
    expect(vibeParticipates(["caitie"], ["casey", "caitie"], ROSTER)).toEqual({ participates: true, stale: false });
  });

  it("all-unresolvable members FAIL OPEN to everyone (stale) — never silently deleted from planning", () => {
    expect(vibeParticipates(["someone-gone"], ["casey"], ROSTER)).toEqual({ participates: true, stale: true });
  });

  it("a partially-resolvable list uses only the recognized handles (tightening stays additive)", () => {
    expect(vibeParticipates(["someone-gone", "caitie"], ["casey"], ROSTER)).toEqual({ participates: false, stale: false });
  });
});
