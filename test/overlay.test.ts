import { describe, it, expect } from "vitest";
import {
  mergeOverlay,
  applyOverlayEdit,
  DEFAULT_STATUS,
  type OverlayRow,
} from "../src/overlay.js";

describe("mergeOverlay", () => {
  const content = { slug: "x", title: "X", protein: "beef" };

  it("prefers overlay favorite/status; defaults absent status to draft", () => {
    const merged = mergeOverlay(content, { favorite: true, status: "active" }, undefined);
    expect(merged.status).toBe("active");
    expect(merged.favorite).toBe(true);
    expect(merged.last_cooked).toBeNull();
    expect(merged.title).toBe("X"); // objective content preserved
  });

  it("defaults status to draft and favorite to false when there is no overlay row", () => {
    const merged = mergeOverlay(content, undefined, undefined);
    expect(merged.status).toBe(DEFAULT_STATUS);
    expect(merged.favorite).toBe(false);
  });

  it("falls back to frontmatter status during the transition (pre-migration index)", () => {
    const legacy = { slug: "x", title: "X", status: "archived", last_cooked: "2026-01-01" };
    const merged = mergeOverlay(legacy, undefined, undefined);
    expect(merged.status).toBe("archived");
    expect(merged.favorite).toBe(false); // favorite is overlay-only, never from frontmatter
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
  it("sets favorite/status on a fresh row (no prior row)", () => {
    expect(applyOverlayEdit(undefined, { favorite: true, status: "active" })).toEqual({
      favorite: true,
      status: "active",
    });
  });

  it("merges onto an existing row without disturbing the other field", () => {
    const before: OverlayRow = { favorite: true, status: "active" };
    expect(applyOverlayEdit(before, { status: "rejected" })).toEqual({
      favorite: true,
      status: "rejected",
    });
  });

  it("un-favoriting (favorite:false) clears the field, emptying the row to null", () => {
    expect(applyOverlayEdit({ favorite: true }, { favorite: false })).toBeNull();
  });

  it("clears status when given null, and returns null for an emptied row", () => {
    expect(applyOverlayEdit({ status: "active" }, { status: null })).toBeNull();
  });

  it("does not mutate the input row", () => {
    const before: OverlayRow = { status: "active" };
    applyOverlayEdit(before, { favorite: true });
    expect(before).toEqual({ status: "active" });
  });
});
