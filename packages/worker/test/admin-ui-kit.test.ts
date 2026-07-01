// Unit tests for the pure helpers in src/admin/ui/kit.tsx added/changed by the
// admin-ui-fidelity-pass shared-primitives cluster: the slider-fill percent (the root-caused
// "fixed 20%" bug) and PrettyKV's array-as-chips rendering (the shared list-value pill renderer
// task, 1.4 — already implemented; this locks in the behavior other areas will rely on).

import { describe, it, expect } from "vitest";
import { sliderFillPct, PrettyKV } from "../src/admin/ui/kit.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

describe("sliderFillPct", () => {
  it("computes the percent of the range the value represents", () => {
    expect(sliderFillPct(0, 100, 50)).toBe(50);
    expect(sliderFillPct(0, 10, 0)).toBe(0);
    expect(sliderFillPct(0, 10, 10)).toBe(100);
  });

  it("scales a non-zero-based range correctly", () => {
    expect(sliderFillPct(10, 20, 15)).toBe(50);
    expect(sliderFillPct(1, 2, 1.25)).toBe(25);
  });

  it("clamps out-of-range values instead of returning a percent outside 0–100", () => {
    expect(sliderFillPct(0, 10, -5)).toBe(0);
    expect(sliderFillPct(0, 10, 50)).toBe(100);
  });

  it("returns 0 for a degenerate (non-positive-width) range rather than dividing by zero", () => {
    expect(sliderFillPct(5, 5, 5)).toBe(0);
    expect(sliderFillPct(10, 5, 7)).toBe(0);
  });
});

describe("PrettyKV array rendering", () => {
  it("renders a non-empty array field as pv-chips/pv-chip badges, not raw JSON text", () => {
    const html = render(PrettyKV({ obj: { dietary: ["vegan", "gluten-free"] } }));
    expect(html).toContain("pv-chips");
    expect(html).toContain('class="pv-chip"');
    expect(html).toContain("vegan");
    expect(html).toContain("gluten-free");
  });

  it("renders an empty array as the empty-marker, not an empty chip row", () => {
    const html = render(PrettyKV({ obj: { tags: [] } }));
    expect(html).not.toContain("pv-chips");
    expect(html).toContain("empty");
  });

  it("renders a null/undefined field as the em-dash marker", () => {
    const html = render(PrettyKV({ obj: { note: null } }));
    expect(html).toContain("pv-null");
  });
});
