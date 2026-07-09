// The single Workers AI gateway (ai-usage-attribution): per-call metering + emission. Covers the
// pure estimators, the `yamp_ai` slot layout, the token-usage extraction, and the best-effort /
// error-path guarantees — none of which need a live binding.
import { describe, it, expect, vi } from "vitest";
import { runAi, recordAiPoint, estimateNeurons, estimateTokens, modelLabel } from "../src/ai.js";
import { mapAiUsageRows } from "../src/usage.js";
import type { Env } from "../src/env.js";

const MISTRAL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const BGE = "@cf/baai/bge-base-en-v1.5";

/** A fake env whose `AI.run` returns a scripted response and whose `AI_AE.writeDataPoint` records
 *  every emitted point, so a test can assert the exact slot layout. */
function fakeEnv(run: (model: string, input: unknown) => unknown) {
  const points: { indexes: unknown[]; blobs: unknown[]; doubles: number[] }[] = [];
  const runMock = vi.fn((model: string, input: unknown) => Promise.resolve(run(model, input)));
  const env = {
    AI: { run: runMock },
    AI_AE: { writeDataPoint: vi.fn((p) => points.push(p)) },
  } as unknown as Pick<Env, "AI" | "AI_AE">;
  return { env, points, ai: runMock };
}

describe("estimateNeurons", () => {
  it("mistral text-gen: input×31876/M + output×50488/M", () => {
    expect(estimateNeurons(MISTRAL, 1_000_000, 0)).toBeCloseTo(31876, 3);
    expect(estimateNeurons(MISTRAL, 0, 1_000_000)).toBeCloseTo(50488, 3);
    expect(estimateNeurons(MISTRAL, 100, 50)).toBeCloseTo(100 / 1e6 * 31876 + 50 / 1e6 * 50488, 6);
  });
  it("bge embeddings: input×6058/M, no output rate", () => {
    expect(estimateNeurons(BGE, 1_000_000, 0)).toBeCloseTo(6058, 3);
    expect(estimateNeurons(BGE, 0, 999)).toBe(0); // embeddings produce no output tokens
  });
  it("unmapped model → 0 (the account meter stays the neuron truth)", () => {
    expect(estimateNeurons("@cf/unknown/model", 1000, 1000)).toBe(0);
  });
});

describe("estimateTokens", () => {
  it("~4 chars/token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("modelLabel", () => {
  it("maps the two model families to short labels", () => {
    expect(modelLabel(MISTRAL)).toBe("mistral-small");
    expect(modelLabel(BGE)).toBe("bge-base");
    expect(modelLabel("@cf/other/x")).toBe("@cf/other/x");
  });
});

describe("runAi emission", () => {
  it("text-gen: reads usage tokens, emits the documented slot layout", async () => {
    const { env, points } = fakeEnv(() => ({ response: "a sentence", usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    const res = await runAi<{ response?: string }>(env, { activity: "describe", trigger: "import" }, MISTRAL, { messages: [] });
    expect(res.response).toBe("a sentence");
    expect(points).toHaveLength(1);
    const p = points[0];
    expect(p.indexes).toEqual(["describe"]);
    expect(p.blobs).toEqual(["describe", "mistral-small", "import", "ok"]);
    // doubles: [duration_ms, calls, input_tokens, output_tokens, est_neurons]
    expect(p.doubles[1]).toBe(1); // calls
    expect(p.doubles[2]).toBe(100); // input tokens (from usage)
    expect(p.doubles[3]).toBe(50); // output tokens (from usage)
    expect(p.doubles[4]).toBeCloseTo(100 / 1e6 * 31876 + 50 / 1e6 * 50488, 6);
    expect(p.doubles[0]).toBeGreaterThanOrEqual(0); // duration
  });

  it("embeddings: no usage → input-length estimate, batch size as calls, trigger defaults to cron", async () => {
    const { env, points } = fakeEnv(() => ({ data: [[1], [2], [3]] }));
    await runAi(env, { activity: "embed-recipe", calls: 3, inputTokensEstimate: 40 }, BGE, { text: ["a", "b", "c"] });
    const p = points[0];
    expect(p.blobs).toEqual(["embed-recipe", "bge-base", "cron", "ok"]);
    expect(p.doubles[1]).toBe(3); // batch size
    expect(p.doubles[2]).toBe(40); // estimated input tokens
    expect(p.doubles[3]).toBe(0); // no output tokens
    expect(p.doubles[4]).toBeCloseTo(40 / 1e6 * 6058, 6);
  });

  it("error path: emits an error-outcome point with zero tokens, then rethrows", async () => {
    const { env, points } = fakeEnv(() => {
      throw new Error("neurons exhausted (4006)");
    });
    await expect(runAi(env, { activity: "classify", trigger: "cron" }, MISTRAL, {})).rejects.toThrow("4006");
    expect(points).toHaveLength(1);
    expect(points[0].blobs).toEqual(["classify", "mistral-small", "cron", "error"]);
    expect(points[0].doubles[2]).toBe(0);
    expect(points[0].doubles[3]).toBe(0);
  });

  it("best-effort: an unbound AI_AE binding is a silent no-op that still returns the result", async () => {
    const env = { AI: { run: () => Promise.resolve({ response: "x" }) } } as unknown as Pick<Env, "AI" | "AI_AE">;
    const res = await runAi<{ response?: string }>(env, { activity: "describe" }, MISTRAL, {});
    expect(res.response).toBe("x");
  });

  it("best-effort: a throwing writeDataPoint is swallowed and never affects the call", () => {
    const env = { AI_AE: { writeDataPoint: () => { throw new Error("AE down"); } } } as unknown as Pick<Env, "AI_AE">;
    expect(() =>
      recordAiPoint(env, { activity: "describe", trigger: "cron", model: MISTRAL, ok: true, durationMs: 1, calls: 1, inputTokens: 1, outputTokens: 1 }),
    ).not.toThrow();
  });
});

describe("mapAiUsageRows", () => {
  it("coerces numeric strings, orders by est_neurons desc, drops rows with no activity", () => {
    const result = mapAiUsageRows(
      [
        { activity: "embed-recipe", model: "bge-base", trigger: "cron", calls: "10", est_neurons: "1.5" },
        { activity: "classify", model: "mistral-small", trigger: "cron", calls: 3, input_tokens: 2100, est_neurons: 42 },
        { activity: "", model: "x", est_neurons: 999 }, // dropped: no activity
      ],
      1000,
      30,
    );
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.activities.map((a) => a.activity)).toEqual(["classify", "embed-recipe"]);
    expect(result.activities[0].est_neurons).toBe(42);
    expect(result.activities[0].calls).toBe(3);
    expect(result.activities[1].calls).toBe(10); // coerced from "10"
    expect(result.window_days).toBe(30);
  });
});
