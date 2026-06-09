// Repo-data write tools (data-write-tools capability). Each tool reads the
// current file(s), applies a pure transform, and persists via the atomic commit
// engine (commit.ts). The standalone tools commit one logical change; the
// batching tool `commit_changes` reuses the same builders to land a whole
// session as ONE commit. No tool here writes a Kroger cart or calls an external
// service — that is Change 06b.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient, TreeFile } from "./github.js";
import { readFile, readOptional } from "./gh-read.js";
import { parseMarkdown, parseToml } from "./parse.js";
import { serializeMarkdown, stringifyTomlWithHeader } from "./serialize.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import { applyPantryOperations, markVerified, type PantryItem } from "./pantry-write.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function itemsOf(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

// --- file-level builders (return a TreeFile for the atomic commit) -----------

export async function buildRecipeUpdate(
  gh: GitHubClient,
  slug: string,
  updates: Record<string, unknown>,
): Promise<TreeFile> {
  if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  const path = `recipes/${slug}.md`;
  const text = await readFile(gh, path, "not_found", `Unknown recipe slug: ${slug}`);
  const { frontmatter, body } = parseMarkdown(text, path);
  const merged = { ...frontmatter, ...updates };
  return { path, content: serializeMarkdown(merged, body) };
}

async function buildPantryUpdate(
  gh: GitHubClient,
  operations: Parameters<typeof applyPantryOperations>[1],
  verifyNames: string[],
): Promise<{ file: TreeFile | null; applied: unknown[]; conflicts: unknown[] }> {
  const text = await readFile(gh, "pantry.toml", "not_found", "pantry.toml is missing");
  const parsed = parseToml(text, "pantry.toml");
  let items = itemsOf(parsed) as PantryItem[];

  const opResult = applyPantryOperations(items, operations, today());
  items = opResult.items;
  let verified: string[] = [];
  let missing: string[] = [];
  if (verifyNames.length) {
    const v = markVerified(items, verifyNames, today());
    items = v.items;
    verified = v.verified;
    missing = v.missing;
  }

  const changed = opResult.applied.length > 0 || verified.length > 0;
  const conflicts = [
    ...opResult.conflicts,
    ...missing.map((name) => ({ op: "verify" as const, name, reason: "no pantry item with that name" })),
  ];
  if (!changed) return { file: null, applied: opResult.applied, conflicts };

  const content = stringifyTomlWithHeader(text, { ...parsed, items });
  return {
    file: { path: "pantry.toml", content },
    applied: [...opResult.applied, ...verified.map((name) => ({ op: "verify" as const, name }))],
    conflicts,
  };
}

/** In-memory manager for the per-meal ready_to_eat catalogs, loading each file once. */
function readyToEatManager(gh: GitHubClient) {
  const loaded = new Map<Meal, { text: string; parsed: Record<string, unknown>; items: Record<string, unknown>[] }>();
  const touched = new Set<Meal>();

  async function load(meal: Meal) {
    if (!loaded.has(meal)) {
      const path = `ready_to_eat/${meal}.toml`;
      const text = (await readOptional(gh, path)) ?? "";
      const parsed = text ? parseToml(text, path) : {};
      loaded.set(meal, { text, parsed, items: itemsOf(parsed) });
    }
    return loaded.get(meal)!;
  }

  return {
    async addDraft(meal: Meal, item: Record<string, unknown>) {
      const f = await load(meal);
      f.items.push({
        name: item.name,
        sku: null,
        category: item.category ?? null,
        status: "draft",
        added_at: today(),
        discovered_at: today(),
        discovery_source: item.source ?? null,
        brand: item.brand ?? null,
        notes: item.notes ?? null,
      });
      touched.add(meal);
    },
    /** Find an item by name across all meals, apply updates. Throws not_found if absent. */
    async update(name: string, updates: Record<string, unknown>) {
      for (const meal of MEALS) {
        const f = await load(meal);
        const idx = f.items.findIndex(
          (it) => typeof it.name === "string" && it.name.toLowerCase() === name.toLowerCase(),
        );
        if (idx >= 0) {
          f.items[idx] = { ...f.items[idx], ...updates };
          touched.add(meal);
          return;
        }
      }
      throw new ToolError("not_found", `No ready-to-eat item named: ${name}`, { name });
    },
    files(): TreeFile[] {
      const out: TreeFile[] = [];
      for (const meal of touched) {
        const f = loaded.get(meal)!;
        out.push({
          path: `ready_to_eat/${meal}.toml`,
          content: stringifyTomlWithHeader(f.text, { ...f.parsed, items: f.items }),
        });
      }
      return out;
    },
  };
}

const CURATED_FILES: Record<string, string> = {
  preferences: "preferences.toml",
  taste: "taste.md",
  diet_principles: "diet_principles.md",
  substitutions: "substitutions.toml",
  aliases: "aliases.toml",
};

// --- registration ------------------------------------------------------------

export function registerWriteTools(server: McpServer, gh: GitHubClient): void {
  server.registerTool(
    "update_recipe",
    {
      description:
        "Update a recipe's frontmatter (last_cooked, rating, status transitions, or directed edits). Commits one change. For batching a whole session, use commit_changes instead.",
      inputSchema: { slug: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ slug, updates }) =>
      runTool(async () => {
        const file = await buildRecipeUpdate(gh, slug, updates);
        const { commit_sha } = await commitFiles(gh, [file], `update recipe ${slug}`);
        return { slug, updated_fields: Object.keys(updates), commit_sha };
      }),
  );

  server.registerTool(
    "update_pantry",
    {
      description:
        "Apply pantry add/remove/verify operations. Returns what was applied and any conflicts (e.g. a remove whose target isn't present).",
      inputSchema: {
        operations: z.array(
          z.object({
            op: z.enum(["add", "remove", "verify"]),
            item: z.record(z.string(), z.unknown()).optional(),
            name: z.string().optional(),
          }),
        ),
      },
    },
    ({ operations }) =>
      runTool(async () => {
        const { file, applied, conflicts } = await buildPantryUpdate(gh, operations, []);
        if (!file) return { applied, conflicts };
        const { commit_sha } = await commitFiles(gh, [file], "update pantry");
        return { applied, conflicts, commit_sha };
      }),
  );

  server.registerTool(
    "mark_pantry_verified",
    {
      description: "Reset last_verified_at to today on the named pantry items.",
      inputSchema: { items: z.array(z.string()) },
    },
    ({ items }) =>
      runTool(async () => {
        const { file, applied, conflicts } = await buildPantryUpdate(gh, [], items);
        if (!file) return { verified: [], conflicts };
        const { commit_sha } = await commitFiles(gh, [file], "verify pantry items");
        return { verified: applied.filter((a: any) => a.op === "verify").map((a: any) => a.name), conflicts, commit_sha };
      }),
  );

  server.registerTool(
    "add_draft_ready_to_eat",
    {
      description:
        "Append ready-to-eat items in draft state. Each item needs a meal (breakfast|lunch|dinner).",
      inputSchema: {
        items: z.array(
          z.object({
            meal: z.enum(MEALS),
            name: z.string(),
            category: z.string().optional(),
            source: z.string().optional(),
            brand: z.string().optional(),
            notes: z.string().optional(),
          }),
        ),
      },
    },
    ({ items }) =>
      runTool(async () => {
        const mgr = readyToEatManager(gh);
        for (const it of items) await mgr.addDraft(it.meal, it);
        const files = mgr.files();
        const { commit_sha } = await commitFiles(gh, files, "add ready-to-eat drafts");
        return { added: items.map((it) => ({ meal: it.meal, name: it.name })), commit_sha };
      }),
  );

  server.registerTool(
    "update_ready_to_eat",
    {
      description: "Disposition or update a ready-to-eat item, matched by name across meal catalogs.",
      inputSchema: { name: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ name, updates }) =>
      runTool(async () => {
        const mgr = readyToEatManager(gh);
        await mgr.update(name, updates);
        const { commit_sha } = await commitFiles(gh, mgr.files(), `update ready-to-eat ${name}`);
        return { name, updated_fields: Object.keys(updates), commit_sha };
      }),
  );

  // User-curated config writers — content-faithful: write exactly what the caller
  // supplies. The discipline of WHEN to call these (only on explicit user
  // direction) lives in AGENT_INSTRUCTIONS.md.
  for (const [key, path] of Object.entries(CURATED_FILES)) {
    server.registerTool(
      `update_${key}`,
      {
        description: `Write ${path} verbatim with the supplied full content. Call only when the user has directed an edit.`,
        inputSchema: { content: z.string() },
      },
      ({ content }) =>
        runTool(async () => {
          const { commit_sha } = await commitFiles(gh, [{ path, content }], `update ${path}`);
          return { file: path, commit_sha };
        }),
    );
  }

  server.registerTool(
    "commit_changes",
    {
      description:
        "Persist a batch of repo updates as ONE commit (no cart). Use at the end of a session to keep the git log clean instead of calling the granular tools repeatedly.",
      inputSchema: {
        recipe_updates: z
          .array(z.object({ slug: z.string(), updates: z.record(z.string(), z.unknown()) }))
          .optional(),
        pantry_operations: z
          .array(
            z.object({
              op: z.enum(["add", "remove", "verify"]),
              item: z.record(z.string(), z.unknown()).optional(),
              name: z.string().optional(),
            }),
          )
          .optional(),
        pantry_verified: z.array(z.string()).optional(),
        ready_to_eat_drafts: z
          .array(
            z.object({
              meal: z.enum(MEALS),
              name: z.string(),
              category: z.string().optional(),
              source: z.string().optional(),
              brand: z.string().optional(),
              notes: z.string().optional(),
            }),
          )
          .optional(),
        ready_to_eat_updates: z
          .array(z.object({ name: z.string(), updates: z.record(z.string(), z.unknown()) }))
          .optional(),
        config_updates: z
          .array(z.object({ file: z.enum(["preferences", "taste", "diet_principles", "substitutions", "aliases"]), content: z.string() }))
          .optional(),
        commit_message: z.string(),
      },
    },
    (payload) =>
      runTool(async () => {
        const files: TreeFile[] = [];
        const summary: Record<string, unknown> = {};

        for (const r of payload.recipe_updates ?? []) {
          files.push(await buildRecipeUpdate(gh, r.slug, r.updates));
        }
        if (summary && (payload.recipe_updates?.length ?? 0) > 0) {
          summary.recipes = payload.recipe_updates!.map((r) => r.slug);
        }

        if ((payload.pantry_operations?.length ?? 0) > 0 || (payload.pantry_verified?.length ?? 0) > 0) {
          const { file, applied, conflicts } = await buildPantryUpdate(
            gh,
            payload.pantry_operations ?? [],
            payload.pantry_verified ?? [],
          );
          if (file) files.push(file);
          summary.pantry = { applied, conflicts };
        }

        if ((payload.ready_to_eat_drafts?.length ?? 0) > 0 || (payload.ready_to_eat_updates?.length ?? 0) > 0) {
          const mgr = readyToEatManager(gh);
          for (const d of payload.ready_to_eat_drafts ?? []) await mgr.addDraft(d.meal, d);
          for (const u of payload.ready_to_eat_updates ?? []) await mgr.update(u.name, u.updates);
          files.push(...mgr.files());
          summary.ready_to_eat = {
            drafts: (payload.ready_to_eat_drafts ?? []).map((d) => d.name),
            updated: (payload.ready_to_eat_updates ?? []).map((u) => u.name),
          };
        }

        for (const c of payload.config_updates ?? []) {
          files.push({ path: CURATED_FILES[c.file], content: c.content });
        }
        if ((payload.config_updates?.length ?? 0) > 0) {
          summary.config = payload.config_updates!.map((c) => c.file);
        }

        const { commit_sha } = await commitFiles(gh, files, payload.commit_message);
        return { commit_sha, summary };
      }),
  );
}
