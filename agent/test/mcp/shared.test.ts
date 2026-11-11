// What both sides' tools share.
import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitStart, Lobby, normalizeName, STILL_LIMIT_MS, waitGameTime } from "../../src/mcp/shared.ts";
import { fixture, fixtureAt } from "../fixtures/fixture.ts";

describe("normalizeName", () => {
  it("accepts the ways people write plant names", () => {
    expect(normalizeName("Wall-nut")).toBe("wall_nut");
    expect(normalizeName("  cherry bomb ")).toBe("cherry_bomb");
    expect(normalizeName("snow_pea")).toBe("snow_pea");
  });
});

describe("Lobby, a match's ready check (D62)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for every player that isn't ready and hasn't left, and wakes whoever waits once the match starts", async () => {
    const lobby = new Lobby(["plants", "zombies"]);
    expect(lobby.waitingFor()).toEqual(["plants", "zombies"]);
    lobby.markReady("zombies");
    expect(lobby.waitingFor()).toEqual(["plants"]);
    lobby.leave("plants");
    expect(lobby.waitingFor()).toEqual([]);
    const waiting = lobby.whenStarted(60_000);
    lobby.start();
    expect(await waiting).toBe(true);
    expect(await lobby.whenStarted(0)).toBe(true);
  });

  it("awaitStart waits up to STILL_LIMIT_MS for the start, then says whom the match is waiting for", async () => {
    vi.useFakeTimers();
    const lobby = new Lobby(["plants", "zombies"]);
    lobby.markReady("plants");
    let line: string | undefined;
    void awaitStart(lobby).then((said) => (line = said));
    await vi.advanceTimersByTimeAsync(STILL_LIMIT_MS - 1);
    expect(line).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(line).toBe("You're ready. The match hasn't started yet: it's waiting for the zombies' player. Call wait to wait on.");
    lobby.start();
    expect(await awaitStart(lobby)).toBe("Everyone's ready: the match has started.");
  });
});

describe("waitGameTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up once game time has stood still for STILL_LIMIT_MS, and says how much passed", async () => {
    vi.useFakeTimers();
    // Game time moves on 2.1 s during the first 8 s, then stands still, as in a paused game.
    const still = fixtureAt("1-1-zombie", 1501 + 210);
    let line: string | undefined;
    void waitGameTime(8, 1, fixture("1-1-zombie"), async () => still, () => false).then((waited) => (line = waited.line));
    await vi.advanceTimersByTimeAsync(8_000 + STILL_LIMIT_MS - 1_000);
    expect(line).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(line).toBe("Only 2.1 of the 8 s passed: game time stood still.");
  });

  it("while game time stands still, looks only every quarter second, however little time is left", async () => {
    vi.useFakeTimers();
    // At 50x the last 0.05 s would take 1 ms, but the game is paused. Every look is a request, and each
    // holds a port for a while after it closes.
    let reads = 0;
    const almost = fixtureAt("1-1-zombie", 1501 + 795);
    void waitGameTime(8, 50, fixture("1-1-zombie"), async () => (reads++, almost), () => false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toBeGreaterThan(30);
    expect(reads).toBeLessThanOrEqual(42);
  });
});
