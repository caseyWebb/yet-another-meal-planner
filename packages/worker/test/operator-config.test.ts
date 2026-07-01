import { describe, it, expect } from "vitest";
import {
  validateOperatorConfig,
  loadOperatorConfig,
  DEFAULT_OPERATOR_CONFIG,
  FLOOR_FLYER_REFRESH_HOURS,
  FLOOR_FLYER_BATCH_UNITS,
} from "../src/operator-config.js";
import type { Env } from "../src/env.js";
import { handleAdmin } from "./admin-request.js";

// --- Range checks (unaffected by the confirm/floor gate) --------------------

describe("validateOperatorConfig (range checks)", () => {
  it("accepts an in-range patch", () => {
    expect(validateOperatorConfig({ favoriteWeight: 0.5, overlapCap: 3, flyerRefreshHours: 24 })).toBeNull();
  });

  it("rejects an out-of-range ranking weight", () => {
    const err = validateOperatorConfig({ favoriteWeight: 2.5 });
    expect(err).not.toBeNull();
    expect(err?.code).toBe("validation_failed");
  });

  it("rejects a non-integer overlapCap", () => {
    expect(validateOperatorConfig({ overlapCap: 1.5 })).not.toBeNull();
  });

  it("rejects an out-of-range minFlyerDiscount", () => {
    expect(validateOperatorConfig({ minFlyerDiscount: 1.5 })).not.toBeNull();
  });

  it("rejects an out-of-range flyerRefreshHours (range, not floor)", () => {
    expect(validateOperatorConfig({ flyerRefreshHours: 1000 })).not.toBeNull();
  });

  it("range checks are enforced even with confirm:true", () => {
    expect(validateOperatorConfig({ favoriteWeight: 2.5 }, { confirm: true })).not.toBeNull();
    expect(validateOperatorConfig({ overlapCap: -5 }, { confirm: true })).not.toBeNull();
  });
});

// --- Floor/confirm gate — flyerRefreshHours / flyerBatchUnits only ----------

describe("validateOperatorConfig (floor/confirm gate)", () => {
  it("rejects a below-floor flyerRefreshHours without confirm", () => {
    const err = validateOperatorConfig({ flyerRefreshHours: FLOOR_FLYER_REFRESH_HOURS });
    expect(err).not.toBeNull();
    expect(err?.code).toBe("validation_failed");
    expect(err?.context.needsConfirm).toBe(true);
    expect(err?.context.floor).toBe(FLOOR_FLYER_REFRESH_HOURS);
    expect(err?.context.field).toBe("flyerRefreshHours");
  });

  it("accepts a below-floor flyerRefreshHours with confirm:true", () => {
    expect(validateOperatorConfig({ flyerRefreshHours: FLOOR_FLYER_REFRESH_HOURS }, { confirm: true })).toBeNull();
    expect(validateOperatorConfig({ flyerRefreshHours: 1 }, { confirm: true })).toBeNull();
  });

  it("rejects a below-floor flyerBatchUnits without confirm", () => {
    const err = validateOperatorConfig({ flyerBatchUnits: FLOOR_FLYER_BATCH_UNITS });
    expect(err).not.toBeNull();
    expect(err?.context.needsConfirm).toBe(true);
    expect(err?.context.floor).toBe(FLOOR_FLYER_BATCH_UNITS);
    expect(err?.context.field).toBe("flyerBatchUnits");
  });

  it("accepts a below-floor flyerBatchUnits with confirm:true", () => {
    expect(validateOperatorConfig({ flyerBatchUnits: FLOOR_FLYER_BATCH_UNITS }, { confirm: true })).toBeNull();
    expect(validateOperatorConfig({ flyerBatchUnits: 1 }, { confirm: true })).toBeNull();
  });

  it("a value strictly above both floors never needs confirm", () => {
    expect(validateOperatorConfig({ flyerRefreshHours: FLOOR_FLYER_REFRESH_HOURS + 1, flyerBatchUnits: FLOOR_FLYER_BATCH_UNITS + 1 })).toBeNull();
  });

  it("an in-range write unaffected by the new floors behaves exactly as before (no confirm needed)", () => {
    expect(validateOperatorConfig({ favoriteWeight: 0.3, perishWeight: 2, keyWeight: 5, overlapCap: 4, minFlyerDiscount: 0.1 })).toBeNull();
  });
});

// --- The five ranking weight knobs get NO floor — 0 is legitimate -----------

describe("validateOperatorConfig (ranking knobs never trigger confirm)", () => {
  it("accepts 0 for every ranking weight knob with no confirm flag", () => {
    expect(
      validateOperatorConfig({
        favoriteWeight: 0,
        noveltyBoost: 0,
        pantryWeight: 0,
        perishWeight: 0,
        keyWeight: 0,
      }),
    ).toBeNull();
  });

  it("accepts overlapCap and minFlyerDiscount at their permissive low end with no confirm flag", () => {
    expect(validateOperatorConfig({ overlapCap: 1, minFlyerDiscount: 0 })).toBeNull();
  });
});

// --- loadOperatorConfig: a saved below-floor value isn't retroactively rejected ---

function makeOperatorConfigD1(row: Record<string, number | null> | null): Env["DB"] {
  return {
    prepare: (sql: string) => {
      const stmt = {
        bind: (..._args: unknown[]) => stmt,
        async first<T>() {
          if (/FROM operator_config/.test(sql)) return (row ?? null) as T | null;
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[], success: true as const, meta: { changes: 0 } };
        },
        async run() {
          return { success: true as const, meta: { changes: 0 } };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
    async batch() {
      return [];
    },
  } as unknown as Env["DB"];
}

describe("loadOperatorConfig (a below-floor saved value is not retroactively rejected)", () => {
  it("returns DEFAULT_OPERATOR_CONFIG when no row exists", async () => {
    const env = { DB: makeOperatorConfigD1(null) } as unknown as Env;
    expect(await loadOperatorConfig(env)).toEqual(DEFAULT_OPERATOR_CONFIG);
  });

  it("reads back a previously-saved value below the new floor unchanged — validation only runs on write", async () => {
    const env = {
      DB: makeOperatorConfigD1({
        favorite_weight: null,
        novelty_boost: null,
        pantry_weight: null,
        perish_weight: null,
        key_weight: null,
        overlap_cap: null,
        min_flyer_discount: null,
        flyer_refresh_hours: 2, // below FLOOR_FLYER_REFRESH_HOURS, saved before the floor existed
        flyer_batch_units: 1, // below FLOOR_FLYER_BATCH_UNITS
      }),
    } as unknown as Env;
    const config = await loadOperatorConfig(env);
    expect(config.flyerRefreshHours).toBe(2);
    expect(config.flyerBatchUnits).toBe(1);
  });
});

// --- PUT /admin/api/operator-config (route-level confirm wiring) ------------

/** Minimal in-memory KV (just enough for the Access gate's loopback bypass). */
function memKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

/** D1 fake that honors operator_config reads (first()) and writes (run()). */
function operatorConfigD1(): { DB: Env["DB"]; getStored: () => Record<string, number | null> } {
  let stored: Record<string, number | null> = {
    favorite_weight: null,
    novelty_boost: null,
    pantry_weight: null,
    perish_weight: null,
    key_weight: null,
    overlap_cap: null,
    min_flyer_discount: null,
    flyer_refresh_hours: null,
    flyer_batch_units: null,
  };
  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async first<T>() {
        if (/FROM operator_config/.test(sql)) {
          if (Object.values(stored).every((v) => v === null)) return null as T | null;
          return { ...stored } as T | null;
        }
        return null as T | null;
      },
      async all<T>() {
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        if (/INSERT INTO operator_config/.test(sql)) {
          stored = {
            favorite_weight: (binds[0] as number | null) ?? null,
            novelty_boost: (binds[1] as number | null) ?? null,
            pantry_weight: (binds[2] as number | null) ?? null,
            perish_weight: (binds[3] as number | null) ?? null,
            key_weight: (binds[4] as number | null) ?? null,
            overlap_cap: (binds[5] as number | null) ?? null,
            min_flyer_discount: (binds[6] as number | null) ?? null,
            flyer_refresh_hours: (binds[7] as number | null) ?? null,
            flyer_batch_units: (binds[8] as number | null) ?? null,
          };
        }
        return { success: true as const, meta: { changes: 1 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as Env["DB"];
  return { DB, getStored: () => ({ ...stored }) };
}

function devEnv(DB: Env["DB"]): Env {
  return { TENANT_KV: memKv(), KROGER_KV: memKv(), DB, ADMIN_DEV_BYPASS: "1" } as unknown as Env;
}

describe("PUT /admin/api/operator-config", () => {
  it("accepts a valid patch and returns the merged config", async () => {
    const { DB } = operatorConfigD1();
    const env = devEnv(DB);
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", { method: "PUT", body: JSON.stringify({ favoriteWeight: 0.3 }) }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: typeof DEFAULT_OPERATOR_CONFIG };
    expect(body.config.favoriteWeight).toBe(0.3);
    expect(body.config.flyerRefreshHours).toBe(DEFAULT_OPERATOR_CONFIG.flyerRefreshHours);
  });

  it("rejects a below-floor flyerRefreshHours without confirm (400, needsConfirm)", async () => {
    const { DB } = operatorConfigD1();
    const env = devEnv(DB);
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", {
        method: "PUT",
        body: JSON.stringify({ flyerRefreshHours: FLOOR_FLYER_REFRESH_HOURS }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; needsConfirm?: boolean; floor?: number };
    expect(body.error).toBe("validation_failed");
    expect(body.needsConfirm).toBe(true);
    expect(body.floor).toBe(FLOOR_FLYER_REFRESH_HOURS);
  });

  it("accepts a below-floor flyerRefreshHours WITH confirm:true", async () => {
    const { DB } = operatorConfigD1();
    const env = devEnv(DB);
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", {
        method: "PUT",
        body: JSON.stringify({ flyerRefreshHours: FLOOR_FLYER_REFRESH_HOURS, confirm: true }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: typeof DEFAULT_OPERATOR_CONFIG };
    expect(body.config.flyerRefreshHours).toBe(FLOOR_FLYER_REFRESH_HOURS);
  });

  it("rejects a below-floor flyerBatchUnits without confirm, accepts it with confirm:true", async () => {
    const { DB } = operatorConfigD1();
    const env = devEnv(DB);
    const rejected = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", {
        method: "PUT",
        body: JSON.stringify({ flyerBatchUnits: FLOOR_FLYER_BATCH_UNITS }),
      }),
      env,
    );
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { needsConfirm?: boolean }).needsConfirm).toBe(true);

    const accepted = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", {
        method: "PUT",
        body: JSON.stringify({ flyerBatchUnits: FLOOR_FLYER_BATCH_UNITS, confirm: true }),
      }),
      env,
    );
    expect(accepted.status).toBe(200);
  });

  it("never needs confirm for a ranking weight knob, even at 0", async () => {
    const { DB } = operatorConfigD1();
    const env = devEnv(DB);
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", {
        method: "PUT",
        body: JSON.stringify({ favoriteWeight: 0, noveltyBoost: 0, pantryWeight: 0, perishWeight: 0, keyWeight: 0 }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: typeof DEFAULT_OPERATOR_CONFIG };
    expect(body.config.favoriteWeight).toBe(0);
    expect(body.config.keyWeight).toBe(0);
  });

  it("rejects an out-of-range flyerRefreshHours even with confirm:true", async () => {
    const { DB } = operatorConfigD1();
    const env = devEnv(DB);
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/operator-config", {
        method: "PUT",
        body: JSON.stringify({ flyerRefreshHours: 1000, confirm: true }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});
