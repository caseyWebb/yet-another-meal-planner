import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	registerAppResource,
	registerAppTool,
	RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { Env } from "./env.js";
import { ToolError, fail } from "./errors.js";
import {
	addGroceryRow,
	isoDay,
	readGroceryList,
	removeGroceryRow,
} from "./session-db.js";
import {
	grocerySnapshotText,
	readGrocerySnapshot,
} from "./grocery-snapshot.js";
import {
	acceptGrocerySubstitution,
	GroceryCheckedInputSchema,
	GroceryCoverageInputSchema,
	GroceryMarkPlacedInputSchema,
	GroceryRelistInputSchema,
	GrocerySubstitutionInputSchema,
	GroceryVerifyInputSchema,
	markGrocerySendPlaced,
	relistGrocerySendLine,
	setGroceryBuyAnyway,
	setGroceryChecked,
	undoGrocerySubstitution,
	verifyGroceryPantry,
} from "./grocery-operations.js";

export const GROCERY_WIDGET_URI = "ui://grocery/list";
export const GROCERY_WIDGET_MARKER = "grocery-list-widget";
const WIDGET_ASSET_URL = "https://assets.local/widgets/grocery-list.html";

async function resultOf(
	env: Env,
	tenant: string,
	body: () => Promise<unknown>,
) {
	try {
		const value = await body();
		const snapshot =
			value && typeof value === "object" && "snapshot" in value
				? (
						value as {
							snapshot: Awaited<ReturnType<typeof readGrocerySnapshot>>;
						}
					).snapshot
				: await readGrocerySnapshot(env, tenant);
		return {
			structuredContent: { snapshot },
			content: [{ type: "text" as const, text: grocerySnapshotText(snapshot) }],
		};
	} catch (error) {
		if (error instanceof ToolError) return fail(error.toShape());
		return fail({
			error: "upstream_unavailable",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

export function registerGroceryWidget(
	server: McpServer,
	env: Env,
	tenant: string,
): void {
	registerAppResource(
		server,
		"Grocery List",
		GROCERY_WIDGET_URI,
		{
			description:
				"Self-contained grocery list: Department/Recipe grouping, durable checks, pantry decisions, and exact send confirmation.",
		},
		async () => {
			const response = await env.ASSETS.fetch(new Request(WIDGET_ASSET_URL));
			if (!response.ok)
				throw new ToolError(
					"not_found",
					`grocery widget asset is unavailable (status ${response.status})`,
				);
			const html = await response.text();
			if (!html.includes(GROCERY_WIDGET_MARKER))
				throw new ToolError(
					"not_found",
					"grocery widget asset not found (received the SPA shell)",
				);
			return {
				contents: [
					{ uri: GROCERY_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
				],
			};
		},
	);

	registerAppTool(
		server,
		"display_grocery_list",
		{
			title: "Display grocery list",
			description:
				"Render the current grocery list as the interactive shared Grocery card. Use this when the member asks to see or work with the list. The payload is render-only and re-hydrates before writes; content is an equivalent plain-text fallback.",
			inputSchema: {},
			_meta: { ui: { resourceUri: GROCERY_WIDGET_URI } },
		},
		async () => {
			const result = await resultOf(env, tenant, () =>
				readGrocerySnapshot(env, tenant),
			);
			const wrapped =
				"structuredContent" in result
					? (result.structuredContent as { snapshot?: unknown } | undefined)
					: undefined;
			return {
				...result,
				_meta: { ui: { resourceUri: GROCERY_WIDGET_URI } },
				...(wrapped?.snapshot
					? { structuredContent: wrapped.snapshot as Record<string, unknown> }
					: {}),
			};
		},
	);

	registerAppTool(
		server,
		"read_grocery_snapshot",
		{
			title: "Read grocery snapshot",
			description: "App-callable authoritative grocery boot read.",
			inputSchema: {},
			_meta: { ui: { visibility: ["app"] } },
		},
		async () => resultOf(env, tenant, () => readGrocerySnapshot(env, tenant)),
	);
	registerAppTool(
		server,
		"grocery_add",
		{
			title: "Add grocery item",
			description: "App-callable replay-safe grocery add.",
			inputSchema: { name: z.string() },
			_meta: { ui: { visibility: ["app"] } },
		},
		async ({ name }) =>
			resultOf(env, tenant, () =>
				addGroceryRow(env, tenant, { name }, isoDay(Date.now())),
			),
	);
	registerAppTool(
		server,
		"grocery_remove",
		{
			title: "Remove grocery item",
			description: "App-callable canonical-key grocery remove.",
			inputSchema: { key: z.string() },
			_meta: { ui: { visibility: ["app"] } },
		},
		async ({ key }) =>
			resultOf(env, tenant, async () => {
				const row = (await readGroceryList(env, tenant)).find(
					(item) => item.normalized_name === key,
				);
				if (row) await removeGroceryRow(env, tenant, row.name);
			}),
	);
	registerAppTool(
		server,
		"set_grocery_checked",
		{
			title: "Set grocery checked",
			description: "App-callable exact checked-state mutation.",
			inputSchema: GroceryCheckedInputSchema.shape,
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) =>
			resultOf(env, tenant, () => setGroceryChecked(env, tenant, input)),
	);
	registerAppTool(
		server,
		"set_grocery_buy_anyway",
		{
			title: "Set grocery pantry override",
			description: "App-callable Buy-anyway/Undo decision.",
			inputSchema: GroceryCoverageInputSchema.shape,
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) =>
			resultOf(env, tenant, () => setGroceryBuyAnyway(env, tenant, input)),
	);
	registerAppTool(
		server,
		"verify_grocery_pantry",
		{
			title: "Verify grocery pantry item",
			description: "App-callable Still-good verification.",
			inputSchema: GroceryVerifyInputSchema.shape,
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) =>
			resultOf(env, tenant, () => verifyGroceryPantry(env, tenant, input)),
	);
	registerAppTool(
		server,
		"set_grocery_substitution",
		{
			title: "Set grocery substitution",
			description: "App-callable persistent substitution accept/Undo.",
			inputSchema: GrocerySubstitutionInputSchema.shape,
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) =>
			resultOf(env, tenant, () =>
				input.undo
					? undoGrocerySubstitution(env, tenant, {
							original_key: input.original_key,
							snapshot_version: input.snapshot_version,
						})
					: acceptGrocerySubstitution(env, tenant, {
							original_key: input.original_key,
							replacement_key: input.replacement_key ?? "",
							replacement_name: input.replacement_name ?? "",
							snapshot_version: input.snapshot_version,
						}),
			),
	);
	registerAppTool(
		server,
		"relist_grocery_send_line",
		{
			title: "Relist grocery send line",
			description: "App-callable send-scoped Back to list.",
			inputSchema: GroceryRelistInputSchema.shape,
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) =>
			resultOf(env, tenant, () => relistGrocerySendLine(env, tenant, input)),
	);
	registerAppTool(
		server,
		"mark_grocery_send_placed",
		{
			title: "Mark grocery send placed",
			description:
				"App-callable exact send-wide purchase assertion; online and never queued.",
			inputSchema: GroceryMarkPlacedInputSchema.shape,
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) =>
			resultOf(env, tenant, () => markGrocerySendPlaced(env, tenant, input)),
	);
}
