import { defineConfig } from "vitest/config";

// Standalone config for the controlled use-it-up scenario (the root config only includes
// test/**). Run: npx vitest run --config spike/meal-plan-examples/use-it-up.config.ts --disable-console-intercept
export default defineConfig({
  test: {
    include: ["spike/meal-plan-examples/use-it-up.test.ts"],
    testTimeout: 60_000,
  },
});
