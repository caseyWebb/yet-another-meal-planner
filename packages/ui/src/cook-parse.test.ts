// The cook-mode body parser (recipe-card-cook-mode, D32). Asserts the annotation grammar — steps,
// titles, timers (both the `@Ns` hint and detected "N minutes"), ingredient groups, and `{id}`
// token interpolation — plus absent-safety on a plain, un-annotated body.
import { describe, expect, it } from "vitest";
import {
  cookKeyMap,
  detectDuration,
  interpolateIngredientRefs,
  parseCookBody,
  stripCookTokens,
} from "./cook-parse";

const BODY = [
  "## Ingredients",
  "",
  "- 4 salmon fillets (6 oz each)",
  "- 1 lb green beans, trimmed",
  "- 1 tbsp dijon mustard",
  "",
  "## Instructions",
  "",
  "1. **Preheat oven:** Heat oven to 425°F and line a sheet pan.",
  "2. **Season the beans:** Toss the {green_beans} with oil, salt, and pepper.",
  "3. **Roast:** Roast until the salmon flakes and the beans are *just* tender. @780s",
  "4. **Simmer:** Reduce the glaze for 12 minutes until syrupy.",
].join("\n");

describe("parseCookBody", () => {
  const cook = parseCookBody(BODY);

  it("parses ingredient lines with stable ids and text", () => {
    expect(cook.ingredients.map((i) => i.text)).toEqual([
      "4 salmon fillets (6 oz each)",
      "1 lb green beans, trimmed",
      "1 tbsp dijon mustard",
    ]);
    // The green-beans line slugs to a token id the step's `{green_beans}` can resolve.
    expect(cook.ingredients.some((i) => i.id === "green_beans")).toBe(true);
    expect(new Set(cook.ingredients.map((i) => i.id)).size).toBe(cook.ingredients.length); // ids unique
  });

  it("parses steps with titles, content, and timers", () => {
    expect(cook.steps).toHaveLength(4);
    expect(cook.steps[0]).toMatchObject({ title: "Preheat oven", timer_seconds: null });
    expect(cook.steps[0].content).toBe("Heat oven to 425°F and line a sheet pan.");
    // The `{green_beans}` token is preserved in content for interpolation.
    expect(cook.steps[1]).toMatchObject({ title: "Season the beans" });
    expect(cook.steps[1].content).toContain("{green_beans}");
  });

  it("uses the explicit @Ns hint (seconds) over a detected duration", () => {
    expect(cook.steps[2]).toMatchObject({ title: "Roast", timer_seconds: 780 });
    // The hint is stripped from the rendered content.
    expect(cook.steps[2].content).not.toContain("@780s");
    expect(cook.steps[2].content).toContain("*just*"); // emphasis preserved
  });

  it("detects a 'N minutes' duration when no hint is present", () => {
    expect(cook.steps[3]).toMatchObject({ title: "Simmer", timer_seconds: 720 });
  });

  it("tags ingredients with an authored subgroup header", () => {
    const grouped = parseCookBody(
      ["## Ingredients", "", "### For the sauce", "- 2 tbsp miso", "- 1 clove garlic", ""].join("\n"),
    );
    expect(grouped.ingredients.every((i) => i.group === "For the sauce")).toBe(true);
  });

  it("is absent-safe on a plain, un-annotated body", () => {
    const plain = parseCookBody("Just a paragraph about the dish.\n\nNo sections here.");
    expect(plain.steps).toEqual([]);
    expect(plain.ingredients).toEqual([]);
    expect(parseCookBody(null).steps).toEqual([]);
    expect(parseCookBody(undefined).ingredients).toEqual([]);
  });
});

describe("detectDuration", () => {
  it("returns seconds for a minutes phrase, low end of a range, or null", () => {
    expect(detectDuration("simmer 12 minutes")).toBe(720);
    expect(detectDuration("4–5 mins a side")).toBe(240);
    expect(detectDuration("1 min")).toBe(60);
    expect(detectDuration("stir constantly")).toBeNull();
  });
});

describe("interpolateIngredientRefs", () => {
  it("wraps a matched token in a dotted ingredient-ref span carrying the amount", () => {
    const map = cookKeyMap(parseCookBody(BODY));
    const html = interpolateIngredientRefs("Toss the {green_beans} well.", map);
    expect(html).toContain('class="ingredient-ref"');
    expect(html).toContain('data-qty="1 lb green beans, trimmed"');
    expect(html).toContain(">green beans<");
  });

  it("uses a custom surface label and renders an unmatched token as plain text", () => {
    const html = interpolateIngredientRefs("Add the {lemon|lemon juice} and {mystery}.", { lemon: "1 lemon" });
    expect(html).toContain(">lemon juice<"); // custom surface for the matched token
    expect(html).toContain("mystery"); // unmatched → plain
    expect(html).not.toContain('data-qty="undefined"');
  });

  it("escapes content first (no raw markup injection)", () => {
    const html = interpolateIngredientRefs("Whisk <b>hard</b> & *fast*.", {});
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("<em>fast</em>"); // *emphasis* still renders after escaping
  });

  it("renders **bold** and *italic* emphasis", () => {
    const html = interpolateIngredientRefs("Cook until **done** but *just* set.", {});
    expect(html).toContain("<strong>done</strong>");
    expect(html).toContain("<em>just</em>");
  });
});

describe("stripCookTokens", () => {
  it("reduces tokens to their surface label and drops the timer hint", () => {
    expect(stripCookTokens("Toss the {green_beans} for 5 mins @300s")).toBe("Toss the green beans for 5 mins");
    expect(stripCookTokens("Add the {lemon|lemon juice}")).toBe("Add the lemon juice");
  });
});
