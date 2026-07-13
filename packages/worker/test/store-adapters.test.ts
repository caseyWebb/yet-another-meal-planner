import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";

let preferences: Record<string, unknown> | null = null;
let stores: Record<string, unknown>[] = [];

vi.mock("../src/profile-db.js", () => ({
  readPreferences: vi.fn(async () => preferences),
}));
vi.mock("../src/corpus-db.js", () => ({
  listStoreRows: vi.fn(async () => stores),
}));
vi.mock("../src/aisle-map.js", () => ({
  readAisleMap: vi.fn(async (_env, slug: string) => ({ store_slug: slug, effective: [], mine: [], etag: '"map"', summary: { state: "unknown", aisle_count: 0, as_of: null } })),
}));

import { loadStoreAdapterProjection } from "../src/store-adapters.js";

function envWithRefresh(linked: boolean): Env {
  return {
    KROGER_KV: {
      get: async () => (linked ? "refresh-secret" : null),
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [], list_complete: true }),
    },
  } as unknown as Env;
}

describe("store adapter projection", () => {
  beforeEach(() => {
    preferences = null;
    stores = [
      { slug: "target", name: "Target", domain: "grocery", address: "1 Main St" },
      { slug: "aldi", name: "Aldi", domain: "grocery", label: "North" },
      { slug: "hardware", name: "Hardware", domain: "household" },
    ];
  });

  it("projects an exact linked Kroger location without returning secrets", async () => {
    preferences = {
      stores: {
        primary: "kroger",
        preferred_location: "01400943",
        preferred_location_name: "Kroger Marketplace",
        preferred_location_address: "123 Main St, Fort Worth, TX 76104",
        location_zip: "76104",
      },
    };
    const out = await loadStoreAdapterProjection(envWithRefresh(true), "alice");
    expect(out.adapters.kroger).toEqual({
      kind: "kroger",
      linked: true,
      preferred: {
        location_id: "01400943",
        name: "Kroger Marketplace",
        address: "123 Main St, Fort Worth, TX 76104",
        zip: "76104",
      },
    });
    expect(out.launcher[0]).toMatchObject({ id: "kroger", enabled: true, disabled_reason: null });
    expect(JSON.stringify(out)).not.toContain("refresh-secret");
  });

  it("tolerates legacy location labels and reports actionable unlinked state", async () => {
    preferences = { stores: { primary: "kroger", preferred_location: "Kroger - 76104" } };
    const out = await loadStoreAdapterProjection(envWithRefresh(false), "alice");
    expect(out.adapters.kroger.preferred).toMatchObject({
      location_id: "Kroger - 76104",
      name: "Kroger - 76104",
      address: "",
      zip: "76104",
    });
    expect(out.launcher[0]).toMatchObject({ enabled: false, disabled_reason: "connect_kroger" });
  });

  it("filters and sorts Offline stores, preserving selected and missing slugs honestly", async () => {
    preferences = { stores: { primary: "target" } };
    let out = await loadStoreAdapterProjection(envWithRefresh(false), "alice");
    expect(out.adapters.offline.stores.map((s) => s.slug)).toEqual(["aldi", "target"]);
    expect(out.adapters.offline.stores.find((s) => s.slug === "target")?.selected).toBe(true);
    expect(out.launcher).toEqual([
      expect.objectContaining({ id: "offline:target", mode: "store_walk", enabled: true }),
    ]);

    preferences = { stores: { primary: "deleted-store" } };
    out = await loadStoreAdapterProjection(envWithRefresh(false), "alice");
    expect(out.adapters.offline).toMatchObject({ selected_slug: "deleted-store", selection_unavailable: true });
    expect(out.launcher).toEqual([]);
  });

  it("degrades a configured Satellite closed and omits unconfigured Instacart", async () => {
    preferences = { stores: { primary: "target", fulfillment: "satellite" } };
    const out = await loadStoreAdapterProjection(envWithRefresh(false), "alice");
    expect(out.adapters.satellites.stores).toEqual([{ slug: "target", name: "Target", session_fresh: null }]);
    expect(out.launcher).toEqual([
      expect.objectContaining({
        id: "satellite:target",
        disabled_reason: "satellite_freshness_unavailable",
        enabled: false,
      }),
    ]);
    expect(out.launcher.some((entry) => (entry.adapter as string) === "instacart")).toBe(false);
  });

  it("projects only secret-free Instacart availability and launcher state", async () => {
    const env = envWithRefresh(false);
    env.INSTACART_API_KEY = "instacart-secret";
    env.INSTACART_API_ENV = "development";
    const out = await loadStoreAdapterProjection(env, "alice");
    expect(out.adapters.instacart).toEqual({ kind: "instacart", available: true });
    expect(out.launcher).toContainEqual(expect.objectContaining({ id: "instacart", adapter: "instacart", mode: "marketplace_handoff", enabled: true }));
    expect(JSON.stringify(out)).not.toContain("instacart-secret");
  });

  it("keeps launcher ordering deterministic", async () => {
    preferences = { stores: { primary: "target", fulfillment: "satellite", preferred_location: "01400943" } };
    const out = await loadStoreAdapterProjection(envWithRefresh(true), "alice");
    expect(out.launcher.map((entry) => entry.id)).toEqual(["kroger", "satellite:target"]);
  });
});
