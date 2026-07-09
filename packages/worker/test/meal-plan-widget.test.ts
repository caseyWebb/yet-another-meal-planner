// Wiring test for the meal-plan proposal widget (meal-plan-widget), mirroring the recipe-card
// widget test: it drives the SAME in-memory MCP client a real host uses (tool-harness) against a
// fresh server carrying ONLY the widget, so a "widget didn't render" in claude.ai is attributable
// to the host, not a miswire here. Covers the contract points: `display_meal_plan` links the ui://
// resource via `_meta.ui.resourceUri` UNCONDITIONALLY; the resource reads back with the MCP Apps
// MIME as one HTML document; a proposal yields the `structuredContent` shape (plan + render
// context) + a text fallback listing the nights; a structured error from the shared op passes
// through as a structured result (never thrown, no partial widget payload).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { registerMealPlanWidget, PLAN_PROPOSE_URI, WIDGET_MARKER } from "../src/meal-plan-widget.js";
import type { ProposeDeps } from "../src/meal-plan-proposal-tool.js";
import { emptyIngredientContext } from "../src/corpus-db.js";
import { ToolError } from "../src/errors.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";
import { EMBED_DIM } from "../src/embedding.js";
import { fakeD1 } from "./fake-d1.js";
import { withServer } from "./tool-harness.js";

const TENANT: Tenant = { id: "casey" };

// The self-contained widget document the ASSETS binding serves in production. In the test we stub
// ASSETS to return a minimal document carrying the same marker the read asserts.
const WIDGET_HTML = `<!DOCTYPE html><html><head><meta name="mcp-widget" content="${WIDGET_MARKER}" /></head><body><div id="root" data-widget="plan-propose"></div></body></html>`;

function axis(...on: [number, number][]): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const [i, w] of on) v[i] = w;
  return v;
}

interface RecipeFixture {
  slug: string;
  title: string;
  protein: string;
  cuisine: string;
  time_total: number;
  vec: number[];
}
const CORPUS: RecipeFixture[] = [
  { slug: "salmon-rice", title: "Salmon Rice", protein: "fish", cuisine: "japanese", time_total: 30, vec: axis([0, 1]) },
  { slug: "chicken-soup", title: "Chicken Soup", protein: "chicken", cuisine: "american", time_total: 30, vec: axis([1, 1]) },
  { slug: "beef-ragu", title: "Beef Ragu", protein: "beef", cuisine: "italian", time_total: 60, vec: axis([2, 1], [1, 0.2]) },
];

const SEAFOOD = { id: "seafood-night", vibe: "something from the sea", vec: axis([0, 1], [1, 0.6]) };
const COMFORT = { id: "comfort-night", vibe: "cozy comfort food", vec: axis([1, 1], [2, 0.6]) };

function memKv() {
  const store = new Map<string, string>();
  return { store, async get(k: string) { return store.get(k) ?? null; }, async put(k: string, v: string) { store.set(k, v); } };
}

/** Assemble the widget's env: the propose op's D1 domain tables + embed-cache KV + a spy AI
 *  binding (unused here — no freeform/override text) + an ASSETS stub serving the widget HTML. */
function widgetEnv(vibes = [SEAFOOD, COMFORT], corpus = CORPUS, assetHtml: string = WIDGET_HTML): Env {
  const d1 = fakeD1({
    tables: {
      recipes: corpus.map((r) => ({
        slug: r.slug, title: r.title, protein: r.protein, cuisine: r.cuisine, time_total: r.time_total,
        ingredients_key: null, source_url: null, tags: null, course: null, season: null, dietary: null,
        pairs_with: null, perishable_ingredients: null, requires_equipment: null, extra: null, discovered_at: null,
      })),
      recipe_derived: corpus.map((r) => ({ slug: r.slug, embedding: JSON.stringify(r.vec), description: null })),
      night_vibes: vibes.map((v) => ({
        tenant: TENANT.id, id: v.id, vibe: v.vibe, facets: null, cadence_days: null, pinned: 0,
        base_weight: null, weather_affinity: null, weather_antipathy: null, season: null, created_at: null,
      })),
      night_vibe_derived: vibes.map((v) => ({ tenant: TENANT.id, id: v.id, embedding: JSON.stringify(v.vec) })),
      profile: [],
      brand_prefs: [],
      pantry: [],
      cooking_log: [],
    },
  });
  const ai = vi.fn(async () => { throw new Error("unexpected embed"); });
  return {
    ...(d1.env as object),
    KROGER_KV: memKv(),
    AI: { run: ai },
    ASSETS: {
      fetch: async (req: Request) => {
        const url = typeof req === "string" ? req : req.url;
        if (url.endsWith("/widgets/plan-propose.html")) {
          return new Response(assetHtml, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response("not found", { status: 404 });
      },
    },
  } as unknown as Env;
}

function stubDeps(env: Env): ProposeDeps {
  return {
    getOverlay: async () => ({}),
    getLastCookedMap: async () => new Map(),
    getOwnedEquipment: async () => [],
    getIngredientContext: async () => emptyIngredientContext(env),
  };
}

function freshServer(env: Env, deps: ProposeDeps = stubDeps(env)): McpServer {
  const server = new McpServer({ name: "meal-plan-widget-test", version: "0.0.0" });
  registerMealPlanWidget(server, env, TENANT, deps);
  return server;
}

// Weather upstream down → no forecast signal (all-flex week), keeping the fixture deterministic.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("meal-plan-widget (MCP Apps wiring)", () => {
  it("display_meal_plan references the ui:// resource via _meta.ui.resourceUri unconditionally", async () => {
    await withServer(freshServer(widgetEnv()), async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "display_meal_plan");
      expect(tool).toBeDefined();
      const meta = tool?._meta as { ui?: { resourceUri?: string }; "ui/resourceUri"?: string } | undefined;
      const resourceUri = meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
      expect(resourceUri).toBe(PLAN_PROPOSE_URI);
    });
  });

  it("serves ui://plan/propose as a readable MCP Apps HTML resource", async () => {
    await withServer(freshServer(widgetEnv()), async (client) => {
      const read = await client.readResource({ uri: PLAN_PROPOSE_URI });
      expect(read.contents).toHaveLength(1);
      const item = read.contents[0] as { uri: string; mimeType?: string; text?: string };
      expect(item.uri).toBe(PLAN_PROPOSE_URI);
      expect(item.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(item.mimeType).toBe("text/html;profile=mcp-app");
      expect(item.text).toContain(WIDGET_MARKER);
      expect(item.text).toContain("<!DOCTYPE html>");
    });
  });

  it("display_meal_plan returns the widget result: _meta.ui, structuredContent, and a text fallback listing the nights", async () => {
    await withServer(freshServer(widgetEnv()), async (client) => {
      const res = await client.callTool({ name: "display_meal_plan", arguments: { nights: 2, seed: 7 } });

      const meta = res._meta as { ui?: { resourceUri?: string } } | undefined;
      expect(meta?.ui?.resourceUri).toBe(PLAN_PROPOSE_URI);

      const sc = res.structuredContent as {
        plan: { vibe_id: string | null; main: { slug: string; title: string } | null }[];
        variety: { distinct_cuisines: number };
        diagnostics: { seed: number; nights: number; filled: number };
        request: { nights: number; seed: number; variety: number };
        vibeLabels: Record<string, string>;
        proteins: string[];
        cuisines: string[];
      };
      expect(sc.diagnostics.filled).toBe(2);
      expect(sc.diagnostics.seed).toBe(7);
      // The replayable request seeds the widget's client session from the resolved week.
      expect(sc.request.nights).toBe(2);
      expect(sc.request.seed).toBe(7);
      // The render context the dials need: vibe labels + facet universes.
      expect(sc.vibeLabels[SEAFOOD.id]).toBe(SEAFOOD.vibe);
      expect(sc.vibeLabels[COMFORT.id]).toBe(COMFORT.vibe);
      expect(sc.proteins).toEqual(["beef", "chicken", "fish"]);
      expect(sc.cuisines).toEqual(["american", "italian", "japanese"]);
      const mains = sc.plan.map((s) => s.main?.slug).filter(Boolean).sort();
      expect(mains).toEqual(["chicken-soup", "salmon-rice"]);

      // The text content fallback: hosts that cannot render the widget read the proposed nights.
      const content = res.content as Array<{ type: string; text?: string }>;
      const text = content.find((c) => c.type === "text")?.text ?? "";
      expect(text).toContain("Salmon Rice");
      expect(text).toContain("Variety:");
      expect(res.isError).toBeFalsy();
    });
  });

  it("passes a structured error from the shared op through (never thrown, no partial widget payload)", async () => {
    const env = widgetEnv();
    // The op's context load rejects with a structured ToolError — the widget tool must surface it
    // as a structured result, not throw, and must not emit a half-built structuredContent.
    const deps: ProposeDeps = {
      ...stubDeps(env),
      getOverlay: async () => { throw new ToolError("storage_error", "overlay read failed"); },
    };
    await withServer(freshServer(env, deps), async (client) => {
      const res = await client.callTool({ name: "display_meal_plan", arguments: { nights: 2, seed: 7 } });
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
      const content = res.content as Array<{ type: string; text?: string }>;
      const parsed = JSON.parse(content[0]?.text ?? "{}") as { error?: string };
      expect(parsed.error).toBe("storage_error");
    });
  });

  it("fails the resource read when ASSETS returns the marker-less SPA shell (not the widget)", async () => {
    const SPA_SHELL = `<!DOCTYPE html><html><head><title>Grocery</title></head><body><div id="app"></div></body></html>`;
    await withServer(freshServer(widgetEnv([SEAFOOD, COMFORT], CORPUS, SPA_SHELL)), async (client) => {
      await expect(client.readResource({ uri: PLAN_PROPOSE_URI })).rejects.toThrow();
    });
  });
});
