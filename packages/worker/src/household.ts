// The D29-final household seam: roster, attendance resolution, the taste blend, and
// the hard-constraint union. The propose contract is written household-blend-first
// with today's single-profile tenant as the DEGENERATE case, so band 1 ships pure
// functions fed a singleton array — an identity blend producing today's ranking
// byte-for-byte — and band 5 changes ONE function body (`householdRoster`) plus the
// profile loader, zero contract sentences. Everything here except `householdRoster`
// is pure (unit-testable with synthetic multi-profile fixtures off `workerd`).

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";

/** The propose attendance input: exactly one of `away`/`only` (both is rejected). */
export interface AttendanceInput {
  away?: string[];
  only?: string[];
}

/** What attendance resolved to. `notes` records every fail-open taken. */
export interface ResolvedAttendance {
  /** The EFFECTIVE EATING SET: `only ∩ roster` or `roster − away`; an empty result
   *  fails open to the full roster (an attendance mistake never plans for nobody). */
  effective: string[];
  /** Unknown handles, dropped (never errors) and echoed for diagnostics. */
  ignored: string[];
  notes: string[];
}

/**
 * The ONE roster seam. Band 1: the founding member's id EQUALS the tenant id (D10),
 * so the household roster is the singleton `[tenant]`. Band 5 grows this one body
 * into a members-table query; every caller and contract sentence stays put.
 */
export function householdRoster(_env: Env, tenant: string): Promise<string[]> {
  return Promise.resolve([tenant]);
}

/**
 * Resolve an attendance input against the roster — fully defined fail-open semantics:
 * unknown handles are dropped and echoed in `ignored`; an empty effective set fails
 * open to the full roster with a note. Supplying BOTH `away` and `only` is a
 * structured `validation_failed`, never a silent pick between them.
 */
export function resolveAttendance(roster: string[], attendance?: AttendanceInput): ResolvedAttendance {
  const rosterSet = new Set(roster);
  if (attendance && attendance.away !== undefined && attendance.only !== undefined) {
    throw new ToolError("validation_failed", "attendance takes exactly one of away or only, not both");
  }
  const notes: string[] = [];
  const ignored: string[] = [];
  let effective = [...roster];
  if (attendance?.only !== undefined) {
    const recognized = attendance.only.filter((h) => {
      if (rosterSet.has(h)) return true;
      ignored.push(h);
      return false;
    });
    effective = roster.filter((m) => recognized.includes(m));
  } else if (attendance?.away !== undefined) {
    const away = new Set(
      attendance.away.filter((h) => {
        if (rosterSet.has(h)) return true;
        ignored.push(h);
        return false;
      }),
    );
    effective = roster.filter((m) => !away.has(m));
  }
  if (effective.length === 0) {
    effective = [...roster];
    notes.push("attendance resolved to nobody — planning for the whole household instead");
  }
  return { effective, ignored, notes };
}

/** One member's soft-ranking taste profile (band 1 loads exactly one — the tenant's). */
export interface MemberTasteProfile {
  memberId: string;
  /** The member's favorited-recipe embeddings — the nearest-liked re-rank anchors. */
  favoriteVecs: number[][];
}

/** One member's hard-constraint set (band 1 loads exactly one — the tenant's). */
export interface MemberHardConstraints {
  memberId: string;
  /** Recipe slugs this member rejected (hidden — a hard gate). */
  rejects: Set<string>;
  /** Dietary avoid terms (a hard gate). */
  dietaryAvoid: string[];
}

/**
 * The household HARD FLOOR: the UNION of every roster member's hard constraints.
 * Deliberately roster-wide, NEVER attendance-filtered — an absent member's hard
 * constraints still apply; only soft weighting moves with attendance. A singleton
 * input returns that member's constraints unchanged (band-1 identity).
 */
export function unionHardConstraints(profiles: MemberHardConstraints[]): {
  rejects: Set<string>;
  dietaryAvoid: string[];
} {
  const rejects = new Set<string>();
  const dietaryAvoid: string[] = [];
  for (const p of profiles) {
    for (const slug of p.rejects) rejects.add(slug);
    for (const term of p.dietaryAvoid) if (!dietaryAvoid.includes(term)) dietaryAvoid.push(term);
  }
  return { rejects, dietaryAvoid };
}

/**
 * The household SOFT BLEND: member taste profiles blended with UNIFORM weights over
 * the effective eating set — a member not eating contributes nothing to soft ranking.
 * Absent any attendance narrowing the blend covers all members equally. Band-1
 * degeneracy: a singleton profile array returns that member's anchors unchanged
 * (identity blend — today's ranking byte-for-byte). An eating set matching no loaded
 * profile fails open to all profiles (soft ranking never goes dark by mistake).
 */
export function blendTasteProfiles(profiles: MemberTasteProfile[], eating: string[]): number[][] {
  const eat = new Set(eating);
  const contributing = profiles.filter((p) => eat.has(p.memberId));
  const effective = contributing.length > 0 ? contributing : profiles;
  const out: number[][] = [];
  for (const p of effective) out.push(...p.favoriteVecs);
  return out;
}

/**
 * The vibe-contribution rule (D29-final): a member-assigned vibe contributes slots
 * and cadence-debt only when its `members` intersect the effective eating set;
 * NULL/absent/empty = "everyone" = always. STALE-MEMBERS FAIL-OPEN: a vibe whose
 * members are all unresolvable against the roster contributes as everyone (`stale:
 * true`, surfaced as a diagnostics note) — a stale reference never silently deletes
 * a vibe from planning.
 */
export function vibeParticipates(
  members: string[] | undefined,
  effective: string[],
  roster: string[],
): { participates: boolean; stale: boolean } {
  if (!members || members.length === 0) return { participates: true, stale: false };
  const rosterSet = new Set(roster);
  const recognized = members.filter((m) => rosterSet.has(m));
  if (recognized.length === 0) return { participates: true, stale: true };
  const eat = new Set(effective);
  return { participates: recognized.some((m) => eat.has(m)), stale: false };
}
