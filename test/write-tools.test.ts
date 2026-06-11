import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  buildCookingLogUpdate,
  buildMealPlanUpdate,
  buildOverlayUpdate,
  splitRecipeUpdate,
} from "../src/write-tools.js";
import { parseOverlay } from "../src/overlay.js";
import { applyPantryOperations, markVerified, type PantryItem } from "../src/pantry-write.js";
import { serializeMarkdown } from "../src/serialize.js";
import { parseMarkdown, parseToml } from "../src/parse.js";
import { GitHubError, type GitHubClient } from "../src/github.js";

const RECIPE = "---\ntitle: Salmon\nstatus: active\nlast_cooked: null\nrating: null\n---\n\n## Ingredients\n- salmon\n";

function ghWith(files: Record<string, string>): GitHubClient {
  return {
    async getFile(path: string) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async getRef() {
      return "x";
    },
    async getCommitTree() {
      return "x";
    },
    async createTree() {
      return "x";
    },
    async createCommit() {
      return "x";
    },
    async updateRef() {},
    async createIssue() {
      return { url: "https://example.test/issues/1", number: 1 };
    },
  };
}

describe("buildRecipeUpdate", () => {
  it("merges updates into frontmatter and preserves the body", async () => {
    const gh = ghWith({ "recipes/salmon.md": RECIPE });
    const file = await buildRecipeUpdate(gh, "salmon", { rating: 4, last_cooked: "2026-06-09" });
    expect(file.path).toBe("recipes/salmon.md");
    const { frontmatter, body } = parseMarkdown(file.content);
    expect(frontmatter.rating).toBe(4);
    expect(frontmatter.last_cooked).toBe("2026-06-09");
    expect(frontmatter.status).toBe("active"); // untouched
    expect(body).toContain("## Ingredients");
  });

  it("rejects a malformed slug as not_found", async () => {
    const gh = ghWith({});
    await expect(buildRecipeUpdate(gh, "Not A Slug", {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a missing recipe to not_found", async () => {
    const gh = ghWith({});
    await expect(buildRecipeUpdate(gh, "ghost", {})).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("buildCookingLogUpdate", () => {
  it("appends entries (defaulting date to today) and derives last_cooked for touched recipes", async () => {
    const gh = ghWith({ "cooking_log.toml": "# header\n" });
    const { file, added, lastCooked } = await buildCookingLogUpdate(
      gh,
      "cooking_log.toml",
      [
        { type: "recipe", recipe: "salmon", date: "2026-06-09" },
        { type: "ready_to_eat", name: "lasagna" }, // date defaults to today
      ],
      "2026-06-30",
    );
    expect(file.path).toBe("cooking_log.toml");
    expect(added).toHaveLength(2);
    expect(added[1].date).toBe("2026-06-30");
    expect(lastCooked.get("salmon")).toBe("2026-06-09");
    expect(lastCooked.has("lasagna" as string)).toBe(false);
    const parsed = parseToml(file.content) as { entries: Record<string, unknown>[] };
    expect(parsed.entries).toHaveLength(2);
    expect(file.content).toContain("# header"); // header preserved
  });

  it("derives last_cooked as the max over existing + new entries", async () => {
    const existing = '[[entries]]\ndate = "2026-06-20"\ntype = "recipe"\nrecipe = "salmon"\n';
    const gh = ghWith({ "cooking_log.toml": existing });
    const { lastCooked } = await buildCookingLogUpdate(
      gh,
      "cooking_log.toml",
      [{ type: "recipe", recipe: "salmon", date: "2026-06-09" }],
      "2026-06-30",
    );
    // older new entry must not lower last_cooked below the existing max
    expect(lastCooked.get("salmon")).toBe("2026-06-20");
  });

  it("rejects an invalid entry as validation_failed", async () => {
    const gh = ghWith({ "cooking_log.toml": "" });
    await expect(
      buildCookingLogUpdate(gh, "cooking_log.toml", [{ type: "recipe", date: "2026-06-09" }], "2026-06-30"),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("buildMealPlanUpdate", () => {
  it("adds a planned row, returning a file", async () => {
    const gh = ghWith({ "meal_plan.toml": "# header\n" });
    const { file, applied } = await buildMealPlanUpdate(gh, "meal_plan.toml", [
      { op: "add", recipe: "salmon", planned_for: "2026-07-01" },
    ]);
    expect(file).not.toBeNull();
    expect(applied).toContainEqual({ op: "add", recipe: "salmon" });
    const parsed = parseToml(file!.content) as { planned: Record<string, unknown>[] };
    expect(parsed.planned[0]).toMatchObject({ recipe: "salmon", planned_for: "2026-07-01" });
  });

  it("returns no file when nothing applied (remove of a missing row)", async () => {
    const gh = ghWith({ "meal_plan.toml": "" });
    const { file, conflicts } = await buildMealPlanUpdate(gh, "meal_plan.toml", [{ op: "remove", recipe: "ghost" }]);
    expect(file).toBeNull();
    expect(conflicts).toHaveLength(1);
  });
});

describe("splitRecipeUpdate (content vs overlay routing)", () => {
  it("routes rating/status to the overlay and everything else to content", () => {
    const r = splitRecipeUpdate({ title: "X", protein: "beef", rating: 5, status: "active" });
    expect(r.content).toEqual({ title: "X", protein: "beef" });
    expect(r.overlayEdit).toEqual({ rating: 5, status: "active" });
    expect(r.hadLastCooked).toBe(false);
  });

  it("flags last_cooked and never routes it to content or overlay", () => {
    const r = splitRecipeUpdate({ title: "X", last_cooked: "2026-06-09" });
    expect(r.hadLastCooked).toBe(true);
    expect(r.content).toEqual({ title: "X" });
    expect(r.overlayEdit).toEqual({});
  });
});

describe("buildOverlayUpdate", () => {
  it("returns null when there are no edits", async () => {
    const gh = ghWith({});
    expect(await buildOverlayUpdate(gh, "users/alice/overlay.toml", new Map())).toBeNull();
  });

  it("writes the overlay at the given (user-prefixed) path, creating it when absent", async () => {
    const gh = ghWith({}); // no existing overlay
    const file = await buildOverlayUpdate(
      gh,
      "users/alice/overlay.toml",
      new Map([["salmon", { rating: 5, status: "active" }]]),
    );
    expect(file!.path).toBe("users/alice/overlay.toml");
    expect(parseOverlay(file!.content)).toEqual({ salmon: { rating: 5, status: "active" } });
  });

  it("merges onto an existing overlay without disturbing other slugs", async () => {
    const existing = '[overlay.beef-stew]\nstatus = "rejected"\n';
    const gh = ghWith({ "users/alice/overlay.toml": existing });
    const file = await buildOverlayUpdate(
      gh,
      "users/alice/overlay.toml",
      new Map([["salmon", { status: "active" }]]),
    );
    expect(parseOverlay(file!.content)).toEqual({
      "beef-stew": { status: "rejected" },
      salmon: { status: "active" },
    });
  });
});

describe("serializeMarkdown round-trip", () => {
  it("keeps a date-like string a string", () => {
    const text = serializeMarkdown({ last_cooked: "2026-06-09", status: "active" }, "body\n");
    const { frontmatter } = parseMarkdown(text);
    expect(frontmatter.last_cooked).toBe("2026-06-09");
    expect(typeof frontmatter.last_cooked).toBe("string");
  });
});

describe("applyPantryOperations", () => {
  const items: PantryItem[] = [
    { name: "milk", category: "fridge", quantity: "full", last_verified_at: "2026-06-01" },
  ];

  it("adds, removes, and verifies, reporting conflicts", () => {
    const res = applyPantryOperations(
      items,
      [
        { op: "add", item: { name: "eggs", category: "fridge", quantity: "12" } },
        { op: "remove", name: "milk" },
        { op: "remove", name: "ghee" }, // conflict
        { op: "verify", name: "eggs" },
      ],
      "2026-06-09",
    );
    const names = res.items.map((i) => i.name);
    expect(names).toContain("eggs");
    expect(names).not.toContain("milk");
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ op: "remove", name: "ghee" });
    const eggs = res.items.find((i) => i.name === "eggs")!;
    expect(eggs.last_verified_at).toBe("2026-06-09");
  });

  it("adds with a top-level name and merges item fields", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", name: "garlic", item: { category: "aromatics", note: "staple" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "garlic" }]);
    const garlic = res.items.find((i) => i.name === "garlic")!;
    expect(garlic).toMatchObject({ name: "garlic", category: "aromatics", note: "staple", added_at: "2026-06-09" });
  });

  it("conflicts only when no name is resolvable from either location", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", item: { category: "aromatics" } }],
      "2026-06-09",
    );
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts[0]).toMatchObject({ op: "add", reason: expect.stringContaining("requires a name") });
  });
});

describe("markVerified", () => {
  const items: PantryItem[] = [{ name: "milk", last_verified_at: "2026-06-01" }];

  it("resets verified items and reports missing", () => {
    const res = markVerified(items, ["milk", "ghee"], "2026-06-09");
    expect(res.items[0].last_verified_at).toBe("2026-06-09");
    expect(res.verified).toEqual(["milk"]);
    expect(res.missing).toEqual(["ghee"]);
  });
});
