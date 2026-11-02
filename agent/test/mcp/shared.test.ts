// What both sides' tools share.
import { describe, expect, it } from "vitest";
import { normalizeName } from "../../src/mcp/shared.ts";

describe("normalizeName", () => {
  it("accepts the ways people write plant names", () => {
    expect(normalizeName("Wall-nut")).toBe("wall_nut");
    expect(normalizeName("  cherry bomb ")).toBe("cherry_bomb");
    expect(normalizeName("snow_pea")).toBe("snow_pea");
  });
});
