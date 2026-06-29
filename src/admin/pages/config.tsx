// The Config area (operator-admin), server-rendered. A pill sub-nav over the config sub-views,
// each its own route; the default (bare /admin/config) is the discovery calibration console. The
// sub-nav grows as sub-views land (Calibration first; ranking/flyer + the corpus editors follow).
// Each sub-view seeds its island from SSR-loaded config (no client fetch for first data).

import type { Child } from "hono/jsx";
import { Hono } from "hono";
import { Layout } from "../ui/layout.js";
import type { Env } from "../../env.js";
import type { DiscoveryConfig } from "../../discovery-sweep.js";
import { getDiscoveryConfig } from "../config-api.js";

/** The built Config sub-views (slug "" = the bare /admin/config calibration default). */
const VIEWS: { slug: string; label: string }[] = [{ slug: "", label: "Calibration" }];

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

export function registerConfigRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/config", async (c) => {
    const { config } = await getDiscoveryConfig(c.env);
    return c.html(html(<CalibrationPage config={config} />));
  });
}
