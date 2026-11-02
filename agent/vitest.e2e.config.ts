import { defineConfig } from "vitest/config";
import { loadEnv } from "./src/game-process.ts";

// PVZ_E2E_MUTE=1 in agent/.env runs the games these tests launch without sound, on SDL's silent audio
// driver. The games inherit the tests' environment, so it reaches every one of them.
loadEnv();

// End-to-end tests: they launch the real game, so they run one file at a time with long timeouts.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: process.env.PVZ_E2E_MUTE === "1" ? { SDL_AUDIODRIVER: "dummy" } : {},
  },
});
