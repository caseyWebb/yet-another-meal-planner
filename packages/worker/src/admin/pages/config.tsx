// The Config area (operator-admin), server-rendered. A pill sub-nav over FOUR consolidated
// groups — Discovery (default, bare /admin/config), Kroger Flyer, Ranking, Aliases — each
// rendering its knob console(s) and any corpus editor(s) together on one screen (mirrors the
// redesign mock's ConfigScreen.jsx `GroupDiscovery`/`GroupFlyer`/`GroupRanking`/
// `GroupAliases` composition). Each group page composes the SSR reads it needs into one
// props payload seeding one island (admin-ui-redesign-config).

import type { Child } from "hono/jsx";
import { Hono } from "hono";
import { Layout } from "../ui/layout.js";
import type { Env } from "../../env.js";
import type { KnobSpec } from "../ui/kit.js";
import { getDiscoveryConfig, getOperatorConfig, listCorpus } from "../config-api.js";
import { readScraperLiveness, type ScraperLiveness } from "../../ingest-db.js";

/** The Config groups (slug "" = the bare /admin/config Discovery default). */
const GROUPS: { slug: string; label: string }[] = [
  { slug: "", label: "Discovery" },
  { slug: "ingest-keys", label: "Ingest Keys" },
  { slug: "flyer", label: "Kroger Flyer" },
  { slug: "ranking", label: "Ranking" },
  { slug: "aliases", label: "Aliases" },
];

type AddKind = "text" | "number" | "tags";
interface AddField {
  key: string;
  label: string;
  kind: AddKind;
  required: boolean;
}
interface CorpusEditorConfig {
  slug: string;
  pkColumn: string;
  addFields: AddField[];
  testUrlColumn?: string;
}
interface CorpusPageData {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

const FEEDS_EDITOR: { title: string; config: CorpusEditorConfig } = {
  title: "Discovery feeds",
  config: {
    slug: "feeds",
    pkColumn: "url",
    testUrlColumn: "url",
    addFields: [
      { key: "url", label: "feed url", kind: "text", required: true },
      { key: "name", label: "name", kind: "text", required: false },
      { key: "weight", label: "weight", kind: "number", required: false },
      { key: "tags", label: "tags (comma-separated)", kind: "tags", required: false },
    ],
  },
};

const FLYER_TERMS_EDITOR: { title: string; config: CorpusEditorConfig } = {
  title: "Flyer terms",
  config: { slug: "flyer-terms", pkColumn: "term", addFields: [{ key: "term", label: "term", kind: "text", required: true }] },
};

const ALIASES_EDITOR: { title: string; config: CorpusEditorConfig } = {
  title: "Ingredient aliases",
  config: {
    slug: "aliases",
    pkColumn: "variant",
    addFields: [
      { key: "variant", label: "variant", kind: "text", required: true },
      { key: "canonical", label: "canonical", kind: "text", required: true },
    ],
  },
};

// The Ranking/Flyer knob specs — floor annotations mirror operator-config.ts's
// FLOOR_FLYER_REFRESH_HOURS/FLOOR_FLYER_BATCH_UNITS exactly; the five ranking weights carry
// no `floor` (no safe-floor concept — see operator-config.ts's Decision 2 rationale), so
// their KnobRow never renders the below-floor warning and can never enter NeedsConfirm.
const RANKING_KNOBS: KnobSpec[] = [
  { key: "favoriteWeight", label: "favorite weight", step: 0.05, min: 0, max: 2, help: "How strongly a recipe's similarity to a member's favorites lifts its rank." },
  { key: "noveltyBoost", label: "novelty boost", step: 0.05, min: 0, max: 2, help: "Lift for dishes unlike what's been suggested recently — keeps the plan fresh." },
  { key: "pantryWeight", label: "pantry weight", step: 0.05, min: 0, max: 2, help: "Reward for recipes that use what's already in the member's pantry." },
  { key: "perishWeight", label: "perishable weight", step: 0.5, min: 0, max: 10, help: "Urgency multiplier for using soon-to-expire perishables first." },
  { key: "keyWeight", label: "key-ingredient weight", step: 0.5, min: 0, max: 10, help: "Reward for hitting a recipe's defining ingredient when it's on sale / in pantry." },
  { key: "overlapCap", label: "overlap cap", step: 1, min: 1, max: 20, help: "Max recipes in a plan that may share a key ingredient — caps repetition." },
];

const FLYER_KNOBS: KnobSpec[] = [
  { key: "minFlyerDiscount", label: "min flyer discount", step: 0.01, min: 0, max: 1, pct: true, help: "Ignore flyer items discounted less than this — filters noise from token markdowns." },
  { key: "flyerRefreshHours", label: "flyer refresh (hours)", step: 1, min: 1, max: 720, floor: 6, help: "How often the warm re-pulls the weekly flyer per store." },
  { key: "flyerBatchUnits", label: "flyer batch units", step: 1, min: 1, max: 200, floor: 4, help: "Items embedded per warm batch — bounds the per-tick embedding cost." },
];

function href(slug: string): string {
  return slug ? `/admin/config/${slug}` : "/admin/config";
}

const ConfigShell = ({ active, children }: { active: string; children?: Child }) => (
  <Layout title="Config · grocery-agent admin" active="/admin/config" wide>
    <div class="data-nav">
      {GROUPS.map((g) => (
        <a href={href(g.slug)} class={g.slug === active ? "pill active" : "pill"}>
          {g.label}
        </a>
      ))}
    </div>
    {children}
  </Layout>
);

const Section = ({ title, blurb, children }: { title: string; blurb?: string; children?: Child }) => (
  <section class="cfg-section">
    <h3 class="cfg-section-title">{title}</h3>
    {blurb ? <p class="cfg-section-blurb muted">{blurb}</p> : null}
    {children}
  </section>
);

function serialize(props: unknown): string {
  return JSON.stringify(props).replace(/</g, "\\u003c");
}

function html(node: { toString(): string }): string {
  return "<!doctype html>" + node.toString();
}

/** One corpus-editor mount point: a `[data-corpus-host]` div paired with its own
 *  `corpus-props-<id>` props script, so a group page can host more than one corpus editor
 *  (e.g. Discovery's Feeds editor beside its calibration console) — see client/corpus.tsx's
 *  bootstrap, which mounts every `[data-corpus-host]` it finds. The `corpus.js` island
 *  module itself is loaded once per page by the caller. */
const CorpusIslandHost = ({ id, config, page }: { id: string; config: CorpusEditorConfig; page: CorpusPageData }) => (
  <div>
    <div data-corpus-host data-id={id}>
      <p class="muted">Loading…</p>
    </div>
    <script type="application/json" id={`corpus-props-${id}`} dangerouslySetInnerHTML={{ __html: serialize({ config, page }) }} />
  </div>
);

// ── Discovery group: calibration console + Feeds editor + Email Sources editor ────────────
const DiscoveryGroupPage = ({
  calibrationConfig,
  feeds,
  members,
  senders,
}: {
  calibrationConfig: import("../../discovery-sweep.js").DiscoveryConfig;
  feeds: CorpusPageData;
  members: CorpusPageData;
  senders: CorpusPageData;
}) => (
  <ConfigShell active="">
    <Section
      title="Calibration"
      blurb="Tune the sweep's knobs, preview with Analyze / Dry-run, then Save (a below-floor value asks to confirm)."
    >
      <div id="config-island">
        <p class="muted">Loading the calibration console…</p>
      </div>
      <script type="application/json" id="config-props" dangerouslySetInnerHTML={{ __html: serialize({ config: calibrationConfig }) }} />
      <script type="module" src="/admin/islands/calibration.js" />
    </Section>
    <Section
      title={FEEDS_EDITOR.title}
      blurb="RSS sources the sweep polls for new candidates. Weight scales a feed's taste contribution; test a URL before adding."
    >
      <CorpusIslandHost id="feeds" config={FEEDS_EDITOR.config} page={feeds} />
      <script type="module" src="/admin/islands/corpus.js" />
    </Section>
    <Section title="Email Sources">
      <div id="email-sources-island">
        <p class="muted">Loading…</p>
      </div>
      <script
        type="application/json"
        id="email-sources-props"
        dangerouslySetInnerHTML={{ __html: serialize({ members, senders }) }}
      />
      <script type="module" src="/admin/islands/email-sources.js" />
    </Section>
  </ConfigShell>
);

// ── Kroger Flyer group: flyer knob console + flyer-terms editor ───────────────────────────
const FlyerGroupPage = ({
  config,
  flyerTerms,
}: {
  config: import("../../operator-config.js").OperatorConfig;
  flyerTerms: CorpusPageData;
}) => (
  <ConfigShell active="flyer">
    <Section title="Flyer behaviour" blurb="How the Kroger flyer warm selects and batches deals.">
      <div id="config-island">
        <p class="muted">Loading…</p>
      </div>
      <script type="application/json" id="config-props" dangerouslySetInnerHTML={{ __html: serialize({ config, knobs: FLYER_KNOBS }) }} />
      <script type="module" src="/admin/islands/opconfig.js" />
    </Section>
    <Section
      title={FLYER_TERMS_EDITOR.title}
      blurb="Search terms the flyer warm tracks for deals. The agent adds via its tools; prune noise here."
    >
      <CorpusIslandHost id="flyer-terms" config={FLYER_TERMS_EDITOR.config} page={flyerTerms} />
      <script type="module" src="/admin/islands/corpus.js" />
    </Section>
  </ConfigShell>
);

// ── Ranking group: ranking knob console only ───────────────────────────────────────────────
const RankingGroupPage = ({ config }: { config: import("../../operator-config.js").OperatorConfig }) => (
  <ConfigShell active="ranking">
    <Section
      title="Ranking weights"
      blurb="Group-default weights for the recipe ranker. Per-member profile rotation overrides layer on top of these."
    >
      <div id="config-island">
        <p class="muted">Loading…</p>
      </div>
      <script type="application/json" id="config-props" dangerouslySetInnerHTML={{ __html: serialize({ config, knobs: RANKING_KNOBS }) }} />
      <script type="module" src="/admin/islands/opconfig.js" />
    </Section>
  </ConfigShell>
);

// ── Aliases group: alias table only (unchanged from today, restyled) ──────────────────────
const AliasesGroupPage = ({ page }: { page: CorpusPageData }) => (
  <ConfigShell active="aliases">
    <Section
      title={ALIASES_EDITOR.title}
      blurb="Group-wide alias map — a variant name resolves to its canonical ingredient for pantry + flyer matching."
    >
      <CorpusIslandHost id="aliases" config={ALIASES_EDITOR.config} page={page} />
      <script type="module" src="/admin/islands/corpus.js" />
    </Section>
  </ConfigShell>
);

// ── Ingest Keys group: the walled-source scraper key roster (island) ──────────────────────
const IngestKeysGroupPage = ({ scrapers }: { scrapers: ScraperLiveness[] }) => (
  <ConfigShell active="ingest-keys">
    <Section
      title="Ingest keys"
      blurb="One key per home-network scraper — a machine that logs in to paid recipe sites, extracts recipes, and POSTs them to the Worker, feeding the discovery sweep. Mint a key per scraper; the secret is shown once."
    >
      <div id="ingest-keys-island">
        <p class="muted">Loading…</p>
      </div>
      <script type="application/json" id="ingest-keys-props" dangerouslySetInnerHTML={{ __html: serialize({ scrapers }) }} />
      <script type="module" src="/admin/islands/ingest-keys.js" />
    </Section>
  </ConfigShell>
);

export function registerConfigRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/config/ingest-keys", async (c) => {
    const { scrapers } = await readScraperLiveness(c.env);
    return c.html(html(<IngestKeysGroupPage scrapers={scrapers} />));
  });

  app.get("/config", async (c) => {
    const [{ config }, feeds, members, senders] = await Promise.all([
      getDiscoveryConfig(c.env),
      listCorpus(c.env, "feeds"),
      listCorpus(c.env, "members"),
      listCorpus(c.env, "senders"),
    ]);
    return c.html(html(<DiscoveryGroupPage calibrationConfig={config} feeds={feeds} members={members} senders={senders} />));
  });

  app.get("/config/flyer", async (c) => {
    const [{ config }, flyerTerms] = await Promise.all([getOperatorConfig(c.env), listCorpus(c.env, "flyer-terms")]);
    return c.html(html(<FlyerGroupPage config={config} flyerTerms={flyerTerms} />));
  });

  app.get("/config/ranking", async (c) => {
    const { config } = await getOperatorConfig(c.env);
    return c.html(html(<RankingGroupPage config={config} />));
  });

  app.get("/config/aliases", async (c) => {
    const page = await listCorpus(c.env, "aliases");
    return c.html(html(<AliasesGroupPage page={page} />));
  });
}
