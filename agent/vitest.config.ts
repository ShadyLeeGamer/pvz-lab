import { defineConfig } from "vitest/config";

// Unit tests: fast, no game needed. The first ones arrive with the MCP tools (slice 3).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
  },
});
