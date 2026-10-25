import { defineConfig } from "vitest/config";

// End-to-end tests: they launch the real game, so they run one file at a time with long timeouts.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
