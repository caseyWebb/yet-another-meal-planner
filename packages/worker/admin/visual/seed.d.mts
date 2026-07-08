// Types for the seed literals (seed.mjs) the page objects import — the one source of truth
// shared between the SQL/KV seed and the assertions, so a fixture rename cannot drift from the
// spec that asserts on it. Keep in lockstep with seed.mjs by hand (literals only, no logic).

export interface SeedLiterals {
  /** Allowlisted members: one connected (OAuth grant + activity + domain rows), one pending. */
  readonly members: { readonly active: string; readonly pending: string };
  /** The invite code mapped to the active member — the app suite's seeded login credential. */
  readonly invite: string;
  /** A second invite code mapped to the PENDING member — the app suite's different-tenant
   *  login spec (member-app-offline D9). */
  readonly inviteAlt: string;
  /** The indexed recipe the Data list / Insights boards / cooking log rows reference. */
  readonly recipe: { readonly slug: string; readonly title: string; readonly source: string };
  /** The discovery-log fixture rows (a retryable error + a gated skip + an import). */
  readonly discovery: {
    readonly errId: string;
    readonly errTitle: string;
    readonly rejId: string;
    readonly rejTitle: string;
    readonly importedId: string;
    readonly importedTitle: string;
  };
  /** Normalization fixtures: a decision row (Override button), a queued term, an alias row,
   *  and a canonical self-entry (variant === id — the Aliases chip, never a listed row). */
  readonly normalize: {
    readonly decisionTerm: string;
    readonly queueTerm: string;
    readonly aliasVariant: string;
    readonly canonicalId: string;
    readonly selfEntryVariant: string;
  };
  /** Audit-surface fixtures: a kept edge decision, a dropped-then-restored edge decision
   *  (restorations log + "revisited" pointer), and a merge-rejection pair. */
  readonly audit: {
    readonly keptEdge: { readonly from: string; readonly to: string };
    readonly droppedEdge: { readonly from: string; readonly to: string };
    readonly rejection: { readonly a: string; readonly b: string };
  };
  /** Ingest-key fixtures (satellite-pull-channel): one operator-global key + one tenant-bound key. */
  readonly ingestKeys: {
    readonly global: { readonly id: string; readonly label: string; readonly prefix: string };
    readonly bound: { readonly id: string; readonly label: string; readonly prefix: string; readonly tenant: string };
  };
  /** Source-audit fixtures (satellite-source-audit): the operator-global key's three recipe sources
   *  — one clean, one degrading (quarantine-recommended), one quarantined. */
  readonly satellites: {
    readonly clean: { readonly source: string };
    readonly degrading: { readonly source: string; readonly localCount: number };
    readonly quarantined: { readonly source: string };
  };
  /** Member-app fixtures (member-app-core): grocery rows, the empty palette's pending
   *  proposal backlog, the community note, and the profile literals the app suite asserts on. */
  readonly app: {
    readonly grocery: {
      readonly active: readonly string[];
      readonly household: string;
      readonly inCart: string;
    };
    readonly proposals: {
      readonly addA: { readonly id: string; readonly vibe: string };
      readonly addB: { readonly id: string; readonly vibe: string };
      readonly prune: { readonly id: string; readonly target: string };
      readonly merge: {
        readonly id: string;
        readonly target: string;
        readonly titles: readonly [string, string];
        readonly rationale: string;
      };
    };
    readonly note: { readonly body: string; readonly tag: string };
    readonly tasteLead: string;
    /** Propose-flow fixtures (member-app-propose D12): the self-provisioned palette's
     *  vibe ids (their derived vectors are pre-seeded), the cache-warmed freeform
     *  phrase, and the corpus rows the specs assert on. */
    readonly propose: {
      readonly vibes: {
        readonly seafood: { readonly id: string; readonly vibe: string };
        readonly comfort: { readonly id: string; readonly vibe: string };
      };
      readonly freeform: string;
      readonly soup: { readonly slug: string; readonly title: string };
      readonly side: { readonly slug: string; readonly title: string };
      readonly extraRecipes: readonly string[];
    };
    /** Derived to-buy fixtures (member-app-grocery D9): the planned recipe with a seeded
     *  `ingredients_full`, a derived-only line, the both-origin merge row, the covered
     *  pantry item, and the underived recipe the specs plan. */
    readonly toBuy: {
      readonly planned: string;
      readonly virtual: string;
      readonly both: string;
      readonly covered: string;
      readonly underived: string;
    };
    /** Differentiator fixtures (member-app-differentiators D11): the picked-for-you
     *  expectation, the pre-resolved Kroger locationId the aisle specs PATCH into
     *  preferences, the aisle-tagged sku_cache rows, and the sibling edge family. */
    readonly differentiators: {
      readonly topPick: string;
      readonly location: string;
      readonly aisles: {
        readonly meat: { readonly ingredient: string; readonly number: string; readonly description: string };
        readonly produce: { readonly ingredient: string; readonly number: string; readonly description: string };
      };
      readonly siblings: {
        readonly line: string;
        readonly family: readonly string[];
        readonly parent: string;
      };
    };
  };
  /** The registered background jobs seeded into job_health/job_runs (mirrors HEALTH_JOBS). */
  readonly jobs: readonly string[];
}

export declare const SEED: SeedLiterals;
/** The D1 seed statements (deterministic ids, now-relative timestamps). */
export declare function d1Statements(now: number): string[];
/** KV seeds: [binding, key, value] triples for `wrangler kv key put --local`. */
export declare function kvEntries(): Array<[binding: string, key: string, value: string]>;
