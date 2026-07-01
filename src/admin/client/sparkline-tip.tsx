// Sparkline hover-tooltip: a progressive-enhancement script (NOT a hono/jsx/dom island — no
// hydration, no per-page props) that finds every SSR-rendered sparkline segment carrying
// `data-tip-title`/`data-tip-body` (emitted by `ui/kit.tsx`'s `SparklineTrack`) and shows one
// shared, fixed-positioned `.bar-tip` bubble on mouseenter, following the pointer, hiding on
// mouseleave. Mirrors the mock's `useTip()` but driven by plain DOM listeners instead of React
// state, since Status/Usage are pure-SSR pages with no other island — this keeps them at zero
// hydration cost while still getting the hover detail. Loaded on every admin page (see
// `ui/layout.tsx`), so it is a no-op (finds zero segments) on pages with no sparkline.
//
// This file is intentionally NOT `render()`-based hono/jsx/dom — `client/tsconfig.json`'s DOM
// lib + browser target still apply (it compiles as a normal browser script), but there is no JSX
// here, so the esbuild bundle stays tiny.

const SELECTOR = "[data-tip-title], [data-tip-body]";

function ensureTipEl(): HTMLDivElement {
  let el = document.getElementById("spark-bar-tip") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "spark-bar-tip";
    el.className = "bar-tip";
    el.setAttribute("role", "tooltip");
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function show(target: HTMLElement, tip: HTMLDivElement): void {
  const title = target.dataset.tipTitle;
  const body = target.dataset.tipBody;
  const variant = target.dataset.tipVariant;
  tip.className = variant ? `bar-tip ${variant}` : "bar-tip";
  tip.replaceChildren();
  if (title) {
    const t = document.createElement("div");
    t.className = "bar-tip-title";
    t.textContent = title;
    tip.appendChild(t);
  }
  if (body) {
    const b = document.createElement("div");
    b.className = "bar-tip-body";
    b.textContent = body;
    tip.appendChild(b);
  }
  const r = target.getBoundingClientRect();
  const x = Math.max(96, Math.min(window.innerWidth - 96, r.left + r.width / 2));
  tip.style.left = `${x}px`;
  tip.style.top = `${r.top}px`;
  tip.hidden = false;
}

function hide(tip: HTMLDivElement): void {
  tip.hidden = true;
}

function wire(): void {
  const tip = ensureTipEl();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
    if (el.dataset.tipWired) continue;
    el.dataset.tipWired = "1";
    el.addEventListener("mouseenter", () => show(el, tip));
    el.addEventListener("mouseleave", () => hide(tip));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
