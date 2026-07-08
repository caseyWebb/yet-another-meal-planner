// The admin SPA's build/dev config (admin-spa D2/D13). Builds into the admin subtree of the
// Worker's merged static-assets root (packages/worker/assets/admin/) with hashed chunk names;
// dev serves with HMR at :5174 and proxies /admin/api to the local Worker (`aubr dev:admin`
// runs both). `base: "/admin/"` because the Worker serves the bundle at /admin/* (worker-first
// dispatch — the Worker itself answers every /admin GET with this shell or these assets).
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The Worker's assets root is shared with the member app (which owns everything OUTSIDE
// admin/); this build owns exactly the admin/ subtree. Gitignored; a build artifact.
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../worker/assets/admin");

/** Clean ONLY the admin subtree (the mirror of the member app's `cleanAppOutputs`) so
 *  `build:admin` / `build:app` run in either order. `emptyOutDir` stays false — Vite must
 *  never wipe the sibling member-app outputs above this subtree. */
function cleanAdminOutputs(): Plugin {
  return {
    name: "clean-admin-outputs",
    apply: "build",
    buildStart() {
      if (!existsSync(outDir)) return;
      for (const entry of readdirSync(outDir)) {
        rmSync(path.join(outDir, entry), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  base: "/admin/",
  plugins: [cleanAdminOutputs(), tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: false,
  },
  server: {
    port: 5174,
    // HMR dev against the real Worker: the Access loopback bypass / cookies flow because
    // the proxy is same-origin from the browser's view (the member app's Decision 14).
    proxy: { "/admin/api": "http://127.0.0.1:8787" },
  },
});
