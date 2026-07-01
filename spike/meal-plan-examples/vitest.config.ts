import { defineConfig } from "vitest/config";

// The root vitest config only includes `test/**/*.test.ts`, so this spike test (which lives
// under spike/, not test/) needs its own config to be discovered. Pure Node env — the modules
// under test (meal-plan-proposal, night-vibe-schedule, semantic-search, recipes,
// night-vibe-derive) are pure and runtime-agnostic, exactly like the root config assumes.
export default defineConfig({
  test: {
    include: ["spike/meal-plan-examples/examples.test.ts"],
    // Give the harness room to print full example weeks without truncation.
    testTimeout: 60_000,
  },
});
