import { defineConfig } from "vitest/config";

// Node-environment unit tests over the scraper's pure logic (config parsing, JSON-LD
// extraction, fact-stripping, the push payload builder, the dedup cursor). Adapters are
// exercised with fixture HTML/XML — never live paid sites.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
