// The Config area (operator-admin), server-rendered. A pill sub-nav over the config sub-views,
// each its own route; the default (bare /admin/config) is the discovery calibration console. The
// sub-nav grows as sub-views land (Calibration first; ranking/flyer + the corpus editors follow).
// Each sub-view seeds its island from SSR-loaded config (no client fetch for first data).

import type { Child } from "hono/jsx";
import { Hono } from "hono";
import { Layout } from "../ui/layout.js";
import type { Env } from "../../env.js";
import type { DiscoveryConfig } from "../../discovery-sweep.js";
import type { OperatorConfig } from "../../operator-config.js";
import { getDiscoveryConfig, getOperatorConfig } from "../config-api.js";

/** The built Config sub-views (slug "" = the bare /admin/config calibration default). */
const VIEWS: { slug: string; label: string }[] = [
  { slug: "", label: "Calibration" },
  { slug: "ranking", label: "Ranking" },
  { slug: "flyer", label: "Flyer" },
];

interface FieldDesc {
  key: string;
  label: string;
  step: string;
  pct?: boolean;
}

const RANKING_FIELDS: FieldDesc[] = [
  { key: "favoriteWeight", label: "favorite weight", step: "0.1" },
  { key: "noveltyBoost", label: "novelty boost", step: "0.1" },
  { key: "pantryWeight", label: "pantry weight", step: "0.1" },
  { key: "perishWeight", label: "perishable weight", step: "0.5" },
  { key: "keyWeight", label: "key-ingredient weight", step: "0.5" },
  { key: "overlapCap", label: "overlap cap", step: "1" },
];

const FLYER_FIELDS: FieldDesc[] = [
  { key: "minFlyerDiscount", label: "min flyer discount (%)", step: "1", pct: true },
  { key: "flyerRefreshHours", label: "flyer refresh (hours)", step: "1" },
  { key: "flyerBatchUnits", label: "flyer batch units", step: "1" },
];

function href(slug: string): string {
  return slug ? `/admin/config/${slug}` : "/admin/config";
}

const ConfigShell = ({ active, children }: { active: string; children?: Child }) => (
  <Layout title="Config · grocery-agent admin" active="/admin/config" wide>
    <div class="data-nav">
      {VIEWS.map((v) => (
        <a href={href(v.slug)} class={v.slug === active ? "pill active" : "pill"}>
          {v.label}
        </a>
      ))}
    </div>
    {children}
  </Layout>
);

function serialize(props: unknown): string {
  return JSON.stringify(props).replace(/</g, "\\u003c");
}

function html(node: { toString(): string }): string {
  return "<!doctype html>" + node.toString();
}

const CalibrationPage = ({ config }: { config: DiscoveryConfig }) => (
  <ConfigShell active="">
    <h2>Discovery calibration</h2>
    <p class="muted small">Tune the sweep's knobs, preview with Analyze / Dry-run, then Save (a below-floor value asks to confirm).</p>
    <div id="config-island">
      <p class="muted">Loading the calibration console…</p>
    </div>
    <script type="application/json" id="config-props" dangerouslySetInnerHTML={{ __html: serialize({ config }) }} />
    <script type="module" src="/admin/islands/calibration.js" />
  </ConfigShell>
);

const OpConfigPage = ({
  active,
  title,
  config,
  fields,
}: {
  active: string;
  title: string;
  config: OperatorConfig;
  fields: FieldDesc[];
}) => (
  <ConfigShell active={active}>
    <h2>{title}</h2>
    <div id="config-island">
      <p class="muted">Loading…</p>
    </div>
    <script type="application/json" id="config-props" dangerouslySetInnerHTML={{ __html: serialize({ config, fields }) }} />
    <script type="module" src="/admin/islands/opconfig.js" />
  </ConfigShell>
);

export function registerConfigRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/config", async (c) => {
    const { config } = await getDiscoveryConfig(c.env);
    return c.html(html(<CalibrationPage config={config} />));
  });
  app.get("/config/ranking", async (c) => {
    const { config } = await getOperatorConfig(c.env);
    return c.html(html(<OpConfigPage active="ranking" title="Ranking weights" config={config} fields={RANKING_FIELDS} />));
  });
  app.get("/config/flyer", async (c) => {
    const { config } = await getOperatorConfig(c.env);
    return c.html(html(<OpConfigPage active="flyer" title="Flyer behavior" config={config} fields={FLYER_FIELDS} />));
  });
}
