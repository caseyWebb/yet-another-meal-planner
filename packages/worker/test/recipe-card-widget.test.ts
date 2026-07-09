// Wiring test for the recipe-card widget (recipe-card-widget), mirroring the reverted
// hello-widget spike test: it drives the SAME in-memory MCP client a real host uses
// (tool-harness) against a fresh server carrying ONLY the widget, so a "widget didn't render"
// in claude.ai is attributable to the host, not a miswire here. Covers the four contract
// points: `display_recipe` links the ui:// resource via `_meta.ui.resourceUri`; the resource
// reads back with the MCP Apps MIME as one HTML document; a valid slug yields the
// `structuredContent` shape + a text fallback; a bad slug returns a structured `not_found`.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { registerRecipeCardWidget, RECIPE_CARD_URI, WIDGET_MARKER } from "../src/recipe-card-widget.js";
import { readRecipeDetail } from "../src/tools.js";
import type { Env } from "../src/env.js";
import { fakeR2 } from "./fake-r2.js";
import { withServer } from "./tool-harness.js";

const RECIPE_MD = [
  "---",
  "title: Miso Salmon",
  "protein: fish",
  "cuisine: japanese",
  "time_total: 25",
  "dietary: [gluten-free, dairy-free]",
  "tags: [weeknight]",
  "course: [main]",
  "requires_equipment: []",
  "source: https://ex.com/miso-salmon",
  "---",
  "",
  "## Ingredients",
  "- salmon",
  "- miso",
  "",
  "## Instructions",
  "1. Glaze and broil.",
  "",
].join("\n");

// The self-contained widget document the ASSETS binding serves in production. In the test we
// stub ASSETS to return a minimal document carrying the same marker the read asserts.
const WIDGET_HTML = `<!DOCTYPE html><html><head><meta name="mcp-widget" content="${WIDGET_MARKER}" /></head><body><div id="root" data-widget="recipe-card"></div></body></html>`;

/**
 * A test env: fakeR2 corpus for the recipe body, a DB stub whose reads are empty (no overlay /
 * last-cooked / derived-description rows), and an ASSETS stub serving the widget HTML for the
 * `widgets/recipe-card.html` path (anything else 404s — the SPA-fallback path is not modeled).
 */
function testEnv(files: Record<string, string>, assetHtml: string = WIDGET_HTML): Env {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ meta: { changes: 0 } }),
  };
  return {
    DB: { prepare: () => stmt },
    CORPUS: fakeR2(files).bucket,
    ASSETS: {
      fetch: async (req: Request) => {
        const url = typeof req === "string" ? req : req.url;
        if (url.endsWith("/widgets/recipe-card.html")) {
          return new Response(assetHtml, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response("not found", { status: 404 });
      },
    },
  } as unknown as Env;
}

function freshServer(files: Record<string, string>, assetHtml?: string): McpServer {
  const env = testEnv(files, assetHtml);
  const server = new McpServer({ name: "recipe-card-test", version: "0.0.0" });
  registerRecipeCardWidget(server, env, (slug) => readRecipeDetail(env, "casey", slug));
  return server;
}

describe("recipe-card-widget (MCP Apps wiring)", () => {
  it("display_recipe references the ui:// resource via _meta.ui.resourceUri", async () => {
    await withServer(freshServer({ "recipes/miso-salmon.md": RECIPE_MD }), async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "display_recipe");
      expect(tool).toBeDefined();
      const meta = tool?._meta as { ui?: { resourceUri?: string }; "ui/resourceUri"?: string } | undefined;
      const resourceUri = meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
      expect(resourceUri).toBe(RECIPE_CARD_URI);
    });
  });

  it("serves ui://recipe/card as a readable MCP Apps HTML resource", async () => {
    await withServer(freshServer({ "recipes/miso-salmon.md": RECIPE_MD }), async (client) => {
      const read = await client.readResource({ uri: RECIPE_CARD_URI });
      expect(read.contents).toHaveLength(1);
      const item = read.contents[0] as { uri: string; mimeType?: string; text?: string };
      expect(item.uri).toBe(RECIPE_CARD_URI);
      expect(item.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(item.mimeType).toBe("text/html;profile=mcp-app");
      // The read fetched the REAL widget (the marker), not the SPA-fallback shell.
      expect(item.text).toContain(WIDGET_MARKER);
      expect(item.text).toContain("<!DOCTYPE html>");
    });
  });

  it("display_recipe returns the widget result: _meta.ui, structuredContent, and a text fallback", async () => {
    await withServer(freshServer({ "recipes/miso-salmon.md": RECIPE_MD }), async (client) => {
      const res = await client.callTool({ name: "display_recipe", arguments: { slug: "miso-salmon" } });

      // The link a host follows to mount the iframe rides on the RESULT too.
      const meta = res._meta as { ui?: { resourceUri?: string } } | undefined;
      expect(meta?.ui?.resourceUri).toBe(RECIPE_CARD_URI);

      const sc = res.structuredContent as {
        slug: string;
        title: string;
        time_total: number | null;
        dietary: string[];
        tags?: string[];
        protein?: string | null;
        cuisine?: string | null;
        course?: string[];
        favorite?: boolean;
        body: string;
      };
      expect(sc.slug).toBe("miso-salmon");
      expect(sc.title).toBe("Miso Salmon");
      expect(sc.time_total).toBe(25);
      expect(sc.dietary).toEqual(["gluten-free", "dairy-free"]);
      expect(sc.tags).toEqual(["weeknight"]);
      expect(sc.protein).toBe("fish");
      expect(sc.cuisine).toBe("japanese");
      expect(sc.course).toEqual(["main"]);
      expect(sc.favorite).toBe(false);
      expect(sc.body).toContain("Glaze and broil");

      // The text content fallback for hosts that cannot render the widget.
      const content = res.content as Array<{ type: string; text?: string }>;
      const text = content.find((c) => c.type === "text")?.text ?? "";
      expect(text).toContain("Miso Salmon");
      expect(res.isError).toBeFalsy();
    });
  });

  it("returns a structured not_found for an unknown slug (never throws)", async () => {
    await withServer(freshServer({ "recipes/miso-salmon.md": RECIPE_MD }), async (client) => {
      const res = await client.callTool({ name: "display_recipe", arguments: { slug: "ghost-recipe" } });
      expect(res.isError).toBe(true);
      const content = res.content as Array<{ type: string; text?: string }>;
      const parsed = JSON.parse(content[0]?.text ?? "{}") as { error?: string };
      expect(parsed.error).toBe("not_found");
    });
  });

  it("fails the resource read when ASSETS returns the marker-less SPA shell (not the widget)", async () => {
    // not_found_handling: "single-page-application" resolves an unknown asset path to the member
    // SPA shell with HTTP 200; the marker guard MUST reject that rather than serve the wrong doc.
    const SPA_SHELL = `<!DOCTYPE html><html><head><title>Grocery</title></head><body><div id="app"></div></body></html>`;
    await withServer(freshServer({ "recipes/miso-salmon.md": RECIPE_MD }, SPA_SHELL), async (client) => {
      await expect(client.readResource({ uri: RECIPE_CARD_URI })).rejects.toThrow();
    });
  });
});
