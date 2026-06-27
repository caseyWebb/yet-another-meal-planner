import { describe, it, expect } from "vitest";
import { classifyRecipe } from "../src/discovery-classify.js";
import { ToolError } from "../src/errors.js";
import type { Env } from "../src/env.js";

/** A valid main-course facet set (passes the contract once title/source/pairs_with merge). */
const VALID_MAIN = {
  protein: "chicken",
  cuisine: "italian",
  course: ["main"],
  time_total: 30,
  ingredients_key: ["chicken", "tomato", "basil"],
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
});
