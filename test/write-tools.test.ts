import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  buildCookingLogUpdate,
  buildMealPlanUpdate,
  buildOverlayUpdate,
  splitRecipeUpdate,
  readyToEatManager,
  registerWriteTools,
} from "../src/write-tools.js";
import { buildGroceryListUpdate } from "../src/grocery-tools.js";
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
    async listDir(path: string) {
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
    async getPagesUrl() {
      return { url: null, enabled: false };
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

  it("normalizes perishable_ingredients into shared content (lowercased, deduped)", async () => {
    const gh = ghWith({ "recipes/salmon.md": RECIPE }); // no aliases.toml → 404 → {} aliases
    const file = await buildRecipeUpdate(gh, "salmon", {
      perishable_ingredients: ["Cilantro", "cilantro", " Lime "],
    });
    const { frontmatter } = parseMarkdown(file.content);
    expect(frontmatter.perishable_ingredients).toEqual(["cilantro", "lime"]);
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

describe("readyToEatManager", () => {
  const PATH = "users/alice/ready_to_eat.toml";

  it("addDraft generates a slug, tags the meal, defaults to draft", async () => {
    const mgr = readyToEatManager(ghWith({}), PATH);
    const slug = await mgr.addDraft({ meal: "dinner", name: "Kroger Frozen Lasagna" });
    expect(slug).toBe("kroger-frozen-lasagna");
    const files = mgr.files();
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(PATH);
    const item = (parseToml(files[0].content).items as Record<string, unknown>[])[0];
    // null fields (rating/sku) are omitted by TOML serialization — assert the present ones.
    expect(item).toMatchObject({ name: "Kroger Frozen Lasagna", slug, meal: "dinner", status: "draft" });
    expect(typeof item.discovered_at).toBe("string"); // drafts carry a discovered_at date
  });

  it("addDraft status:active lands active with no discovered_at (onboarding path)", async () => {
    const mgr = readyToEatManager(ghWith({}), PATH);
    await mgr.addDraft({ meal: "breakfast", name: "Overnight Oats" }, "active");
    const item = (parseToml(mgr.files()[0].content).items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({ slug: "overnight-oats", status: "active" });
    expect(item.discovered_at).toBeUndefined(); // null → omitted in TOML
  });

  it("de-dupes slugs within the file with a numeric suffix", async () => {
    const existing = '[[items]]\nname = "Burrito"\nslug = "burrito"\nmeal = "lunch"\nstatus = "active"\n';
    const mgr = readyToEatManager(ghWith({ [PATH]: existing }), PATH);
    const slug = await mgr.addDraft({ meal: "lunch", name: "Burrito" });
    expect(slug).toBe("burrito-2");
  });

  it("update addresses items by slug; unknown slug is not_found", async () => {
    const existing = '[[items]]\nname = "Lasagna"\nslug = "lasagna"\nmeal = "dinner"\nstatus = "draft"\n';
    const mgr = readyToEatManager(ghWith({ [PATH]: existing }), PATH);
    await mgr.update("lasagna", { status: "active", rating: 4 });
    const item = (parseToml(mgr.files()[0].content).items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({ slug: "lasagna", status: "active", rating: 4 });
    await expect(mgr.update("ghost", { status: "rejected" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("files() is empty when nothing was touched", async () => {
    const mgr = readyToEatManager(ghWith({ [PATH]: "" }), PATH);
    expect(mgr.files()).toHaveLength(0);
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

  it("round-trips open-world sides through serialization", async () => {
    const gh = ghWith({ "meal_plan.toml": "# header\n" });
    const { file } = await buildMealPlanUpdate(gh, "meal_plan.toml", [
      { op: "add", recipe: "miso-salmon", planned_for: "2026-07-01", sides: ["roasted broccoli", "white rice"] },
    ]);
    expect(file).not.toBeNull();
    const parsed = parseToml(file!.content) as { planned: Record<string, unknown>[] };
    expect(parsed.planned[0]).toMatchObject({
      recipe: "miso-salmon",
      planned_for: "2026-07-01",
      sides: ["roasted broccoli", "white rice"],
    });
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

  it("routes pairs_with and standalone to shared content, not the overlay", () => {
    const r = splitRecipeUpdate({ pairs_with: ["steamed-rice"], standalone: true });
    expect(r.content).toEqual({ pairs_with: ["steamed-rice"], standalone: true });
    expect(r.overlayEdit).toEqual({});
  });

  it("routes perishable_ingredients to shared content, not the overlay", () => {
    const r = splitRecipeUpdate({ perishable_ingredients: ["cilantro"] });
    expect(r.content).toEqual({ perishable_ingredients: ["cilantro"] });
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

  it("inserts a new entry when the name is not already in the pantry", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", item: { name: "butter", category: "fridge", quantity: "1 lb" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "butter" }]);
    expect(res.items).toHaveLength(2);
    expect(res.items.find((i) => i.name === "butter")).toMatchObject({ quantity: "1 lb", added_at: "2026-06-09" });
  });

  it("merges into the existing entry when the name already exists, preserving added_at", () => {
    const existing: PantryItem[] = [
      { name: "milk", category: "fridge", quantity: "full", added_at: "2026-01-01", last_verified_at: "2026-06-01" },
    ];
    const res = applyPantryOperations(
      existing,
      [{ op: "add", item: { name: "milk", quantity: "low" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "milk", merged: true }]);
    expect(res.items).toHaveLength(1);
    const milk = res.items[0];
    expect(milk.quantity).toBe("low");
    expect(milk.added_at).toBe("2026-01-01");
    expect(milk.last_verified_at).toBe("2026-06-09");
  });

  it("upsert match is case-insensitive", () => {
    const existing: PantryItem[] = [
      { name: "olive oil", category: "pantry", quantity: "partial", added_at: "2026-01-01", last_verified_at: "2026-06-01" },
    ];
    const res = applyPantryOperations(
      existing,
      [{ op: "add", item: { name: "Olive Oil", quantity: "low" } }],
      "2026-06-09",
    );
    expect(res.items).toHaveLength(1);
    expect(res.applied).toEqual([{ op: "add", name: "Olive Oil", merged: true }]);
    expect(res.items[0].quantity).toBe("low");
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

describe("buildGroceryListUpdate", () => {
  const PATH = "users/alice/grocery_list.toml";

  it("applies add/update/remove in array order and reports applied", async () => {
    const gh = ghWith({ [PATH]: '[[items]]\nname = "milk"\nquantity = "1"\n' });
    const { file, applied, conflicts } = await buildGroceryListUpdate(gh, PATH, [
      { op: "add", item: { name: "eggs", quantity: "1 dozen" } },
      { op: "update", name: "milk", item: { quantity: "2" } },
      { op: "remove", name: "milk" }, // the remove sees the earlier update's list, still drops milk
    ]);
    expect(conflicts).toHaveLength(0);
    expect(applied).toHaveLength(3);
    expect(file).not.toBeNull();
    const items = parseToml(file!.content, PATH).items as Record<string, unknown>[];
    expect(items.map((i) => i.name)).toEqual(["eggs"]);
  });

  it("merges same-name adds within one batch (no duplicate); a later op sees the earlier one", async () => {
    const gh = ghWith({}); // no file → empty list
    const { file, applied } = await buildGroceryListUpdate(gh, PATH, [
      { op: "add", item: { name: "eggs", for_recipes: ["chili"] } },
      { op: "add", item: { name: "Eggs", for_recipes: ["tacos"] } }, // same normalized name
    ]);
    const items = parseToml(file!.content, PATH).items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect((items[0].for_recipes as string[]).slice().sort()).toEqual(["chili", "tacos"]);
    expect((applied[1] as { merged: boolean }).merged).toBe(true);
  });

  it("reports a missing-name remove/update as a conflict while still committing the rest", async () => {
    const gh = ghWith({ [PATH]: '[[items]]\nname = "milk"\nquantity = "1"\n' });
    const { file, applied, conflicts } = await buildGroceryListUpdate(gh, PATH, [
      { op: "remove", name: "ghost" },
      { op: "add", item: { name: "eggs" } },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ op: "remove", name: "ghost" });
    expect(file).not.toBeNull();
    expect(applied.some((a) => (a as { op: string }).op === "add")).toBe(true);
  });

  it("returns file:null when no op changed anything (only missing-name ops)", async () => {
    const gh = ghWith({ [PATH]: '[[items]]\nname = "milk"\nquantity = "1"\n' });
    const { file, applied, conflicts } = await buildGroceryListUpdate(gh, PATH, [
      { op: "remove", name: "ghost" },
    ]);
    expect(file).toBeNull();
    expect(applied).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
  });
});

describe("commit_changes grocery_list_ops integration", () => {
  // Invoke the real registered commit_changes handler through a minimal fake server,
  // capturing the createTree call to prove one commit spans all three files.
  function collectTools(gh: GitHubClient, userPrefix: string) {
    const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
    const server = {
      registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
        handlers.set(name, handler);
      },
    };
    registerWriteTools(server as unknown as Parameters<typeof registerWriteTools>[0], gh, userPrefix);
    return handlers;
  }

  it("lands grocery_list + meal_plan + pantry in a single commit (one createTree, all three files)", async () => {
    const captured: { path: string }[][] = [];
    const base = ghWith({ "users/alice/pantry.toml": "items = []\n" });
    const gh: GitHubClient = {
      ...base,
      async createTree(_baseTree: string, changes: { path: string }[]) {
        captured.push(changes);
        return "tree";
      },
    };
    const handlers = collectTools(gh, "users/alice");
    const res = await handlers.get("commit_changes")!({
      grocery_list_ops: [{ op: "add", item: { name: "eggs" } }],
      meal_plan_ops: [{ op: "add", recipe: "chili" }],
      pantry_operations: [{ op: "add", item: { name: "rice" } }],
      commit_message: "menu for the week",
    });
    expect(captured).toHaveLength(1); // exactly one commit
    expect(captured[0].map((c) => c.path).sort()).toEqual([
      "users/alice/grocery_list.toml",
      "users/alice/meal_plan.toml",
      "users/alice/pantry.toml",
    ]);
    const out = JSON.parse(res.content[0].text) as { summary: { grocery_list: { applied: unknown[] } } };
    expect(out.summary.grocery_list.applied).toHaveLength(1);
    expect(out.summary.grocery_list.applied[0]).toMatchObject({ op: "add", name: "eggs" });
  });
});
