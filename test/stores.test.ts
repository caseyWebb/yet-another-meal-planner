import { describe, it, expect } from "vitest";
import {
  toStore,
  serializeStore,
  toListing,
  applyStoreOperations,
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

function store(over: Partial<Store> = {}): Store {
  return {
    slug: "west-7th-tom-thumb",
    name: "Tom Thumb",
    label: "West 7th",
    domain: "grocery",
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
  it("round-trips identity (slug, name, label, chain, address, domain)", () => {
    const s = store({ chain: "Albertsons", address: "123 W 7th" });
    const reparsed = toStore(parseTomlRaw(serializeStore(s)) as Record<string, unknown>);
    expect(reparsed).toEqual(s);
  });

  it("defaults domain to grocery; omits absent optional identity", () => {
    const s = toStore({ slug: "s", name: "S" });
    expect(s).toEqual({ slug: "s", name: "S", domain: "grocery" });
  });

  it("round-trips location_id when present", () => {
    const s = store({ location_id: "70100156" });
    const reparsed = toStore(parseTomlRaw(serializeStore(s)) as Record<string, unknown>);
    expect(reparsed.location_id).toBe("70100156");
  });

  it("omits location_id from serialized output when absent", () => {
    const serialized = serializeStore(store());
    expect(serialized).not.toContain("location_id");
  });

  it("silently ignores legacy layout keys (aisles / item_locations / doesnt_carry)", () => {
    const s = toStore({
      slug: "s",
      name: "S",
      domain: "grocery",
      aisles: [{ number: 1, sections: ["produce"] }],
      item_locations: [{ item: "tahini", aisle: "9" }],
      doesnt_carry: ["harissa"],
    });
    expect(s).toEqual({ slug: "s", name: "S", domain: "grocery" });
  });
});

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
    const l = toListing(store({ label: undefined }));
    expect("label" in l).toBe(false);
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
    const ops: StoreOperation[] = [{ op: "set_identity", field: "location_id", value: "70100156" }];
    const { store: next, applied, conflicts } = applyStoreOperations(store(), ops);
    expect(conflicts).toEqual([]);
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

describe("listStores (gh-driven)", () => {
  it("lists stores sorted by slug (identity only), ignoring non-toml entries", async () => {
    const gh = fakeGh({
      dir: [
        { name: "west-7th-tom-thumb.toml", type: "file" },
        { name: "central-market.toml", type: "file" },
        { name: "README.md", type: "file" },
        { name: "nested", type: "dir" },
      ],
      files: {
        "stores/west-7th-tom-thumb.toml": serializeStore(store()),
        "stores/central-market.toml": serializeStore(store({ slug: "central-market", name: "Central Market", label: undefined })),
      },
    });
    const { stores } = await listStores(gh);
    expect(stores.map((s) => s.slug)).toEqual(["central-market", "west-7th-tom-thumb"]);
    expect(stores[1]).toEqual({ slug: "west-7th-tom-thumb", name: "Tom Thumb", label: "West 7th", domain: "grocery" });
    expect("has_layout" in stores[1]).toBe(false);
  });

  it("returns an empty set when the stores/ tree does not exist (404)", async () => {
    expect(await listStores(fakeGh({ dir: "404" }))).toEqual({ stores: [] });
  });
});

describe("readStore (gh-driven)", () => {
  it("reads a store's identity", async () => {
    const gh = fakeGh({ files: { "stores/west-7th-tom-thumb.toml": serializeStore(store()) } });
    expect(await readStore(gh, "west-7th-tom-thumb")).toEqual(store());
  });

  it("reads identity from a legacy file still carrying layout keys (ignored, no error)", async () => {
    const legacy =
      '# legacy\nslug = "s"\nname = "S"\ndomain = "grocery"\n\n[[aisles]]\nnumber = 1\nsections = ["produce"]\n';
    const gh = fakeGh({ files: { "stores/s.toml": legacy } });
    expect(await readStore(gh, "s")).toEqual({ slug: "s", name: "S", domain: "grocery" });
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

    // update: apply an identity op and re-commit; the read reflects it.
    const cur = await readStore(gh, "s");
    const { store: next } = applyStoreOperations(cur, [{ op: "set_identity", field: "name", value: "TT2" }]);
    await commitFiles(gh, [{ path: storePath("s"), content: serializeStore(next) }], "update");
    expect((await readStore(gh, "s")).name).toBe("TT2");

    // remove: a deletion change drops the file; the read 404s → not_found.
    await commitFiles(gh, [{ path: storePath("s"), delete: true }], "remove");
    await expect(readStore(gh, "s")).rejects.toMatchObject({ code: "not_found" });
  });
});
