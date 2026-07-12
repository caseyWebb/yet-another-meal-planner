// @vitest-environment jsdom
// The propose widget's fake-bridge harness (shared-propose-orchestration, D18/D19). A fake
// ProposeBridge records every channel call in order. Two layers are asserted:
//   • the bridge ADAPTER (`createBridgeAdapter`): iterate is a PURE query (callServerTool only — the
//     controller owns the context push); syncContext pushes context only; commit runs the decision-6
//     write sequence and stays resilient once the durable write lands.
//   • the CONTROLLER (`useProposeController`, driven via renderHook): a request-changing edit fires
//     callServerTool AND update-model-context (with edited sides reflected) and NOT message; a sides
//     edit fires update-model-context only; an out-of-order iteration never leaves context on a
//     stale week; reset invalidates an in-flight iteration.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  createBridgeAdapter,
  localDay,
  nextOpenDates,
  packPlanCommitOps,
  resolveProposeCapabilities,
  useProposeController,
  type BridgeToolResult,
  type ProposeBridge,
  type ProposeCapabilities,
  type ProposeControllerResult,
} from "./propose-controller";
import { defaultProposeSession } from "./propose-orchestration";

// `process` exists at runtime (Node/vitest) but @yamp/ui's tsconfig carries no node types.
declare const process: { env: Record<string, string | undefined> };

// A west-of-UTC zone so the local-calendar packing (defect 1) is exercised deterministically. Set
// before any assertion constructs a Date; the commit-sequence fixtures use loose date assertions.
process.env.TZ = "America/Los_Angeles";

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeResult(mainSlug = "soup", sides = [{ title: "Rice" }]): ProposeControllerResult {
  return {
    plan: [
      {
        vibe_id: "v1",
        meal: "dinner",
        main: { slug: mainSlug, title: mainSlug, description: null, protein: "veg", cuisine: "thai", time_total: 30 },
        sides,
        flags: {},
        why: [],
        alternates: [],
        alt_similar: null,
        alt_different: null,
      },
    ],
    variety: { distinct_proteins: 1, distinct_cuisines: 1, mean_pairwise_sim: 0, max_pairwise_sim: 0 },
    uncovered_at_risk: [],
    diagnostics: { filled: 1 },
  };
}

const RESULT = makeResult();

/** A fake ext-apps bridge recording the ordered channel log. `proposeResults` can defer the
 *  `propose_meal_plan` promises so overlapping iterations can be resolved out of order. */
function makeBridge(
  opts: {
    readPlanned?: { planned_for?: string | null }[];
    failSecondRead?: boolean;
    /** The FIRST read_meal_plan RESOLVES `{isError:true}` (throw-free worker failure). */
    firstReadIsError?: boolean;
    /** update_meal_plan RESOLVES `{isError:true}` (throw-free worker failure). */
    writeIsError?: boolean;
    defer?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];
  const contexts: Record<string, unknown>[] = [];
  const messages: { text: string }[] = [];
  const pendingPropose: Array<(v: BridgeToolResult) => void> = [];
  let reads = 0;
  const bridge: ProposeBridge = {
    callServerTool(p): Promise<BridgeToolResult> {
      calls.push(`tool:${p.name}`);
      toolCalls.push(p);
      if (p.name === "propose_meal_plan") {
        if (opts.defer) return new Promise((resolve) => pendingPropose.push(resolve));
        return Promise.resolve({ structuredContent: RESULT as unknown as Record<string, unknown> });
      }
      if (p.name === "read_meal_plan") {
        reads++;
        if (opts.firstReadIsError && reads === 1) return Promise.resolve({ isError: true, content: [{ type: "text", text: "storage_error" }] });
        if (opts.failSecondRead && reads === 2) return Promise.reject(new Error("read blip"));
        return Promise.resolve({ structuredContent: { planned: opts.readPlanned ?? [] } });
      }
      if (p.name === "update_meal_plan") {
        if (opts.writeIsError) return Promise.resolve({ isError: true, content: [{ type: "text", text: "storage_error" }] });
        return Promise.resolve({ structuredContent: { applied: [], conflicts: [] } });
      }
      return Promise.resolve({});
    },
    async updateModelContext(p) {
      calls.push("context");
      contexts.push(p.structuredContent ?? {});
      return {};
    },
    async sendMessage(p) {
      calls.push("message");
      messages.push({ text: p.content.map((c) => c.text).join("") });
      return {};
    },
  };
  const resolvePropose = (i: number, result: ProposeControllerResult) =>
    pendingPropose[i]({ structuredContent: result as unknown as Record<string, unknown> });
  return { bridge, calls, toolCalls, contexts, messages, resolvePropose };
}

const WRITE_CAPS: ProposeCapabilities = {
  readOnly: false,
  canIterate: true,
  canSyncContext: true,
  commitMode: "write",
  canCommit: true,
};

describe("createBridgeAdapter — the bridge channels", () => {
  it("iterate is a PURE query: callServerTool only — no context, no message (the controller pushes context)", async () => {
    const { bridge, calls } = makeBridge();
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    const result = await adapter.iterate({ meals: { breakfast: 0, lunch: 0, dinner: 2 }, seed: 1 });
    expect(calls).toEqual(["tool:propose_meal_plan"]);
    expect(result?.plan[0].main?.slug).toBe("soup");
  });

  it("syncContext pushes context ONLY — no tool call, no message", async () => {
    const { bridge, calls } = makeBridge();
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    await adapter.syncContext!(RESULT);
    expect(calls).toEqual(["context"]);
  });

  it("commit runs the decision-6 sequence in order: read → write → read → context → message", async () => {
    const { bridge, calls, toolCalls } = makeBridge({ readPlanned: [{ planned_for: "2026-07-13" }] });
    const adapter = createBridgeAdapter(bridge, {
      capabilities: WRITE_CAPS,
      mintRowId: () => "row-1",
      today: () => new Date("2026-07-12T00:00:00Z"),
    });
    const outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: ["Rice"] }]);
    expect(outcome).toEqual({ committed: true, reset: false });
    expect(calls).toEqual(["tool:read_meal_plan", "tool:update_meal_plan", "tool:read_meal_plan", "context", "message"]);
    const upd = toolCalls.find((c) => c.name === "update_meal_plan")!;
    const ops = upd.arguments.ops as Record<string, unknown>[];
    expect(ops[0]).toMatchObject({ op: "add", id: "row-1", recipe: "soup", meal: "dinner", from_vibe: "v1", sides: ["Rice"] });
    expect(ops[0].planned_for).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ops[0].planned_for).not.toBe("2026-07-13");
  });

  it("commit stays committed when the POST-write re-read fails (durable write, best-effort tail)", async () => {
    const { bridge, calls, contexts } = makeBridge({ failSecondRead: true });
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS, mintRowId: () => "row-1" });
    let outcome: { committed: boolean } | undefined;
    await expect(
      (async () => {
        outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: [] }]);
      })(),
    ).resolves.toBeUndefined(); // must NOT reject with rows already written
    expect(outcome!.committed).toBe(true);
    // read → write → (read rejects) → context (fallback: the packed ops) → message
    expect(calls).toEqual(["tool:read_meal_plan", "tool:update_meal_plan", "tool:read_meal_plan", "context", "message"]);
    expect((contexts[0].planned as unknown[]).length).toBe(1); // the packed ops as the committed snapshot
  });

  it("commit does NOT false-succeed when update_meal_plan RESOLVES isError (worker tools are throw-free)", async () => {
    const { bridge, calls } = makeBridge({ writeIsError: true });
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS, mintRowId: () => "row-1" });
    const outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: [] }]);
    expect(outcome.committed).toBe(false);
    // read → write(isError) → STOP: no committed-context push, no provenance message.
    expect(calls).toEqual(["tool:read_meal_plan", "tool:update_meal_plan"]);
    expect(calls).not.toContain("context");
    expect(calls).not.toContain("message");
  });

  it("commit aborts before any write when the pre-write read RESOLVES isError", async () => {
    const { bridge, calls } = makeBridge({ firstReadIsError: true });
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    const outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: [] }]);
    expect(outcome.committed).toBe(false);
    expect(calls).toEqual(["tool:read_meal_plan"]);
    expect(calls).not.toContain("tool:update_meal_plan");
  });

  it("commit aborts cleanly (committed:false, nothing written) when the PRE-write read fails", async () => {
    const { bridge, calls } = makeBridge();
    // Force the FIRST read to reject.
    const orig = bridge.callServerTool;
    bridge.callServerTool = (p) => (p.name === "read_meal_plan" ? Promise.reject(new Error("blip")) : orig(p));
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    const outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: [] }]);
    expect(outcome.committed).toBe(false);
    expect(calls).not.toContain("tool:update_meal_plan"); // never wrote
  });

  it("commit degrades to a sendMessage delegation without serverTools", async () => {
    const { bridge, calls } = makeBridge();
    const adapter = createBridgeAdapter(bridge, {
      capabilities: { readOnly: true, canIterate: false, canSyncContext: false, commitMode: "delegate", canCommit: true },
    });
    const outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: [] }]);
    expect(outcome.committed).toBe(true);
    expect(calls).toEqual(["message"]);
  });

  it("commit is a no-op when neither serverTools nor message is available", async () => {
    const { bridge, calls } = makeBridge();
    const adapter = createBridgeAdapter(bridge, {
      capabilities: { readOnly: true, canIterate: false, canSyncContext: false, commitMode: "none", canCommit: false },
    });
    const outcome = await adapter.commit([{ slug: "soup", meal: "dinner", from_vibe: "v1", sides: [] }]);
    expect(outcome.committed).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("useProposeController — D18 channel discipline (defects 4 + 5)", () => {
  function mount(bridge: ProposeBridge, initialResult = makeResult()) {
    const adapter = createBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    const initialSession = defaultProposeSession(2, 1);
    return renderHook(() =>
      useProposeController({
        adapter,
        context: { vibeLabels: { v1: "Cozy" } },
        initialSession,
        initialResult,
        iterateOnMount: false,
      }),
    );
  }

  it("a request-changing edit fires callServerTool AND context (sides-applied), NOT message", async () => {
    const b = makeBridge();
    const { result } = mount(b.bridge);
    // Edit sides first (context-only), then a request change — the pushed snapshot must carry the
    // edited sides, not the op's default sides (the D4-style divergence D18 prevents).
    await act(async () => {
      result.current.editSides("v1", ["Toast"]);
      await flush();
    });
    expect(b.calls).toEqual(["context"]); // sides edit: context only
    await act(async () => {
      result.current.setMeal("dinner", 3);
      await flush();
    });
    expect(b.calls).toEqual(["context", "tool:propose_meal_plan", "context"]);
    expect(b.messages).toHaveLength(0);
    const last = b.contexts[b.contexts.length - 1];
    const plan = last.plan as { sides: { title: string }[] }[];
    expect(plan[0].sides).toEqual([{ title: "Toast" }]); // edited sides reflected in the pushed snapshot
  });

  it("a sides edit DURING an in-flight iteration is reflected in the pushed snapshot (live-ref sides, defect B)", async () => {
    const b = makeBridge({ defer: true });
    const { result } = mount(b.bridge);
    // A request change starts an iteration (deferred — no result/context yet).
    await act(async () => {
      result.current.setMeal("dinner", 3);
      await flush();
    });
    // Edit sides WHILE that iteration is in flight (does not bump seqRef — not a superseding change).
    await act(async () => {
      result.current.editSides("v1", ["Toast"]);
      await flush();
    });
    // The iteration resolves: its pushed snapshot must carry the LIVE (edited) sides, matching render
    // and commit — not the launch-time session's pre-edit sides.
    await act(async () => {
      b.resolvePropose(0, makeResult("newer"));
      await flush();
    });
    expect(result.current.result?.plan[0].main?.slug).toBe("newer");
    const last = b.contexts[b.contexts.length - 1];
    const plan = last.plan as { sides: { title: string }[] }[];
    expect(plan[0].sides).toEqual([{ title: "Toast" }]);
  });

  it("an out-of-order iteration never leaves the host model on a stale week", async () => {
    const b = makeBridge({ defer: true });
    const { result } = mount(b.bridge);
    const WEEK_A = makeResult("older");
    const WEEK_B = makeResult("newer");

    // Two overlapping iterations: seq1 then seq2.
    await act(async () => {
      result.current.setMeal("dinner", 3);
      await flush();
    });
    await act(async () => {
      result.current.setMeal("dinner", 4);
      await flush();
    });
    // Resolve the NEWER (seq2) first, then the OLDER (seq1) last.
    await act(async () => {
      b.resolvePropose(1, WEEK_B);
      await flush();
    });
    await act(async () => {
      b.resolvePropose(0, WEEK_A);
      await flush();
    });

    expect(result.current.result?.plan[0].main?.slug).toBe("newer");
    // Exactly one context push (the newer week); the stale older reply pushes nothing.
    expect(b.contexts).toHaveLength(1);
    expect((b.contexts[0].plan as { main: { slug: string } }[])[0].main.slug).toBe("newer");
  });

  it("reset invalidates an in-flight iteration (a late reply cannot repopulate a cleared session)", async () => {
    const b = makeBridge({ defer: true });
    const { result } = mount(b.bridge);
    await act(async () => {
      result.current.setMeal("dinner", 3);
      await flush();
    });
    await act(async () => {
      result.current.reset();
      await flush();
    });
    // The in-flight iteration resolves AFTER reset — its seq guard must reject it.
    await act(async () => {
      b.resolvePropose(0, makeResult("late"));
      await flush();
    });
    expect(result.current.session).toBeNull();
    expect(result.current.result).toBeNull();
    expect(b.contexts).toHaveLength(0);
  });
});

describe("resolveProposeCapabilities — the ladder + version gate", () => {
  const known = 1;
  const full = {
    knownVersion: known,
    hostServerTools: true,
    hostUpdateModelContext: true,
    hostMessage: true,
    hasPalette: true,
    roundTrippable: true,
  };

  it("a newer contract_version renders fully read-only (D19 degrade, don't crash)", () => {
    expect(resolveProposeCapabilities({ ...full, contractVersion: 2 })).toEqual({
      readOnly: true,
      canIterate: false,
      canSyncContext: false,
      commitMode: "none",
      canCommit: false,
    });
  });

  it("undefined contract_version reads as 1 and stays interactive", () => {
    const caps = resolveProposeCapabilities({ ...full, contractVersion: undefined });
    expect(caps.canIterate).toBe(true);
    expect(caps.commitMode).toBe("write");
  });

  it("full host capabilities enable iterate + context + write commit", () => {
    expect(resolveProposeCapabilities(full)).toEqual({
      readOnly: false,
      canIterate: true,
      canSyncContext: true,
      commitMode: "write",
      canCommit: true,
    });
  });

  it("no serverTools but message → read-only slots with a delegate commit", () => {
    const caps = resolveProposeCapabilities({ ...full, hostServerTools: false });
    expect(caps).toMatchObject({ readOnly: true, canIterate: false, commitMode: "delegate", canCommit: true });
  });

  it("neither serverTools nor message → no commit at all", () => {
    const caps = resolveProposeCapabilities({ ...full, hostServerTools: false, hostMessage: false });
    expect(caps.commitMode).toBe("none");
    expect(caps.canCommit).toBe(false);
  });

  it("a non-round-trippable proposal can still be committed via write, just not iterated", () => {
    const caps = resolveProposeCapabilities({ ...full, roundTrippable: false });
    expect(caps.canIterate).toBe(false);
    expect(caps.readOnly).toBe(true);
    expect(caps.commitMode).toBe("write");
  });
});

describe("nextOpenDates / packPlanCommitOps — local-calendar packing (defect 1)", () => {
  it("uses the LOCAL calendar day, not UTC — no off-by-one west of UTC in the evening", () => {
    // TZ is America/Los_Angeles: 2026-07-12T03:00:00Z is 2026-07-11 20:00 LOCAL.
    const from = new Date("2026-07-12T03:00:00Z");
    expect(localDay(from)).toBe("2026-07-11"); // local, not the UTC "2026-07-12"
    // The local tomorrow is 2026-07-12; the old toISOString path would have skipped it to 2026-07-13.
    expect(nextOpenDates([], 2, from)).toEqual(["2026-07-12", "2026-07-13"]);
  });

  it("assigns distinct open dates avoiding taken ones", () => {
    const ops = packPlanCommitOps(
      [
        { slug: "a", meal: "dinner", from_vibe: null, sides: [] },
        { slug: "b", meal: "lunch", from_vibe: "v", sides: ["x"] },
      ],
      [{ planned_for: "2026-07-13" }],
      { mintRowId: () => "id", today: new Date("2026-07-12T12:00:00Z") },
    );
    expect(ops).toHaveLength(2);
    const dates = ops.map((o) => o.planned_for);
    expect(new Set(dates).size).toBe(2);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d).not.toBe("2026-07-13");
    }
    expect(ops[1]).toMatchObject({ op: "add", recipe: "b", meal: "lunch", from_vibe: "v", sides: ["x"] });
  });
});
