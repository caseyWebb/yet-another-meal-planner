import { describe, it, expect } from "vitest";
import { mergeOverlay, applyOverlayEdit, type OverlayRow } from "../src/overlay.js";

describe("mergeOverlay", () => {
  const content = { slug: "x", title: "X", protein: "beef" };

  it("surfaces overlay favorite/reject; both default false with no row", () => {
    const merged = mergeOverlay(content, undefined, undefined);
    expect(merged.favorite).toBe(false);
    expect(merged.reject).toBe(false);
    expect(merged.last_cooked).toBeNull();
    expect(merged.title).toBe("X"); // objective content preserved
    expect("status" in merged).toBe(false);
  });

  it("reflects a favorited overlay row", () => {
    const merged = mergeOverlay(content, { favorite: true }, undefined);
    expect(merged.favorite).toBe(true);
    expect(merged.reject).toBe(false);
  });

  it("reflects a rejected overlay row", () => {
    const merged = mergeOverlay(content, { reject: true }, undefined);
    expect(merged.reject).toBe(true);
    expect(merged.favorite).toBe(false);
  });

  it("strips any lingering objective status/rating so no read path surfaces them", () => {
    const legacy = { slug: "x", title: "X", status: "archived", rating: 5, last_cooked: "2026-01-01" };
    const merged = mergeOverlay(legacy, undefined, undefined);
    expect("status" in merged).toBe(false);
    expect("rating" in merged).toBe(false);
    expect(merged.favorite).toBe(false);
    expect(merged.last_cooked).toBe("2026-01-01");
  });

  it("derives last_cooked from the cooking log, overriding any frontmatter value", () => {
    const legacy = { slug: "x", title: "X", last_cooked: "2026-01-01" };
    expect(mergeOverlay(legacy, undefined, "2026-05-09").last_cooked).toBe("2026-05-09");
  });

  it("does not mutate the shared frontmatter", () => {
    const fm = { slug: "x", title: "X" };
    mergeOverlay(fm, { favorite: true }, "2026-05-09");
    expect(fm).toEqual({ slug: "x", title: "X" });
  });
});

describe("applyOverlayEdit", () => {
  it("sets favorite on a fresh row (no prior row)", () => {
    expect(applyOverlayEdit(undefined, { favorite: true })).toEqual({ favorite: true });
  });

  it("sets reject on a fresh row", () => {
    expect(applyOverlayEdit(undefined, { reject: true })).toEqual({ reject: true });
  });

  it("favorite and reject are mutually exclusive: favoriting clears a reject", () => {
    expect(applyOverlayEdit({ reject: true }, { favorite: true })).toEqual({ favorite: true });
  });

  it("rejecting clears a favorite", () => {
    expect(applyOverlayEdit({ favorite: true }, { reject: true })).toEqual({ reject: true });
  });

  it("un-favoriting (favorite:false) clears the field, emptying the row to null", () => {
    expect(applyOverlayEdit({ favorite: true }, { favorite: false })).toBeNull();
  });

  it("un-rejecting (reject:false) clears the field, emptying the row to null", () => {
    expect(applyOverlayEdit({ reject: true }, { reject: false })).toBeNull();
  });

  it("does not mutate the input row", () => {
    const before: OverlayRow = { favorite: true };
    applyOverlayEdit(before, { reject: true });
    expect(before).toEqual({ favorite: true });
  });
});
