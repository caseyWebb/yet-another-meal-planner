// The store registry is the D1 `stores` table now (d1-shared-corpus). stores.ts keeps
// the pure operation/shape logic (applyStoreOperations, toListing, slug guard); the row
// read/write is corpus-db. These tests cover both against the fake D1.

import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import { toListing, applyStoreOperations, assertStoreSlug, type Store, type StoreOperation } from "../src/stores.js";
import { insertStore, readStoreRow, listStoreRows, upsertStore, deleteStore } from "../src/corpus-db.js";

function store(over: Partial<Store> = {}): Store {
  return { slug: "west-7th-tom-thumb", name: "Tom Thumb", label: "West 7th", domain: "grocery", ...over };
}

describe("toListing", () => {
  it("returns identity and carries the label", () => {
    expect(toListing(store())).toEqual({
      slug: "west-7th-tom-thumb",
      name: "Tom Thumb",
      label: "West 7th",
      domain: "grocery",
    });
  });
  it("omits an absent label", () => {
    expect("label" in toListing(store({ label: undefined }))).toBe(false);
  });
});

describe("assertStoreSlug", () => {
  it("accepts kebab-case and rejects path traversal", () => {
    expect(() => assertStoreSlug("west-7th-tom-thumb")).not.toThrow();
    expect(() => assertStoreSlug("../secrets")).toThrow();
  });
});

describe("applyStoreOperations (identity only)", () => {
  it("set_identity edits a field and reports it applied", () => {
    const ops: StoreOperation[] = [{ op: "set_identity", field: "domain", value: "home-improvement" }];
    const { store: next, applied, conflicts } = applyStoreOperations(store(), ops);
    expect(conflicts).toEqual([]);
    expect(applied).toEqual([{ op: "set_identity", target: "domain" }]);
    expect(next.domain).toBe("home-improvement");
  });

  it("set_identity sets location_id", () => {
    const { store: next, applied } = applyStoreOperations(store(), [
      { op: "set_identity", field: "location_id", value: "70100156" },
    ]);
    expect(applied).toEqual([{ op: "set_identity", target: "location_id" }]);
    expect(next.location_id).toBe("70100156");
  });

  it("rejects an empty name as a conflict, not a write", () => {
    const { applied, conflicts } = applyStoreOperations(store(), [
      { op: "set_identity", field: "name", value: "  " },
    ]);
    expect(applied).toEqual([]);
    expect(conflicts[0].reason).toMatch(/name must not be empty/);
  });

  it("does not mutate the input store", () => {
    const s = store();
    applyStoreOperations(s, [{ op: "set_identity", field: "name", value: "Changed" }]);
    expect(s.name).toBe("Tom Thumb");
  });
});

describe("store registry (D1) round-trip", () => {
  it("insert → read (identity + extra), list sorted by slug", async () => {
    const { env } = fakeD1({ tables: { stores: [] } });
    await insertStore(env, store({ slug: "s", name: "S", label: "L", chain: "Albertsons", address: "123", location_id: "70100156" }));
    await insertStore(env, store({ slug: "central-market", name: "Central Market", label: undefined }));

    const s = await readStoreRow(env, "s");
    expect(s).toEqual({ slug: "s", name: "S", label: "L", chain: "Albertsons", address: "123", domain: "grocery", location_id: "70100156" });

    const list = await listStoreRows(env);
    expect(list.map((x) => x.slug)).toEqual(["central-market", "s"]);
  });

  it("defaults domain to grocery; unknown slug → null", async () => {
    const { env } = fakeD1({ tables: { stores: [{ slug: "s", name: "S", domain: null, extra: null }] } });
    expect(await readStoreRow(env, "s")).toEqual({ slug: "s", name: "S", domain: "grocery" });
    expect(await readStoreRow(env, "nope")).toBeNull();
  });

  it("upsert applies an identity edit; delete removes the row", async () => {
    const { env } = fakeD1({ tables: { stores: [] } });
    await insertStore(env, store({ slug: "s", name: "Tom Thumb" }));
    const cur = (await readStoreRow(env, "s"))!;
    const { store: next } = applyStoreOperations(cur, [{ op: "set_identity", field: "name", value: "TT2" }]);
    await upsertStore(env, next);
    expect((await readStoreRow(env, "s"))!.name).toBe("TT2");

    expect(await deleteStore(env, "s")).toBe(true);
    expect(await readStoreRow(env, "s")).toBeNull();
    expect(await deleteStore(env, "s")).toBe(false);
  });
});
