// The bespoke-widget build target (recipe-card-widget). Emits ONE self-contained HTML
// document — all JS + CSS inlined, ZERO external network requests — that the Worker serves
// over MCP `resources/read` as the `ui://recipe/card` template. Modeled on the proven proof
// build: react() + tailwindcss() + viteSingleFile(). Being in-repo under packages/*, aube
// resolves a SINGLE React, so no `resolve.dedupe` hack is needed (that was the out-of-repo
// proof's concession).
//
// Output lands in the Worker's ONE merged, gitignored static-assets root
// (packages/worker/assets/), under the `widgets/` subtree — the same root build:app and
// build:admin write to, each cleaning ONLY its own subtree. Here `outDir` IS that subtree
// (assets/widgets/) with `emptyOutDir: true`, so the clean is scoped to it and never
// disturbs the app shell or the admin bundle.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// The Worker's merged assets root; the widget owns the `widgets/` subtree of it.
const outDir = path.resolve(here, "../worker/assets/widgets");

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    target: "esnext",
    cssCodeSplit: false,
    outDir,
    // outDir IS the widget's own subtree, so emptying it cleans only `assets/widgets/`
    // and never the sibling app/admin outputs in the shared root.
    emptyOutDir: true,
    rollupOptions: {
      // A named entry (not index.html) so the emitted file is `recipe-card.html`, the
      // exact basename the Worker's ASSETS read expects (assets/widgets/recipe-card.html).
      input: path.resolve(here, "recipe-card.html"),
    },
  },
});
