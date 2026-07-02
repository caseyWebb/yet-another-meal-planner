// Types for the seed literals (seed.mjs) the page objects import — the one source of truth
// shared between the SQL/KV seed and the assertions, so a fixture rename cannot drift from the
// spec that asserts on it. Keep in lockstep with seed.mjs by hand (literals only, no logic).

export interface SeedLiterals {
  /** Allowlisted members: one connected (OAuth grant + activity + domain rows), one pending. */
  readonly members: { readonly active: string; readonly pending: string };
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
  /** Normalization fixtures: a decision row (Override button), a queued term, an alias row. */
  readonly normalize: {
    readonly decisionTerm: string;
    readonly queueTerm: string;
    readonly aliasVariant: string;
    readonly canonicalId: string;
  };
  /** The registered background jobs seeded into job_health/job_runs (mirrors HEALTH_JOBS). */
  readonly jobs: readonly string[];
}

export declare const SEED: SeedLiterals;
/** The D1 seed statements (deterministic ids, now-relative timestamps). */
export declare function d1Statements(now: number): string[];
/** KV seeds: [binding, key, value] triples for `wrangler kv key put --local`. */
export declare function kvEntries(): Array<[binding: string, key: string, value: string]>;
