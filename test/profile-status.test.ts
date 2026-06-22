import { describe, it, expect } from "vitest";
import { profileStatus } from "../src/profile-status.js";
import type { ProfileBundle } from "../src/user-kv.js";

const ALL_AREAS = ["store", "taste", "diet", "equipment", "pantry", "ready-to-eat", "stockup", "corpus"];

// Minimal KV fake: profileStatus only ever calls `.get(key)`.
function fakeKv(store: Record<string, string>): KVNamespace {
  return {
    get: async (key: string) => store[key] ?? null,
  } as unknown as KVNamespace;
}

function kvFrom(opts: {
  username?: string;
  bundle?: ProfileBundle;
  pantry?: unknown[];
}): KVNamespace {
  const username = opts.username ?? "alice";
  const store: Record<string, string> = {};
  if (opts.bundle) store[`profile:${username}`] = JSON.stringify(opts.bundle);
  if (opts.pantry) store[`state:${username}:pantry`] = JSON.stringify(opts.pantry);
  return fakeKv(store);
}

describe("profileStatus", () => {
  it("all profile fields + pantry present → initialized, nothing missing", async () => {
    const kv = kvFrom({
      bundle: {
        preferences: "x",
        taste: "x",
        diet_principles: "x",
        kitchen: "x",
        ready_to_eat: "x",
        stockup: "x",
        overlay: "x",
      },
      pantry: [{ name: "olive oil" }],
    });
    expect(await profileStatus(kv, "alice")).toEqual({ initialized: true, missing: [] });
  });

  it("preferences only → initialized, remaining areas missing in order", async () => {
    const kv = kvFrom({ bundle: { preferences: "x" } });
    expect(await profileStatus(kv, "alice")).toEqual({
      initialized: true,
      missing: ["taste", "diet", "equipment", "pantry", "ready-to-eat", "stockup", "corpus"],
    });
  });

  it("no profile bundle at all → not initialized, all areas missing", async () => {
    const kv = kvFrom({});
    expect(await profileStatus(kv, "alice")).toEqual({ initialized: false, missing: ALL_AREAS });
  });

  it("fields present but no preferences → not initialized, store still missing", async () => {
    const kv = kvFrom({ bundle: { taste: "x" }, pantry: [{ name: "rice" }] });
    const res = await profileStatus(kv, "alice");
    expect(res.initialized).toBe(false);
    expect(res.missing).toContain("store");
    expect(res.missing).not.toContain("taste");
    expect(res.missing).not.toContain("pantry");
  });

  it("an empty-string preferences field does not count as initialized", async () => {
    const kv = kvFrom({ bundle: { preferences: "   " } });
    expect((await profileStatus(kv, "alice")).initialized).toBe(false);
  });
});
