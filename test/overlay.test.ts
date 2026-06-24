import { describe, it, expect } from "vitest";
import {
  mergeOverlay,
  applyOverlayEdit,
  DEFAULT_STATUS,
  type OverlayRow,
} from "../src/overlay.js";

describe("mergeOverlay", () => {
  const content = { slug: "x", title: "X", protein: "beef" };

  it("prefers overlay rating/status; defaults absent status to draft", () => {
    const merged = mergeOverlay(content, { rating: 5, status: "active" }, undefined);
    expect(merged.status).toBe("active");
    expect(merged.rating).toBe(5);
    expect(merged.last_cooked).toBeNull();
    expect(merged.title).toBe("X"); // objective content preserved
  });

  it("defaults status to draft when there is no overlay row and no frontmatter status", () => {
    expect(mergeOverlay(content, undefined, undefined).status).toBe(DEFAULT_STATUS);
  });

  it("falls back to frontmatter status/rating during the transition (pre-migration index)", () => {
    const legacy = { slug: "x", title: "X", status: "archived", rating: 3, last_cooked: "2026-01-01" };
    const merged = mergeOverlay(legacy, undefined, undefined);
    expect(merged.status).toBe("archived");
    expect(merged.rating).toBe(3);
    expect(merged.last_cooked).toBe("2026-01-01");
  });

  it("derives last_cooked from the cooking log, overriding any frontmatter value", () => {
    const legacy = { slug: "x", title: "X", last_cooked: "2026-01-01" };
    expect(mergeOverlay(legacy, undefined, "2026-05-09").last_cooked).toBe("2026-05-09");
  });

  it("does not mutate the shared frontmatter", () => {
    const fm = { slug: "x", title: "X" };
    mergeOverlay(fm, { status: "active" }, "2026-05-09");
    expect(fm).toEqual({ slug: "x", title: "X" });
  });
});

describe("applyOverlayEdit", () => {
  it("sets rating/status on a fresh row (no prior row)", () => {
    expect(applyOverlayEdit(undefined, { rating: 4, status: "active" })).toEqual({
      rating: 4,
      status: "active",
    });
  });

  it("merges onto an existing row without disturbing the other field", () => {
    const before: OverlayRow = { rating: 4, status: "active" };
    expect(applyOverlayEdit(before, { status: "rejected" })).toEqual({
      rating: 4,
      status: "rejected",
    });
  });

  it("clears a field when given null, and returns null for an emptied row", () => {
    expect(applyOverlayEdit({ status: "active" }, { status: null })).toBeNull();
  });

  it("does not mutate the input row", () => {
    const before: OverlayRow = { status: "active" };
    applyOverlayEdit(before, { rating: 5 });
    expect(before).toEqual({ status: "active" });
  });
});
