import { describe, it, expect } from "vitest";
import { createR2CorpusStore, readCorpusFile } from "../src/corpus-store.js";
import { ToolError } from "../src/errors.js";
import { fakeR2 } from "./fake-r2.js";

describe("createR2CorpusStore", () => {
  it("getFile returns an object's text, and null (not a throw) when absent", async () => {
    const { bucket } = fakeR2({ "recipes/thai-curry.md": "---\ntitle: Thai Curry\n---\nbody" });
    const store = createR2CorpusStore(bucket);
    expect(await store.getFile("recipes/thai-curry.md")).toBe("---\ntitle: Thai Curry\n---\nbody");
    expect(await store.getFile("recipes/missing.md")).toBeNull();
  });

  it("listDir returns the immediate children (files and subdirs), [] when absent", async () => {
    const { bucket } = fakeR2({
      "guidance/purchasing/olive-oil.md": "a",
      "guidance/purchasing/canned-tomatoes.md": "b",
      "guidance/cooking_techniques/searing.md": "c",
    });
    const store = createR2CorpusStore(bucket);

    const purchasing = await store.listDir("guidance/purchasing");
    expect(purchasing.map((e) => e.name).sort()).toEqual(["canned-tomatoes.md", "olive-oil.md"]);
    expect(purchasing.every((e) => e.type === "file")).toBe(true);

    // Root of the guidance tree lists the domain subdirs (one level, via the "/" delimiter).
    const domains = await store.listDir("guidance");
    expect(domains).toEqual(
      expect.arrayContaining([
        { name: "purchasing", type: "dir" },
        { name: "cooking_techniques", type: "dir" },
      ]),
    );

    expect(await store.listDir("guidance/nonexistent")).toEqual([]);
  });

  it("put writes a single object readable back by getFile; delete removes it", async () => {
    const { bucket, objects } = fakeR2();
    const store = createR2CorpusStore(bucket);
    await store.put("recipes/new.md", "content");
    expect(objects.get("recipes/new.md")).toBe("content");
    expect(await store.getFile("recipes/new.md")).toBe("content");
    await store.delete("recipes/new.md");
    expect(await store.getFile("recipes/new.md")).toBeNull();
  });

  it("readCorpusFile maps an absent object to the given not-found ToolError code", async () => {
    const { bucket } = fakeR2();
    const store = createR2CorpusStore(bucket);
    await expect(
      readCorpusFile(store, "recipes/missing.md", "not_found", "Unknown recipe slug: missing"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("a store-level R2 failure surfaces as a structured upstream_unavailable ToolError", async () => {
    const bucket = {
      get: async () => {
        throw new Error("boom");
      },
    } as unknown as R2Bucket;
    const store = createR2CorpusStore(bucket);
    await expect(store.getFile("recipes/x.md")).rejects.toBeInstanceOf(ToolError);
    await expect(store.getFile("recipes/x.md")).rejects.toMatchObject({ code: "upstream_unavailable" });
  });
});
