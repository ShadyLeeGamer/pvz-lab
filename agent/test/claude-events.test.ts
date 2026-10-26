// The lines `pnpm play` prints while Claude plays, checked against events trimmed from a real run's
// Claude Code output (test/fixtures/claude-events.jsonl, in the order they arrived).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeEvent } from "../src/claude-events.ts";

const events = readFileSync(new URL("./fixtures/claude-events.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

describe("describeEvent", () => {
  it("shows the start, each tool call and the first line of its answer, what Claude says, and the end", () => {
    expect(events.flatMap((event) => describeEvent(event, "pvz"))).toEqual([
      "Claude Code 2.1.310 started: model claude-opus-5-5",
      '  -> place_plant {"plant":"peashooter","col":0,"row":2}',
      "  <- Planted a peashooter at column 0, row 2.",
      "Claude: I'll loop: collect, plant when possible, wait.",
      "Claude Code finished: success, 14 turns",
    ]);
  });
});
