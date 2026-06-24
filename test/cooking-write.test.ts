import { describe, it, expect } from "vitest";
import { registerCookingWriteTools } from "../src/cooking-write.js";
import type { Env } from "../src/env.js";
import { fakeD1, type FakeD1 } from "./fake-d1.js";

function collect(env: Env, username: string) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerCookingWriteTools(
    server as unknown as Parameters<typeof registerCookingWriteTools>[0],
    env,
    username,
  );
  return handlers;
}

function parse(res: { content: { text: string }[] }) {
  return JSON.parse(res.content[0].text);
}

describe("log_cooked (D1, transactional meal-plan clear)", () => {
  it("inserts a recipe entry and clears it from the meal plan in ONE batch", async () => {
    const d1: FakeD1 = fakeD1({
      recipes: ["miso-salmon"],
      tables: {
        meal_plan: [
          { tenant: "everett", recipe: "miso-salmon", planned_for: null, sides: null },
          { tenant: "everett", recipe: "tacos", planned_for: null, sides: null },
        ],
      },
    });
    const handlers = collect(d1.env, "everett");

    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "miso-salmon", date: "2026-06-20" }));
    expect(out.logged).toMatchObject({ type: "recipe", recipe: "miso-salmon", date: "2026-06-20" });
    expect(out.commit_sha).toBeUndefined();

    // The INSERT and the meal_plan DELETE ran in ONE batch (transactional clear).
    expect(d1.batches).toHaveLength(1);
    const batch = d1.batches[0];
    expect(batch).toHaveLength(2);
    expect(batch[0].sql).toMatch(/INSERT INTO cooking_log/);
    expect(batch[0].binds).toEqual(["everett", "2026-06-20", "recipe", "miso-salmon", null, null, null]);
    expect(batch[1].sql).toMatch(/DELETE FROM meal_plan/);
    expect(batch[1].binds).toEqual(["everett", "miso-salmon"]);

    // The cooked recipe was removed; the other remains.
    expect(d1.tables.meal_plan.map((r) => r.recipe)).toEqual(["tacos"]);
  });

  it("defaults date to today when omitted", async () => {
    const d1 = fakeD1({ recipes: ["tacos"] });
    const handlers = collect(d1.env, "everett");
    const today = new Date().toISOString().slice(0, 10);
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "tacos" }));
    expect(out.logged.date).toBe(today);
    expect(d1.batches[0][0].binds[1]).toBe(today);
  });

  it("rejects a recipe entry whose slug does not resolve (not_found), writing nothing", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "not-a-recipe" }));
    expect(out.error).toBe("not_found");
    expect(d1.batches).toHaveLength(0);
  });

  it("inserts a ready_to_eat entry (no meal-plan delete in the batch)", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(
      await handlers.get("log_cooked")!({ type: "ready_to_eat", name: "frozen lasagna", protein: "beef", date: "2026-06-21" }),
    );
    expect(out.logged).toMatchObject({ type: "ready_to_eat", name: "frozen lasagna" });
    const batch = d1.batches[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].binds).toEqual(["everett", "2026-06-21", "ready_to_eat", null, "frozen lasagna", "beef", null]);
  });

  it("rejects a non-recipe entry with no name (validation_failed)", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "ad_hoc" }));
    expect(out.error).toBe("validation_failed");
    expect(d1.batches).toHaveLength(0);
  });

  it("rejects a bad date (validation_failed)", async () => {
    const d1 = fakeD1({ recipes: ["tacos"] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "tacos", date: "June 21" }));
    expect(out.error).toBe("validation_failed");
    expect(d1.batches).toHaveLength(0);
  });
});
