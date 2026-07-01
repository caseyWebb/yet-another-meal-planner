// SKIPPED by default — runs only with NORMALIZE_LIVE=1 (and CLOUDFLARE_API_TOKEN), so the
// normal suite and CI stay hermetic. It exercises the REAL capture pipeline
// (reconcileNormalization → embedTexts → confirmIdentity → buildResolution → commitResolution)
// against the REAL Workers AI models, with an in-memory D1 (fake-d1) and an env.AI shim that
// calls the Cloudflare REST API via curl (the sandbox routes curl through its egress proxy).
//
//   NORMALIZE_LIVE=1 npx vitest run test/ingredient-normalize.live.test.ts
//
// This is the §7.3 manual check: seed a base registry, enqueue a synonym / an 80/20-style
// qualifier / a distinct-base near-neighbor / a genuinely-new base, run one tick, and confirm
// the resolutions + log — then that a re-read is a hot-path hit (in the id set, no model call).

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";
import { buildNormalizeDeps, reconcileNormalization } from "../src/ingredient-normalize.js";
import { readResolver, enqueueNovelTerms } from "../src/corpus-db.js";
import { baseOf } from "../src/matching.js";

const LIVE = process.env.NORMALIZE_LIVE === "1";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "552766ebb0cb54261720167eb830466c";

/** Call a Workers AI model over the REST API through curl (proxy-configured in the sandbox). */
function aiRun(model: string, inputs: unknown): { data?: number[][]; response?: unknown } {
  const out = execFileSync(
    "curl",
    [
      "-sS",
      `https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${model}`,
      "-H",
      `Authorization: Bearer ${TOKEN}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(inputs),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const d = JSON.parse(out) as { success: boolean; result?: unknown; errors?: unknown };
  if (!d.success) throw new Error(`Workers AI error: ${JSON.stringify(d.errors)}`);
  return d.result as { data?: number[][]; response?: unknown };
}

describe.skipIf(!LIVE)("ingredient-normalize (live Workers AI)", () => {
  it("resolves a synonym / qualifier / distinct-neighbor / novel base against the real models", async () => {
    const { env: dbEnv, tables } = fakeD1({
      tables: {
        ingredient_identity: [],
        ingredient_alias: [],
        ingredient_edge: [],
        novel_ingredient_terms: [],
        ingredient_normalization_log: [],
      },
    });
    const env = { DB: (dbEnv as { DB: unknown }).DB, AI: { run: async (m: string, i: unknown) => aiRun(m, i) } } as unknown as Env;

    // Seed the registry with real embeddings for a few base nodes.
    const seeds = ["ground beef", "green onion", "baking soda", "olive oil"];
    const seedVecs = aiRun("@cf/baai/bge-base-en-v1.5", { text: seeds }).data!;
    tables.ingredient_identity.push(
      ...seeds.map((id, i) => ({
        id,
        base: id,
        detail: null,
        search_term: null,
        representative: null,
        concrete: 1,
        embedding: JSON.stringify(seedVecs[i]),
        source: "human",
      })),
    );

    // Enqueue the four probe terms.
    await enqueueNovelTerms(env, ["scallions", "80/20 ground beef", "baking powder", "gochujang"]);

    const summary = await reconcileNormalization(buildNormalizeDeps(env));
    const r = await readResolver(env);

    // eslint-disable-next-line no-console
    console.log("summary:", summary);
    // eslint-disable-next-line no-console
    console.log("resolutions:", r.toId);
    // eslint-disable-next-line no-console
    console.log(
      "log:",
      tables.ingredient_normalization_log.map((x) => ({
        term: x.term,
        outcome: x.outcome,
        resolved: x.resolved_id,
        model: x.model,
      })),
    );

    expect(summary.processed).toBe(4);
    expect(r.toId["scallions"]).toBe("green onion"); // synonym → SAME
    expect(baseOf(r.toId["80/20 ground beef"])).toBe("ground beef"); // SPECIALIZATION under ground beef
    expect(r.toId["80/20 ground beef"]).toContain("::");
    expect(r.toId["baking powder"]).toBe("baking powder"); // NOVEL — NOT merged into baking soda
    expect(r.toId["gochujang"]).toBe("gochujang"); // NOVEL — a genuinely new base

    // bge similarities are diffuse (an unrelated term still clears the low 0.5 floor), so a novel
    // base typically reaches the confirm and is correctly classified NOVEL there — the below-floor
    // no-LLM shortcut is exercised by the unit test with orthogonal vectors, not reliably here.
    const gochujangLog = tables.ingredient_normalization_log.find((x) => x.term === "gochujang");
    expect(gochujangLog?.outcome).toBe("novel");

    // Hot-path hit: every resolved term is now a known id — a re-read spends no model call.
    for (const term of ["scallions", "80/20 ground beef", "baking powder", "gochujang"]) {
      expect(r.ids.has(r.toId[term])).toBe(true);
    }
  }, 120_000);
});
