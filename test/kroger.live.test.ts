// Live, read-only smoke test against the real Kroger public API (tasks 9.1/9.2,
// Kroger-data layer). SKIPPED by default — it only runs with KROGER_LIVE=1 and
// real creds, so the normal suite and CI never hit the network. Run with:
//   KROGER_LIVE=1 npx vitest run test/kroger.live.test.ts
// Creds are read from .dev.vars (KROGER_CLIENT_ID / KROGER_CLIENT_SECRET).

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { createKrogerClient, type KrogerClient } from "../src/kroger.js";
import { matchIngredient, isFulfillable, type MatchDeps } from "../src/matching.js";
import type { Env } from "../src/env.js";

const LIVE = process.env.KROGER_LIVE === "1";
const ZIP = process.env.KROGER_ZIP ?? "76104";

function loadDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const m = line.match(/^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    // .dev.vars absent — the test is skipped anyway.
  }
  return out;
}

describe.skipIf(!LIVE)("Kroger live smoke (read-only)", () => {
  let kroger: KrogerClient;
  let locationId: string;

  beforeAll(() => {
    const vars = loadDevVars();
    const env = {
      KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID ?? vars.KROGER_CLIENT_ID,
      KROGER_CLIENT_SECRET: process.env.KROGER_CLIENT_SECRET ?? vars.KROGER_CLIENT_SECRET,
    } as unknown as Env;
    kroger = createKrogerClient(env, { cache: { token: null } });
  });

  it("mints a token and resolves a locationId from a ZIP label", async () => {
    locationId = await kroger.resolveLocationId(`Kroger - ${ZIP}`);
    console.log(`resolved locationId for ${ZIP}: ${locationId}`);
    expect(locationId).toBeTruthy();
  });

  it("searches a term and returns priced, fulfillment-tagged candidates", async () => {
    const candidates = await kroger.search("extra virgin olive oil", { locationId, limit: 5 });
    console.log(
      "olive oil candidates:\n" +
        candidates
          .map(
            (c) =>
              `  ${c.brand || "(no brand)"} | ${c.size ?? "?"} | reg $${c.price.regular} promo $${c.price.promo} | curbside=${c.fulfillment.curbside} delivery=${c.fulfillment.delivery}`,
          )
          .join("\n"),
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toHaveProperty("productId");
    expect(candidates[0].price).toHaveProperty("regular");
  });

  it("runs the matcher with no brand preference → confident or ambiguous (9.1)", async () => {
    const deps: MatchDeps = {
      search: (term) => kroger.search(term, { locationId, limit: 15 }),
      productById: (id) => kroger.productById(id, locationId),
      aliases: {},
      brands: {},
      cache: [],
    };
    const res = await matchIngredient(deps, "extra virgin olive oil");
    console.log("match result:", JSON.stringify(res, null, 2));
    // No cache + absent brand key → ambiguous; or unavailable if nothing fulfillable.
    expect(res.resolved === false).toBe(true);
  });

  it("synthesizes a flyer-style promo scan over a broad term (9.2)", async () => {
    const candidates = await kroger.search("chicken", { locationId, limit: 20 });
    const onSale = candidates.filter((c) => c.price.promo > 0 && isFulfillable(c));
    console.log(
      `chicken: ${candidates.length} candidates, ${onSale.length} on sale (promo>0 & fulfillable)`,
    );
    onSale.slice(0, 5).forEach((c) =>
      console.log(`  SALE ${c.brand} ${c.size ?? ""} reg $${c.price.regular} -> $${c.price.promo}`),
    );
    // Not asserting a sale exists (depends on the week) — just that the scan runs and prices parse.
    expect(Array.isArray(candidates)).toBe(true);
  });
});
