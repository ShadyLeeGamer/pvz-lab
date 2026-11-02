// The text the plants' side reads, checked against real states captured from the game (test/fixtures).
import { describe, expect, it } from "vitest";
import { summarizePlants } from "../../src/plants/summary.ts";
import { fixture } from "../fixtures/fixture.ts";

describe("summarizePlants", () => {
  it("opens 1-1 with the level, the sun, its one packet and the one row that takes plants", () => {
    const text = summarizePlants(fixture("1-1-start"));
    expect(text).toContain("Level 1-1 (day). Game time 0.0 s. Waves: 0 of 4 sent (0% through the level).");
    expect(text).toContain("Sun: 150 to spend.");
    expect(text).toContain("- peashooter: 100 sun. Ready.");
    expect(text).toMatch(/^row 2 {2}\. \. \. \. \. \. \. \. \.$/m);
    for (const row of [0, 1, 3, 4]) expect(text).toMatch(new RegExp(`^row ${row} {2}x x x x x x x x x$`, "m"));
    expect(text).toContain("Zombies: none in sight.");
  });

  it("draws plants on the map, and a zombie still walking in under the + column", () => {
    const text = summarizePlants(fixture("1-1-zombie"));
    expect(text).toMatch(/^row 2 {2}P P \. \. \. \. \. \. \. Z$/m);
    expect(text).toContain("- row 2: zombie walking in from the right");
    expect(text).toContain("- peashooter: 100 sun. Recharging, 53% done; then needs 100 more sun.");
    expect(text).toContain("Suns waiting to be collected: 1 (25 sun).");
    expect(text).toContain("Lawnmowers left in rows: 2.");
  });

  it("puts each zombie in its row and column, and lists the plants worth knowing about", () => {
    const text = summarizePlants(fixture("1-8-midgame"));
    expect(text).toMatch(/^row 0 {2}S S S M S W S S \. Z$/m);
    expect(text).toMatch(/^row 1 {2}\. \. \. \. \. Z \. \. \.$/m);
    expect(text).toContain("- row 1: zombie at column 5");
    expect(text).toContain("- row 0: zombie walking in from the right");
    expect(text).toContain("- potato_mine at column 3, row 0: armed");
    expect(text).toContain("Suns waiting to be collected: none.");
    expect(text).toContain("S sunflower, W wall_nut, M potato_mine, . empty, Z zombie, a Z in the + column is still walking in");
  });

  it("says why each packet can't be used yet", () => {
    const text = summarizePlants(fixture("1-8-midgame"));
    expect(text).toContain("- peashooter: 100 sun. Needs 75 more sun.");
    expect(text).toContain("- sunflower: 50 sun. Recharging, 13% done; then needs 25 more sun.");
    expect(text).toContain("- potato_mine: 25 sun. Recharging, 99% done.");
  });

  it("says when a level has no shovel, but only to a player that can dig", () => {
    const noShovel = "This level has no shovel, so nothing can be dug up.";
    expect(summarizePlants(fixture("1-1-start"), { shovel: true })).toContain(noShovel);
    expect(summarizePlants(fixture("1-1-start"))).not.toContain("shovel");
    expect(summarizePlants(fixture("1-8-start"), { shovel: true })).not.toContain("shovel");
  });

  it("leads with the result once the level is won", () => {
    expect(summarizePlants(fixture("1-1-won")).split("\n")[0]).toBe("You won level 1-1!");
  });

  it("says when there's no lawn to show", () => {
    expect(summarizePlants(fixture("award-screen"))).toBe("Level won! The game is showing the award screen.");
  });
});
