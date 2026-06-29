import { defineConfig } from "vitest/config";

// The core logic under test (filtering, parsing, error helpers) is pure and
// runtime-agnostic, so the default node environment is sufficient. The GitHub
// client and MCP wiring are exercised by the MCP Inspector smoke test.
export default defineConfig({
  // The admin app is hono/jsx (.tsx). Vitest 4's oxc transformer reads tsconfig's
  // `jsxImportSource: "hono/jsx"`, so the SSR pages import + render under vitest with no
  // transformer config here.
  test: {
    include: ["test/**/*.test.ts"],
  },
});
