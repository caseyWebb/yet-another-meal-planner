// Types for the seed literals (seed.mjs) the page objects import — the one source of truth
// shared between the SQL/KV seed and the assertions, so a fixture rename cannot drift from the
// spec that asserts on it. Keep in lockstep with seed.mjs by hand (literals only, no logic).

export interface SeedLiterals {
  /** Allowlisted members: one connected (OAuth grant + activity + domain rows), one pending. */
  readonly members: { readonly active: string; readonly pending: string };
  /** The invite code mapped to the active member — the app suite's seeded login credential. */
  readonly invite: string;
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
  /** The registered background jobs seeded into job_health/job_runs (mirrors HEALTH_JOBS). */
  readonly jobs: readonly string[];
}

export declare const SEED: SeedLiterals;
/** The D1 seed statements (deterministic ids, now-relative timestamps). */
export declare function d1Statements(now: number): string[];
/** KV seeds: [binding, key, value] triples for `wrangler kv key put --local`. */
export declare function kvEntries(): Array<[binding: string, key: string, value: string]>;
