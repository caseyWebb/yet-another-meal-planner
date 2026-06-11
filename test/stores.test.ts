import { describe, it, expect } from "vitest";
import {
  toStore,
  serializeStore,
  toListing,
  applyStoreOperations,
  makeNormalizer,
  listStores,
  readStore,
  storePath,
  slugFromStoreFile,
  type Store,
  type StoreOperation,
} from "../src/stores.js";
import { commitFiles } from "../src/commit.js";
import { GitHubError, type GitHubClient, type DirEntry } from "../src/github.js";
import { parse as parseTomlRaw } from "smol-toml";

const idNorm = (s: string) => s.trim().toLowerCase();

function store(over: Partial<Store> = {}): Store {
  return {
    slug: "west-7th-tom-thumb",
    name: "Tom Thumb",
    label: "West 7th",
    domain: "grocery",
    aisles: [
      { number: 1, sections: ["produce", "herbs"] },
      { label: "Back wall", sections: ["meat", "seafood"] },
    ],
    item_locations: [{ item: "tahini", aisle: "9", detail: "bottom shelf" }],
    doesnt_carry: ["harissa"],
    ...over,
  };
}

/** A read-only fake gh backed by an in-memory file map + optional dir listing. */
function fakeGh(opts: { dir?: DirEntry[] | "404"; files?: Record<string, string> }): GitHubClient {
  const files = opts.files ?? {};
  const notUsed = () => {
    throw new Error("not used");
  };
  return {
    async getFile(path) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async listDir(path) {
      if (opts.dir === undefined || opts.dir === "404") throw new GitHubError(404, `Not found: ${path}`);
      return opts.dir;
    },
    getRef: notUsed,
    getCommitTree: notUsed,
    createTree: notUsed,
    createCommit: notUsed,
    updateRef: notUsed,
    createIssue: notUsed,
    getPagesUrl: notUsed,
  };
}

/** A commit-capturing fake gh: createTree applies writes/deletions to the file map. */
function commitGh(files: Record<string, string>): GitHubClient {
  return {
    async getFile(path) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async listDir() {
      throw new GitHubError(404, "no dir");
    },
    async getRef() {
      return "base";
    },
    async getCommitTree() {
      return "tree";
    },
    async createTree(_base, changes) {
      for (const c of changes) {
        if ("delete" in c) delete files[c.path];
        else files[c.path] = c.content;
      }
      return "newtree";
    },
    async createCommit() {
      return "commit";
    },
    async updateRef() {},
    async createIssue() {
      return { url: "x", number: 1 };
    },
    async getPagesUrl() {
      return { url: null, enabled: false };
    },
  };
}

describe("slugFromStoreFile / storePath", () => {
  it("derives the slug from a .toml file and round-trips the path", () => {
    expect(slugFromStoreFile("west-7th-tom-thumb.toml")).toBe("west-7th-tom-thumb");
    expect(slugFromStoreFile("README.md")).toBeNull();
    expect(storePath("west-7th-tom-thumb")).toBe("stores/west-7th-tom-thumb.toml");
  });
});

describe("toStore / serializeStore round-trip", () => {
  it("round-trips identity, aisles, item_locations, and doesnt_carry", () => {
    const reparsed = toStore(parseTomlRaw(serializeStore(store())) as Record<string, unknown>);
    expect(reparsed).toEqual(store());
  });

  it("defaults domain to grocery and absent facets to empty", () => {
    const s = toStore({ slug: "s", name: "S" });
    expect(s.domain).toBe("grocery");
    expect(s.aisles).toEqual([]);
    expect(s.item_locations).toEqual([]);
    expect(s.doesnt_carry).toEqual([]);
  });

  it("coerces a numeric item_location aisle to a string and drops a location with no item", () => {
    const s = toStore({
      slug: "s",
      name: "S",
      item_locations: [{ item: "tahini", aisle: 9 }, { aisle: "1" }],
    });
    expect(s.item_locations).toEqual([{ item: "tahini", aisle: "9" }]);
  });
});

describe("toListing", () => {
  it("reports has_layout=true and carries the label when an aisle map exists", () => {
    expect(toListing(store())).toEqual({
      slug: "west-7th-tom-thumb",
      name: "Tom Thumb",
      label: "West 7th",
      domain: "grocery",
      has_layout: true,
    });
  });
  it("reports has_layout=false and omits an absent label", () => {
    const l = toListing(store({ aisles: [], label: undefined }));
    expect(l.has_layout).toBe(false);
    expect("label" in l).toBe(false);
  });
});

describe("applyStoreOperations", () => {
  it("lazily adds an item_location and reports it applied", () => {
    const ops: StoreOperation[] = [{ op: "add_item_location", item: "miso", aisle: "9", detail: "by tofu" }];
    const { store: next, applied, conflicts } = applyStoreOperations(store(), ops, idNorm);
    expect(conflicts).toEqual([]);
    expect(applied).toEqual([{ op: "add_item_location", target: "miso" }]);
    expect(next.item_locations).toContainEqual({ item: "miso", aisle: "9", detail: "by tofu" });
  });

  it("resolves a synonym to one item_location key via the normalizer (green onions → scallions)", () => {
    const normalize = makeNormalizer({ "green onions": "scallions" });
    const { store: next } = applyStoreOperations(
      store({ item_locations: [] }),
      [{ op: "add_item_location", item: "green onions", aisle: "1" }],
      normalize,
    );
    expect(next.item_locations).toEqual([{ item: "scallions", aisle: "1" }]);
  });

  it("re-points an existing item_location rather than duplicating it", () => {
    const { store: next } = applyStoreOperations(
      store(),
      [{ op: "add_item_location", item: "tahini", aisle: "12" }],
      idNorm,
    );
    expect(next.item_locations.filter((l) => l.item === "tahini")).toEqual([{ item: "tahini", aisle: "12" }]);
  });

  it("removing an absent item_location is a conflict, not a write", () => {
    const { applied, conflicts } = applyStoreOperations(
      store(),
      [{ op: "remove_item_location", item: "ghee" }],
      idNorm,
    );
    expect(applied).toEqual([]);
    expect(conflicts).toEqual([{ op: "remove_item_location", target: "ghee", reason: "no item_location with that item" }]);
  });

  it("adds and removes doesnt_carry; a second add is idempotent", () => {
    const r1 = applyStoreOperations(store({ doesnt_carry: [] }), [{ op: "add_doesnt_carry", item: "gochujang" }], idNorm);
    expect(r1.store.doesnt_carry).toEqual(["gochujang"]);
    const r2 = applyStoreOperations(r1.store, [{ op: "add_doesnt_carry", item: "gochujang" }], idNorm);
    expect(r2.applied).toEqual([]); // idempotent
    const r3 = applyStoreOperations(r1.store, [{ op: "remove_doesnt_carry", item: "gochujang" }], idNorm);
    expect(r3.store.doesnt_carry).toEqual([]);
  });

  it("set_identity edits a field; set_aisles replaces the whole layout", () => {
    const ops: StoreOperation[] = [
      { op: "set_identity", field: "domain", value: "home-improvement" },
      { op: "set_aisles", aisles: [{ number: 5, sections: ["lumber"] }] },
    ];
    const { store: next } = applyStoreOperations(store(), ops, idNorm);
    expect(next.domain).toBe("home-improvement");
    expect(next.aisles).toEqual([{ number: 5, sections: ["lumber"] }]);
  });

  it("rejects an empty name as a conflict", () => {
    const { applied, conflicts } = applyStoreOperations(
      store(),
      [{ op: "set_identity", field: "name", value: "  " }],
      idNorm,
    );
    expect(applied).toEqual([]);
    expect(conflicts[0].reason).toMatch(/name must not be empty/);
  });
});

describe("listStores (gh-driven)", () => {
  it("lists mapped stores sorted by slug, ignoring non-toml entries", async () => {
    const gh = fakeGh({
      dir: [
        { name: "west-7th-tom-thumb.toml", type: "file" },
        { name: "central-market.toml", type: "file" },
        { name: "README.md", type: "file" },
        { name: "nested", type: "dir" },
      ],
      files: {
        "stores/west-7th-tom-thumb.toml": serializeStore(store()),
        "stores/central-market.toml": serializeStore(store({ slug: "central-market", name: "Central Market", aisles: [], label: undefined })),
      },
    });
    const { stores } = await listStores(gh);
    expect(stores.map((s) => s.slug)).toEqual(["central-market", "west-7th-tom-thumb"]);
    expect(stores[0].has_layout).toBe(false);
    expect(stores[1].has_layout).toBe(true);
  });

  it("returns an empty set when the stores/ tree does not exist (404)", async () => {
    expect(await listStores(fakeGh({ dir: "404" }))).toEqual({ stores: [] });
  });
});

describe("readStore (gh-driven)", () => {
  it("reads a store's objective content", async () => {
    const gh = fakeGh({ files: { "stores/west-7th-tom-thumb.toml": serializeStore(store()) } });
    expect(await readStore(gh, "west-7th-tom-thumb")).toEqual(store());
  });

  it("yields a structured not_found for an unknown slug", async () => {
    await expect(readStore(fakeGh({ files: {} }), "nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a malformed slug (path traversal) without fetching", async () => {
    await expect(readStore(fakeGh({ files: {} }), "../secrets")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("store mutation round-trip (commit engine, incl. deletion)", () => {
  it("add → read, update → read, remove → not_found", async () => {
    const files: Record<string, string> = {};
    const gh = commitGh(files);

    // add: commit a serialized store, then read it back.
    await commitFiles(gh, [{ path: storePath("s"), content: serializeStore(store({ slug: "s" })) }], "add");
    expect((await readStore(gh, "s")).name).toBe("Tom Thumb");

    // update: apply an op and re-commit; the read reflects it.
    const cur = await readStore(gh, "s");
    const { store: next } = applyStoreOperations(cur, [{ op: "set_identity", field: "name", value: "TT2" }], idNorm);
    await commitFiles(gh, [{ path: storePath("s"), content: serializeStore(next) }], "update");
    expect((await readStore(gh, "s")).name).toBe("TT2");

    // remove: a deletion change drops the file; the read 404s → not_found.
    await commitFiles(gh, [{ path: storePath("s"), delete: true }], "remove");
    await expect(readStore(gh, "s")).rejects.toMatchObject({ code: "not_found" });
  });
});
