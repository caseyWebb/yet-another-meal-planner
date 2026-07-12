import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
	GROCERY_WIDGET_MARKER,
	GROCERY_WIDGET_URI,
	registerGroceryWidget,
} from "../src/grocery-widget.js";
import { readGrocerySnapshot } from "../src/grocery-snapshot.js";
import type { Env } from "../src/env.js";
import { sqliteEnv } from "./sqlite-d1.js";
import { withServer } from "./tool-harness.js";

const T = "casey";
const HTML = `<!DOCTYPE html><html><head><meta name="mcp-widget" content="${GROCERY_WIDGET_MARKER}"></head><body></body></html>`;
function env(asset = HTML): Env {
	const h = sqliteEnv([T]);
	return {
		...(h.env as object),
		ASSETS: { fetch: async () => new Response(asset, { status: 200 }) },
	} as unknown as Env;
}
function server(e: Env): McpServer {
	const s = new McpServer({ name: "grocery-widget-test", version: "0" });
	registerGroceryWidget(s, e, T);
	return s;
}

describe("grocery widget MCP wiring", () => {
	it("registers display/resource and app-only boot/mutation tools", async () => {
		await withServer(server(env()), async (client) => {
			const { tools } = await client.listTools();
			const display = tools.find(
				(tool) => tool.name === "display_grocery_list",
			);
			expect(
				(display?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri,
			).toBe(GROCERY_WIDGET_URI);
			for (const name of [
				"read_grocery_snapshot",
				"set_grocery_checked",
				"set_grocery_buy_anyway",
				"set_grocery_substitution",
				"relist_grocery_send_line",
				"mark_grocery_send_placed",
			]) {
				expect(tools.some((tool) => tool.name === name)).toBe(true);
			}
			const read = await client.readResource({ uri: GROCERY_WIDGET_URI });
			expect(read.contents[0]).toMatchObject({
				uri: GROCERY_WIDGET_URI,
				mimeType: RESOURCE_MIME_TYPE,
			});
			expect((read.contents[0] as { text?: string }).text).toContain(
				GROCERY_WIDGET_MARKER,
			);
		});
	});

	it("display and boot use the same snapshot operation with equivalent text and no credentials", async () => {
		const e = env();
		await withServer(server(e), async (client) => {
			const display = await client.callTool({
				name: "display_grocery_list",
				arguments: {},
			});
			const boot = await client.callTool({
				name: "read_grocery_snapshot",
				arguments: {},
			});
			const card = display.structuredContent as {
				snapshot_version: string;
				counts: { to_buy: number };
			};
			const bootSnapshot = (
				boot.structuredContent as { snapshot: { snapshot_version: string } }
			).snapshot;
			expect(card.snapshot_version).toBe(bootSnapshot.snapshot_version);
			expect((display.content as { text?: string }[])[0].text).toContain(
				`${card.counts.to_buy} to buy`,
			);
			expect(JSON.stringify(display.structuredContent)).not.toMatch(
				/credential|session_id|signed_url/i,
			);
			expect((await readGrocerySnapshot(e, T)).snapshot_version).toBe(
				card.snapshot_version,
			);
		});
	});

	it("rejects a marker-less SPA fallback", async () => {
		await withServer(
			server(env("<!DOCTYPE html><title>member app</title>")),
			async (client) => {
				await expect(
					client.readResource({ uri: GROCERY_WIDGET_URI }),
				).rejects.toThrow();
			},
		);
	});

	it("returns a structured display error with widget metadata when storage fails", async () => {
		const e = env();
		e.DB = {
			prepare: () => {
				throw new Error("storage offline");
			},
		} as unknown as Env["DB"];
		await withServer(server(e), async (client) => {
			const display = await client.callTool({
				name: "display_grocery_list",
				arguments: {},
			});
			expect(display.isError).toBe(true);
			expect(
				(display._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri,
			).toBe(GROCERY_WIDGET_URI);
			expect((display.content as { text?: string }[])[0].text).toContain(
				"storage offline",
			);
		});
	});
});
