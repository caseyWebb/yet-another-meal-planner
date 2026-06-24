// Notes are D1 rows now (recipe_notes / store_notes); the privacy aggregation that
// used to live in src/notes.ts is the read query's WHERE (private=0 OR author=?). These
// tests exercise the corpus-db note functions against the fake D1: attribution + the
// own-private/group-shared privacy rule, insert, self-scoped update/remove.

import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import {
  readRecipeNotes,
  insertRecipeNote,
  updateRecipeNote,
  removeRecipeNote,
  readStoreNotes,
  insertStoreNote,
} from "../src/corpus-db.js";

describe("recipe notes (D1)", () => {
  it("inserts an attributed note and reads it back", async () => {
    const { env } = fakeD1({ tables: { recipe_notes: [] } });
    await insertRecipeNote(env, "tacos", "alice", {
      created_at: "2026-06-01T00:00:00Z",
      body: "subbed gochujang",
      tags: ["tweak"],
      private: false,
    });
    const notes = await readRecipeNotes(env, "tacos", "alice");
    expect(notes).toEqual([
      { author: "alice", created_at: "2026-06-01T00:00:00Z", body: "subbed gochujang", tags: ["tweak"], private: false },
    ]);
  });

  it("applies own-private + group-shared: a private note is owner-only", async () => {
    const { env } = fakeD1({
      tables: {
        recipe_notes: [
          { id: "alice tacos t1", recipe: "tacos", author: "alice", body: "alice shared", tags: "[]", private: 0, created_at: "2026-06-01" },
          { id: "bob tacos t2", recipe: "tacos", author: "bob", body: "bob shared", tags: "[]", private: 0, created_at: "2026-06-02" },
          { id: "bob tacos t3", recipe: "tacos", author: "bob", body: "bob secret", tags: "[]", private: 1, created_at: "2026-06-03" },
        ],
      },
    });
    // alice sees both shared notes but NOT bob's private one.
    const aliceView = await readRecipeNotes(env, "tacos", "alice");
    expect(aliceView.map((n) => n.body)).toEqual(["alice shared", "bob shared"]);
    // bob sees the shared notes plus his OWN private one.
    const bobView = await readRecipeNotes(env, "tacos", "bob");
    expect(bobView.map((n) => n.body)).toContain("bob secret");
  });

  it("orders notes by created_at (author tiebreak)", async () => {
    const { env } = fakeD1({
      tables: {
        recipe_notes: [
          { id: "b tacos 2", recipe: "tacos", author: "b", body: "second", tags: "[]", private: 0, created_at: "2026-06-02" },
          { id: "a tacos 1", recipe: "tacos", author: "a", body: "first", tags: "[]", private: 0, created_at: "2026-06-01" },
        ],
      },
    });
    expect((await readRecipeNotes(env, "tacos", "a")).map((n) => n.body)).toEqual(["first", "second"]);
  });

  it("update/remove are self-scoped: another author's note is not_found", async () => {
    const { env } = fakeD1({
      tables: {
        recipe_notes: [
          { id: "bob tacos t1", recipe: "tacos", author: "bob", body: "bob note", tags: "[]", private: 0, created_at: "2026-06-01" },
        ],
      },
    });
    // alice cannot update/remove bob's note (author scoping in the WHERE).
    expect(await updateRecipeNote(env, "tacos", "alice", "2026-06-01", { body: "hijack" })).toBe(false);
    expect(await removeRecipeNote(env, "tacos", "alice", "2026-06-01")).toBe(false);
    // bob can.
    expect(await updateRecipeNote(env, "tacos", "bob", "2026-06-01", { body: "fixed", private: true })).toBe(true);
    const [note] = await readRecipeNotes(env, "tacos", "bob");
    expect(note.body).toBe("fixed");
    expect(note.private).toBe(true);
    expect(await removeRecipeNote(env, "tacos", "bob", "2026-06-01")).toBe(true);
    expect(await readRecipeNotes(env, "tacos", "bob")).toEqual([]);
  });
});

describe("store notes (D1)", () => {
  it("attributes notes and applies the privacy rule", async () => {
    const { env } = fakeD1({ tables: { store_notes: [] } });
    await insertStoreNote(env, "west-7th", "alice", {
      created_at: "2026-06-01",
      body: "Aisle 7: baking",
      tags: ["layout"],
      private: false,
    });
    await insertStoreNote(env, "west-7th", "bob", {
      created_at: "2026-06-02",
      body: "my coupon stash",
      tags: [],
      private: true,
    });
    expect((await readStoreNotes(env, "west-7th", "alice")).map((n) => n.body)).toEqual(["Aisle 7: baking"]);
    expect((await readStoreNotes(env, "west-7th", "bob")).map((n) => n.body)).toContain("my coupon stash");
  });
});
