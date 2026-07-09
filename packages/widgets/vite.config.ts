// The bespoke-widget build target (recipe-card-widget + meal-plan-widget). Emits ONE
// self-contained HTML document per widget — all JS + CSS inlined, ZERO external network
// requests — that the Worker serves over MCP `resources/read` as the `ui://…` template. Modeled
// on the proven proof build: react() + tailwindcss() + viteSingleFile(). Being in-repo under
// packages/*, aube resolves a SINGLE React, so no `resolve.dedupe` hack is needed.
//
// ONE WIDGET PER INVOCATION: viteSingleFile makes Rolldown inline everything by setting
// `output.codeSplitting = false`, which Rolldown REJECTS with multiple inputs — so each widget is
// built in its own single-input pass, selected by `WIDGET`. The `build`/`test` scripts run this
// config once per widget (the first pass cleans the subtree; later passes keep it via `WIDGET_KEEP`).
//
// Output lands in the Worker's ONE merged, gitignored static-assets root
// (packages/worker/assets/), under the `widgets/` subtree — the same root build:app and
// build:admin write to. `outDir` IS that subtree (assets/widgets/), so an `emptyOutDir` clean is
// scoped to it and never disturbs the app shell or the admin bundle.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// The Worker's merged assets root; the widget owns the `widgets/` subtree of it.
const outDir = path.resolve(here, "../worker/assets/widgets");

// The widget this pass builds (its `<name>.html` entry emits as `assets/widgets/<name>.html`, the
// exact basename the Worker's ASSETS read expects). Defaults to the recipe card.
const widget = process.env.WIDGET ?? "recipe-card";

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    target: "esnext",
    cssCodeSplit: false,
    outDir,
    // The FIRST widget's pass cleans the subtree (scoped to assets/widgets/, never the app/admin
    // outputs in the shared root); later passes set WIDGET_KEEP=1 to preserve earlier widgets.
    emptyOutDir: process.env.WIDGET_KEEP !== "1",
    rollupOptions: {
      // A named entry (not index.html) so the emitted file keeps the widget's basename.
      input: path.resolve(here, `${widget}.html`),
    },
  },
});
