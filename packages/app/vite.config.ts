// The member SPA's build/dev config (member-app-shell). Builds into the Worker's merged
// static-assets root (packages/worker/assets/) with hashed, immutable chunk names; dev
// serves with HMR and proxies /api to the local Worker (`aubr dev:app` runs both).
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The Worker's assets root — shared with the admin bundle (assets/admin/), which this
// build must never disturb. Gitignored; a build artifact on both sides.
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../worker/assets");

/** Clean ONLY the app's own outputs (everything in the assets root EXCEPT `admin/`,
 *  which is the admin builder's subtree) so build order never matters. `emptyOutDir`
 *  stays false — Vite must not wipe the sibling subtree. */
function cleanAppOutputs(): Plugin {
  return {
    name: "clean-app-outputs",
    apply: "build",
    buildStart() {
      if (!existsSync(outDir)) return;
      for (const entry of readdirSync(outDir)) {
        if (entry === "admin") continue;
        rmSync(path.join(outDir, entry), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    cleanAppOutputs(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // Prompt-to-reload posture (plan §11.3): no auto-activate under a member's feet.
      // The update-prompt UX and the offline persistence layers are P5; this scaffolds
      // the installable shell (manifest + shell precache) so P5 only adds layers.
      registerType: "prompt",
      manifest: {
        name: "Yet Another Meal Planner",
        short_name: "yamp",
        description: "The yamp member app",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#f4a259",
        // Real installability (member-app-offline): PNG 192/512 + a padded maskable
        // variant beside the SVG (committed under public/, rasterized from icon.svg).
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // EXPLICIT precache globs (member-app-offline D8): the Workbox default omits
        // images, which would leave the icons out of the offline shell. NO
        // runtimeCaching — a spec'd negative guarantee: the persisted query cache is
        // the ONLY client cache of API data; /api requests pass through the SW
        // untouched (which is exactly what lets them offline-fail in the page and
        // hand the job to the persisted-read + mutation-replay layers).
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // Precache the app shell ONLY — never the admin bundle sharing this assets root.
        globIgnores: ["admin/**"],
        // The SPA fallback must never shadow a Worker-owned path client-side either:
        // mirror wrangler.jsonc's run_worker_first enumeration (member-app-shell) —
        // pinned by tests/navigate-denylist.test.mjs against config drift. Workbox
        // matches these against pathname + search, so `?` must terminate a prefix too
        // (Cloudflare Access redirects back to /admin?__cf_access_message=... on
        // re-auth, and a cached member-shell answer would strand the operator on a
        // not-found page). `cdn-cgi` is Cloudflare's edge-owned namespace (the Access
        // login/logout/callback endpoints) — never in run_worker_first because it never
        // reaches the Worker, but it must bypass the SW for the same reason.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/(mcp|api|admin|oauth|authorize|token|register|satellite|cookbook|health|source|cdn-cgi|\.well-known)(\/|$|\.|\?)/,
        ],
      },
    }),
  ],
  build: {
    outDir,
    emptyOutDir: false,
  },
  server: {
    // HMR dev against the real Worker: cookies flow because the proxy is same-origin
    // from the browser's view (design Decision 14).
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
