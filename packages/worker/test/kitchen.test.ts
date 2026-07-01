import { describe, it, expect } from "vitest";
import { applyKitchenOperations, toInventory, isEquipmentSlug, EQUIPMENT_VOCAB } from "../src/kitchen.js";

describe("toInventory", () => {
  it("normalizes a parsed kitchen.toml", () => {
    expect(toInventory({ owned: ["blender"], notes: { ovens: 2 } })).toEqual({
      owned: ["blender"],
      notes: { ovens: 2 },
    });
  });

  it("defaults missing/garbled regions to empty", () => {
    expect(toInventory({})).toEqual({ owned: [], notes: {} });
    // non-string owned entries are dropped; non-table notes ignored.
    expect(toInventory({ owned: ["blender", 3], notes: ["x"] })).toEqual({
      owned: ["blender"],
      notes: {},
    });
  });
});

describe("isEquipmentSlug", () => {
  it("recognizes vocab slugs only", () => {
    expect(EQUIPMENT_VOCAB).toContain("blender");
    expect(isEquipmentSlug("blender")).toBe(true);
    expect(isEquipmentSlug("air-fryer")).toBe(false);
    expect(isEquipmentSlug(42)).toBe(false);
  });
});

describe("applyKitchenOperations", () => {
  const empty = { owned: [] as string[], notes: {} as Record<string, unknown> };

  it("adds a vocab slug and reports it applied", () => {
    const r = applyKitchenOperations(empty, [{ op: "add", slug: "pressure-cooker" }]);
    expect(r.inventory.owned).toEqual(["pressure-cooker"]);
    expect(r.applied).toEqual([{ op: "add", target: "pressure-cooker" }]);
    expect(r.conflicts).toEqual([]);
  });

  it("rejects an off-vocabulary add as a conflict, never a silent write", () => {
    const r = applyKitchenOperations(empty, [{ op: "add", slug: "air-fryer" }]);
    expect(r.inventory.owned).toEqual([]);
    expect(r.applied).toEqual([]);
    expect(r.conflicts[0]).toMatchObject({ op: "add", target: "air-fryer" });
  });

  it("is idempotent on a re-add (no duplicate, no conflict)", () => {
    const r = applyKitchenOperations({ owned: ["blender"], notes: {} }, [{ op: "add", slug: "blender" }]);
    expect(r.inventory.owned).toEqual(["blender"]);
    expect(r.applied).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it("removes an owned slug, conflicts on an absent one", () => {
    const r = applyKitchenOperations({ owned: ["blender"], notes: {} }, [
      { op: "remove", slug: "blender" },
      { op: "remove", slug: "ice-cream-maker" },
    ]);
    expect(r.inventory.owned).toEqual([]);
    expect(r.applied).toEqual([{ op: "remove", target: "blender" }]);
    expect(r.conflicts[0]).toMatchObject({ op: "remove", target: "ice-cream-maker", reason: "not in owned" });
  });

  it("sets a freeform note (never touches owned, never gates)", () => {
    const r = applyKitchenOperations(empty, [{ op: "set_note", key: "ovens", value: 2 }]);
    expect(r.inventory.notes).toEqual({ ovens: 2 });
    expect(r.inventory.owned).toEqual([]);
    expect(r.applied).toEqual([{ op: "set_note", target: "ovens" }]);
  });

  it("keeps owned sorted for deterministic output", () => {
    const r = applyKitchenOperations(empty, [
      { op: "add", slug: "pressure-cooker" },
      { op: "add", slug: "blender" },
    ]);
    expect(r.inventory.owned).toEqual(["blender", "pressure-cooker"]);
  });
});
