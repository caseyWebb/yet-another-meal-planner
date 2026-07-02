import { describe, it, expect } from "vitest";
import {
  parseTaskEnvelope,
  parseClaimRequest,
  parseResultRequest,
  parseObservationItem,
  parseSaleScanPayload,
  SALE_SCAN_KIND,
  DEFAULT_CLAIM_MAX,
  MAX_CLAIM_TASKS,
  TASK_SCOPES,
  type TaskEnvelope,
} from "@grocery-agent/contract";

// The pull-channel WIRE contract (satellite-pull-channel). Mirrors contract-ingest.test.ts:
// the task envelope is a capability-tagged shape with NO concrete kind today, so the forward-
// compat guarantee is the point — a hypothetical new `kind` (or a new observation kind in a
// result) must not break a consumer validating today's set.

describe("parseTaskEnvelope", () => {
  it("round-trips a well-formed envelope, keeping payload opaque", () => {
    const env: TaskEnvelope = { id: "st_abc", kind: "scan", scope: "operator", payload: { locationId: "01400943", term: "eggs" } };
    const r = parseTaskEnvelope(env);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe("st_abc");
      expect(r.value.kind).toBe("scan");
      expect(r.value.scope).toBe("operator");
      expect(r.value.payload).toEqual({ locationId: "01400943", term: "eggs" });
    }
  });

  it("accepts a hypothetical NEW kind unchanged (the discriminant is an open, extensible set)", () => {
    // A later capability adds `order-fill`; a consumer of the current (empty) kind set still
    // validates the envelope and keeps the payload opaque — no breaking change.
    const r = parseTaskEnvelope({ id: "st_x", kind: "order-fill", scope: "tenant", payload: { list: ["milk"] } });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing id / blank kind / unknown scope", () => {
    expect(parseTaskEnvelope({ kind: "scan", scope: "operator", payload: {} }).ok).toBe(false);
    expect(parseTaskEnvelope({ id: "st_x", kind: "", scope: "operator", payload: {} }).ok).toBe(false);
    expect(parseTaskEnvelope({ id: "st_x", kind: "scan", scope: "district", payload: {} }).ok).toBe(false);
  });

  it("exposes exactly the two task scopes", () => {
    expect([...TASK_SCOPES]).toEqual(["operator", "tenant"]);
  });
});

describe("parseClaimRequest", () => {
  it("validates a capabilities list with an optional max", () => {
    expect(parseClaimRequest({ capabilities: ["scan"] }).ok).toBe(true);
    expect(parseClaimRequest({ capabilities: ["scan", "fill"], max: 5 }).ok).toBe(true);
    expect(parseClaimRequest({ capabilities: [] }).ok).toBe(true); // legal — matches no kind
  });

  it("rejects a non-array capabilities, a non-positive max, or a max over the cap", () => {
    expect(parseClaimRequest({ capabilities: "scan" }).ok).toBe(false);
    expect(parseClaimRequest({ capabilities: ["scan"], max: 0 }).ok).toBe(false);
    expect(parseClaimRequest({ capabilities: ["scan"], max: MAX_CLAIM_TASKS + 1 }).ok).toBe(false);
    expect(parseClaimRequest({ capabilities: [""] }).ok).toBe(false);
  });

  it("exposes a default + hard claim bound", () => {
    expect(DEFAULT_CLAIM_MAX).toBeGreaterThan(0);
    expect(MAX_CLAIM_TASKS).toBeGreaterThanOrEqual(DEFAULT_CLAIM_MAX);
  });
});

describe("parseResultRequest", () => {
  it("validates a success report carrying observations (kept RAW for per-item validation)", () => {
    const r = parseResultRequest({
      task_id: "st_abc",
      status: "done",
      observations: [{ kind: "recipe", title: "T", ingredients: ["x"], instructions: ["y"], source: "https://e.com/r" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.task_id).toBe("st_abc");
      expect(r.value.observations).toHaveLength(1);
      // The reported observations are the change-1 union — each validates individually.
      expect(parseObservationItem(r.value.observations![0]).ok).toBe(true);
    }
  });

  it("validates a failure report with a reason and no observations", () => {
    const r = parseResultRequest({ task_id: "st_abc", status: "failed", reason: "store session expired" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason).toBe("store session expired");
  });

  it("accepts any task_id string in the envelope (unknown-id resolution is the endpoint's not_found)", () => {
    expect(parseResultRequest({ task_id: "does-not-exist", status: "done" }).ok).toBe(true);
    // Blank task_id / unknown status are rejected structurally.
    expect(parseResultRequest({ task_id: "", status: "done" }).ok).toBe(false);
    expect(parseResultRequest({ task_id: "st_x", status: "cancelled" }).ok).toBe(false);
  });

  it("a structurally-incomplete observation rides through the envelope (raw) and is rejected only per-item", () => {
    // The result envelope keeps observations opaque, so a malformed item does not sink the report
    // parse; the per-item validator is where it is individually rejected. (`sale` is a defined kind
    // now, but this item is missing its required raw facts, so it still fails per-item.)
    const r = parseResultRequest({ task_id: "st_x", status: "done", observations: [{ kind: "sale", regular: 4.99, promo: 3.49 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(parseObservationItem(r.value.observations![0]).ok).toBe(false);
  });
});

describe("parseSaleScanPayload (the first concrete task payload)", () => {
  it("exposes the sale-scan kind constant", () => {
    expect(SALE_SCAN_KIND).toBe("sale-scan");
  });

  it("round-trips a well-formed sale-scan payload", () => {
    const r = parseSaleScanPayload({ store: "target", locationId: "T-1234", terms: ["milk", "eggs"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.store).toBe("target");
      expect(r.value.locationId).toBe("T-1234");
      expect(r.value.terms).toEqual(["milk", "eggs"]);
    }
  });

  it("accepts an empty terms list (the satellite scans nothing and reports an empty set)", () => {
    expect(parseSaleScanPayload({ store: "target", locationId: "T-1", terms: [] }).ok).toBe(true);
  });

  it("rejects a payload missing store/locationId or with a blank term", () => {
    expect(parseSaleScanPayload({ locationId: "T-1", terms: [] }).ok).toBe(false);
    expect(parseSaleScanPayload({ store: "target", terms: [] }).ok).toBe(false);
    expect(parseSaleScanPayload({ store: "target", locationId: "T-1", terms: [""] }).ok).toBe(false);
  });

  it("rides through the channel as an opaque envelope payload, interpreted only by the capability", () => {
    // The channel keeps payload opaque (parseTaskEnvelope doesn't interpret it); the capability parses it.
    const env = parseTaskEnvelope({ id: "st_1", kind: SALE_SCAN_KIND, scope: "operator", payload: { store: "target", locationId: "T-1", terms: ["milk"] } });
    expect(env.ok).toBe(true);
    if (env.ok) expect(parseSaleScanPayload(env.value.payload).ok).toBe(true);
  });
});
