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
  /** Group invite codes (self-service-signup): `open` is a live redeemable code, `revoked` a
   *  dead one — the app signup spec + the admin Invite-codes roster fixtures. */
  readonly groupCode: { readonly open: string; readonly revoked: string };
  /** Cross-device MCP approval fixtures (webauthn-passkey-auth): the pending `authz:<ref>`
   *  records the /connect screen reads (viewRef) and approves (approveRef), plus the
   *  requesting client name and the verification code shown on both screens. */
  readonly connect: {
    readonly clientName: string;
    readonly code: string;
    readonly viewRef: string;
    readonly approveRef: string;
  };
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
    readonly spend: {
      /** Different-tenant, session-backed pristine oracle used only by Spend browser cases. */
      readonly fixtureTenant: string;
      readonly budget: number;
      readonly awaiting: number;
      readonly totals: Readonly<Record<"4w" | "8w" | "12w", number>>;
      readonly events: Readonly<Record<"4w" | "8w" | "12w", number>>;
      readonly topDriver: { readonly key: string; readonly name: string; readonly amount: number };
    };
    readonly waste: {
      /** Different-tenant, session-backed pristine oracle used by the real Waste case. */
      readonly fixtureTenant: string;
      readonly amounts: Readonly<Record<"4w" | "8w" | "12w", number>>;
      readonly events: Readonly<Record<"4w" | "8w" | "12w", number>>;
      readonly rates: Readonly<Record<"4w" | "8w" | "12w", number>>;
      readonly topItem: { readonly key: string; readonly name: string; readonly amount: number };
      readonly leftover: { readonly key: string; readonly name: string };
      readonly insight8w: string;
    };
    /** The seeded meal-vibe palette (profile-planning-and-vibes-ui): six vibes across
     *  breakfast/lunch/dinner, one pinned + one unpinned per group. */
    readonly vibes: Readonly<
      Record<
        "eggs" | "toast" | "bowl" | "wrap" | "sauce" | "stir",
        { readonly id: string; readonly meal: "breakfast" | "lunch" | "dinner"; readonly vibe: string; readonly pinned: boolean }
      >
    >;
    /** The pending reconciliation backlog rendered inline (profile-planning-and-vibes-ui):
     *  add_vibe group-footer cards, an adjust_cadence + prune_vibe row-attached pair (their
     *  `target` is the seeded vibe phrase; `vibeId` the id the confirm apply keys on), and a
     *  merge_recipes pair that never surfaces on the member vibes tab. */
    readonly proposals: {
      readonly addA: { readonly id: string; readonly vibe: string; readonly meal: "breakfast" | "lunch" | "dinner" };
      readonly addB: { readonly id: string; readonly vibe: string; readonly meal: "breakfast" | "lunch" | "dinner" };
      readonly adjust: { readonly id: string; readonly target: string; readonly vibeId: string; readonly cadence_days: number };
      readonly prune: { readonly id: string; readonly target: string; readonly vibeId: string };
      readonly merge: {
        readonly id: string;
        readonly target: string;
        readonly titles: readonly [string, string];
        readonly rationale: string;
      };
    };
    readonly note: { readonly body: string; readonly tag: string };
    readonly tasteLead: string;
    /** Brand-tier fixtures (brand-tier model): the Preferred-brands card's seeded
     *  ladder (singleton tiers, the migrated-production shape) and don't-care family. */
    readonly brands: {
      readonly ladder: { readonly term: string; readonly tiers: readonly (readonly string[])[] };
      readonly dontCare: { readonly term: string };
    };
    readonly storeAdapters: {
      readonly kroger: {
        readonly locationId: string;
        readonly name: string;
        readonly address: string;
        readonly zip: string;
      };
      readonly search: readonly {
        readonly location_id: string;
        readonly name: string;
        readonly address: string;
        readonly zip: string;
      }[];
      readonly offline: readonly {
        readonly slug: string;
        readonly name: string;
        readonly label: string;
        readonly address: string;
      }[];
    };
    /** Unified cookbook browse fixtures (cookbook-unified-browse): `noTime` has NO
     *  time_total (an active time cap must exclude it), and `italian` is what
     *  `cuisine=italian` narrows the corpus to. */
    readonly cookbook: {
      readonly noTime: string;
      readonly italian: readonly string[];
    };
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
    /** Meal-plan page fixtures (meal-plan-page): the unscheduled non-dinner row, the
     *  beyond-horizon scheduled row, the from_vibe row (recipe + its unresolved vibe id),
     *  and the project fixtures — the seeded project row's recipe plus the project-eligible
     *  recipe the Projects picker offers (with its expected course-derived kind label). */
    readonly plan: {
      readonly unscheduled: string;
      readonly later: string;
      readonly fromVibe: { readonly recipe: string; readonly vibeId: string };
      readonly project: {
        readonly seeded: string;
        readonly pick: { readonly slug: string; readonly title: string; readonly kind: string };
      };
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
        readonly pantryHit: string;
        readonly saleHit: { readonly sku: string; readonly price: { readonly regular: number; readonly promo: number } };
        /** Curated `display_name` per concrete family node (reify-ingredient-display-names) —
         *  distinct from the raw canonical id, keyed by id. */
        readonly displayNames: Readonly<Record<string, string>>;
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
