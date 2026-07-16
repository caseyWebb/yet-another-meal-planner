import { describe, it, expect } from "vitest";
import { classifyRecipe, cleanedTitleOrFallback, DERIVED_FACET_FIELDS } from "../src/discovery-classify.js";
import { extractFacets } from "../src/recipe-classify.js";
import { ToolError } from "../src/errors.js";
import type { Env } from "../src/env.js";

/** A valid main-course facet set (passes the contract once title/source/pairs_with merge). */
const VALID_MAIN = {
  protein: "chicken",
  cuisine: "italian",
  course: ["main"],
  time_total: 30,
  ingredients_key: ["chicken", "tomato", "basil"],
  ingredients_full: ["chicken", "tomato", "basil", "garlic", "olive oil"],
  dietary: ["gluten-free"],
  season: [],
  tags: ["weeknight"],
  perishable_ingredients: ["basil"],
  requires_equipment: [],
  side_search_terms: ["a crisp green salad"],
  meal_preppable: false,
};

/** Build a fake Env whose AI.run returns the queued responses in order. */
function fakeEnv(responses: unknown[], onCall?: (msgs: unknown[]) => void): Env {
  let i = 0;
  return {
    AI: {
      run: async (_model: string, opts: { messages: unknown[] }) => {
        onCall?.(opts.messages);
        const r = responses[Math.min(i, responses.length - 1)];
        i++;
        if (r instanceof Error) throw r;
        return { response: r };
      },
    },
  } as unknown as Env;
}

describe("classifyRecipe", () => {
  it("returns contract-valid frontmatter on a good first response (object)", async () => {
    const env = fakeEnv([VALID_MAIN]); // Workers AI auto-parses JSON → object
    const { frontmatter, retries } = await classifyRecipe(
      env,
      { title: "Chicken Pomodoro", content: "Ingredients: chicken, tomato, basil." },
      "https://ex.com/x",
    );
    expect(retries).toBe(0);
    expect(frontmatter.title).toBe("Chicken Pomodoro");
    expect(frontmatter.source).toBe("https://ex.com/x");
    expect(frontmatter.pairs_with).toEqual([]);
    expect(frontmatter.protein).toBe("chicken");
    expect(frontmatter.side_search_terms).toEqual(["a crisp green salad"]);
  });

  it("parses a string (non-auto-parsed) JSON response, fences and all", async () => {
    const env = fakeEnv(["```json\n" + JSON.stringify(VALID_MAIN) + "\n```"]);
    const { frontmatter } = await classifyRecipe(env, { title: "X", content: "..." }, null);
    expect(frontmatter.protein).toBe("chicken");
    expect(frontmatter.source).toBeNull();
  });

  it("retries with a corrective reprompt on an off-vocab value, then succeeds", async () => {
    const bad = { ...VALID_MAIN, protein: "poultry" }; // off-vocab → contract error
    const seen: unknown[][] = [];
    const env = fakeEnv([bad, VALID_MAIN], (m) => seen.push(m as unknown[]));
    const { frontmatter, retries } = await classifyRecipe(env, { title: "X", content: "..." }, null);
    expect(retries).toBe(1);
    expect(frontmatter.protein).toBe("chicken");
    // The 2nd call carried a corrective user turn naming the validator complaint.
    const secondCall = seen[1] as { role: string; content: string }[];
    const corrective = secondCall[secondCall.length - 1];
    expect(corrective.role).toBe("user");
    expect(corrective.content).toMatch(/failed validation/i);
    expect(corrective.content).toMatch(/protein/);
  });

  it("requires a non-empty ingredients_full on a classify (retries the omission, then accepts)", async () => {
    // The classifier sets EVERY key, so an omitted/empty ingredients_full is caught by the
    // validated-when-present rule — the required-on-classify backstop (member-app-grocery D2).
    const bad = { ...VALID_MAIN, ingredients_full: [] };
    const seen: unknown[][] = [];
    const env = fakeEnv([bad, VALID_MAIN], (m) => seen.push(m as unknown[]));
    const { frontmatter, retries } = await classifyRecipe(env, { title: "X", content: "..." }, null);
    expect(retries).toBe(1);
    expect(frontmatter.ingredients_full).toEqual(VALID_MAIN.ingredients_full);
    const corrective = (seen[1] as { role: string; content: string }[]).at(-1)!;
    expect(corrective.content).toMatch(/ingredients_full/);
  });

  it("parks (throws validation_failed) when it never produces a compliant classification", async () => {
    const bad = { ...VALID_MAIN, course: ["main"], side_search_terms: [] }; // main w/ empty side terms
    const env = fakeEnv([bad], undefined); // same bad response every attempt
    await expect(classifyRecipe(env, { title: "X", content: "..." }, null, 1)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("maps an AI failure to a structured storage_error", async () => {
    const env = fakeEnv([new Error("AI down")]);
    await expect(classifyRecipe(env, { title: "X", content: "..." }, null)).rejects.toBeInstanceOf(ToolError);
    await expect(classifyRecipe(env, { title: "X", content: "..." }, null)).rejects.toMatchObject({
      code: "storage_error",
    });
  });

  it("retries when the model returns no JSON object at all", async () => {
    const env = fakeEnv(["sorry, I cannot do that", VALID_MAIN]);
    const { retries, frontmatter } = await classifyRecipe(env, { title: "X", content: "..." }, null);
    expect(retries).toBe(1);
    expect(frontmatter.protein).toBe("chicken");
  });

  it("swaps in the model's cleaned title when it passes the word-subset guard", async () => {
    const env = fakeEnv([{ ...VALID_MAIN, title: "Beer Can Chicken" }]);
    const { frontmatter } = await classifyRecipe(
      env,
      { title: "A Better Beer Can Chicken", content: "Ingredients: chicken, beer." },
      "https://ex.com/x",
    );
    expect(frontmatter.title).toBe("Beer Can Chicken"); // the #219 fixture, import leg
  });

  it("keeps the raw title when the model's cleaned title invents a word (guard fail-open)", async () => {
    const env = fakeEnv([{ ...VALID_MAIN, title: "Roast Chicken" }]); // "roast" not in the raw title
    const { frontmatter, retries } = await classifyRecipe(
      env,
      { title: "A Better Beer Can Chicken", content: "..." },
      null,
    );
    expect(frontmatter.title).toBe("A Better Beer Can Chicken");
    expect(retries).toBe(0); // no park, no corrective retry — title quality is fail-open
  });

  it("keeps the raw title when the model omits the title key or returns an empty one", async () => {
    for (const bad of [VALID_MAIN, { ...VALID_MAIN, title: "" }, { ...VALID_MAIN, title: 42 }]) {
      const env = fakeEnv([bad]);
      const { frontmatter } = await classifyRecipe(env, { title: "Vegan Meatballs", content: "..." }, null);
      expect(frontmatter.title).toBe("Vegan Meatballs");
    }
  });

  it("the prompt instructs the title clean and the exemplars anchor it", async () => {
    const seen: unknown[][] = [];
    const env = fakeEnv([VALID_MAIN], (m) => seen.push(m as unknown[]));
    await classifyRecipe(env, { title: "X", content: "..." }, null);
    const msgs = seen[0] as { role: string; content: string }[];
    expect(msgs[0].content).toContain("- title:");
    expect(msgs[0].content).toMatch(/only remove words/i);
    // One exemplar carries a flowery INPUT title with the clean output…
    const users = msgs.filter((m) => m.role === "user").map((m) => m.content);
    expect(users.some((u) => u.includes("The Best Grilled Asparagus with Lemon Recipe"))).toBe(true);
    const outputs = msgs
      .filter((m) => m.role === "assistant")
      .map((m) => JSON.parse(m.content) as Record<string, unknown>);
    expect(outputs.some((o) => o.title === "Grilled Asparagus with Lemon")).toBe(true);
    // …and every exemplar echoes a title (clean-in → same-out on the already-clean ones).
    expect(outputs.every((o) => typeof o.title === "string" && o.title)).toBe(true);
  });

  it("the facet-derivation consumers never read the classifier's title", () => {
    // `title` rides CLASSIFIED_FIELDS (the prompt contract) but NOT the derived-facet set —
    // the facet cron can never override an authored title through the facet path.
    expect(DERIVED_FACET_FIELDS).not.toContain("title");
    const facets = extractFacets({ ...VALID_MAIN, title: "Overwritten" }, {});
    expect("title" in facets).toBe(false);
  });

  it("the prompt names the component course and carries the pasta-dough exemplar", async () => {
    const seen: unknown[][] = [];
    const env = fakeEnv([VALID_MAIN], (m) => seen.push(m as unknown[]));
    await classifyRecipe(env, { title: "X", content: "..." }, null);
    const msgs = seen[0] as { role: string; content: string }[];
    // The system prompt's course line anchors the sub-recipe bucket…
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("component");
    expect(msgs[0].content).toMatch(/SUB-RECIPE/i);
    // …and a few-shot exemplar pins the exact convergence target: a plain pasta dough
    // -> ["component"], no protein focus, empty side terms, meal-preppable.
    const exemplars = msgs
      .filter((m) => m.role === "assistant")
      .map((m) => JSON.parse(m.content) as Record<string, unknown>);
    const dough = exemplars.find((e) => Array.isArray(e.course) && (e.course as string[]).includes("component"));
    expect(dough).toBeDefined();
    expect(dough!.protein).toBeNull();
    expect(dough!.side_search_terms).toEqual([]);
    expect(dough!.meal_preppable).toBe(true);
  });

  it("a tools_hint is surfaced in the prompt as non-authoritative (recipe-import's tool-list hint)", async () => {
    const seen: unknown[][] = [];
    const env = fakeEnv([VALID_MAIN], (m) => seen.push(m as unknown[]));
    await classifyRecipe(env, { title: "X", content: "..." }, null, 2, { tools_hint: ["stand mixer", "whisk"] });
    const msgs = seen[0] as { role: string; content: string }[];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")!;
    expect(lastUser.content).toContain("stand mixer");
    expect(lastUser.content).toContain("whisk");
    expect(lastUser.content).toMatch(/NOT authoritative/i);
  });

  it("no tools_hint means no tool-list line in the prompt", async () => {
    const seen: unknown[][] = [];
    const env = fakeEnv([VALID_MAIN], (m) => seen.push(m as unknown[]));
    await classifyRecipe(env, { title: "X", content: "..." }, null);
    const msgs = seen[0] as { role: string; content: string }[];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")!;
    expect(lastUser.content).not.toMatch(/NOT authoritative/i);
  });
});

describe("cleanedTitleOrFallback (the word-subset guard)", () => {
  it("accepts pure removal — the #219 fixture", () => {
    expect(cleanedTitleOrFallback("A Better Beer Can Chicken", "Beer Can Chicken")).toBe("Beer Can Chicken");
  });

  it("accepts removal plus re-casing (case/punctuation-insensitive comparison)", () => {
    expect(cleanedTitleOrFallback("Easy slow cooker BBQ pulled beef", "Slow Cooker BBQ Pulled Beef")).toBe(
      "Slow Cooker BBQ Pulled Beef",
    );
  });

  it("accepts an unchanged title (clean-in → same-out)", () => {
    expect(cleanedTitleOrFallback("Vegan Meatballs", "Vegan Meatballs")).toBe("Vegan Meatballs");
    expect(cleanedTitleOrFallback("Jatjuk (Pine Nut Porridge)", "Jatjuk (Pine Nut Porridge)")).toBe(
      "Jatjuk (Pine Nut Porridge)",
    );
  });

  it("rejects any inserted word — falls back to the raw title", () => {
    expect(cleanedTitleOrFallback("A Better Beer Can Chicken", "Roast Chicken")).toBe("A Better Beer Can Chicken");
    // Even a singular/plural normalization is an insertion (conservative by design).
    expect(cleanedTitleOrFallback("Vegetarian Crab Cake Recipe", "Vegetarian Crab Cakes")).toBe(
      "Vegetarian Crab Cake Recipe",
    );
  });

  it("rejects a word used MORE times than the raw title has it (multiset, not set)", () => {
    expect(cleanedTitleOrFallback("Chicken Salad", "Chicken Chicken Salad")).toBe("Chicken Salad");
  });

  it("rejects empty / whitespace / non-string values — falls back to the raw title", () => {
    expect(cleanedTitleOrFallback("Cherry Cake Recipe", "")).toBe("Cherry Cake Recipe");
    expect(cleanedTitleOrFallback("Cherry Cake Recipe", "   ")).toBe("Cherry Cake Recipe");
    expect(cleanedTitleOrFallback("Cherry Cake Recipe", undefined)).toBe("Cherry Cake Recipe");
    expect(cleanedTitleOrFallback("Cherry Cake Recipe", null)).toBe("Cherry Cake Recipe");
    expect(cleanedTitleOrFallback("Cherry Cake Recipe", 42)).toBe("Cherry Cake Recipe");
  });

  it("trims an accepted cleaned title", () => {
    expect(cleanedTitleOrFallback("Cherry Cake Recipe", "  Cherry Cake  ")).toBe("Cherry Cake");
  });
});
