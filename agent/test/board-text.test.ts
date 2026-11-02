// The text both sides read about the game, checked against real states captured from the game (test/fixtures).
import { describe, expect, it } from "vitest";
import { plantSymbols, streetLine, zombieColumn } from "../src/board-text.ts";
import { fixture } from "./fixtures/fixture.ts";

describe("zombieColumn", () => {
  it("puts a zombie eating a plant in that plant's column", () => {
    // A normal zombie stops to eat the plant in column c once its bite (x + 50) reaches the plant's right edge, 110 + 80c.
    for (let col = 0; col < 9; col++) expect(zombieColumn(60 + 80 * col)).toBe(col);
  });

  it("says a zombie at the right edge is still walking in, and one past column 0 is at the house", () => {
    expect(zombieColumn(751)).toBeGreaterThanOrEqual(9);
    expect(zombieColumn(-60)).toBeLessThan(0);
  });
});

describe("plantSymbols", () => {
  it("gives each plant type its own capital letter, never Z, starting from its words", () => {
    const symbols = plantSymbols(fixture("1-8-start").board!);
    expect(Object.fromEntries(symbols)).toEqual({
      peashooter: "P",
      sunflower: "S",
      cherry_bomb: "C",
      wall_nut: "W",
      potato_mine: "M",
      snow_pea: "N",
    });
  });
});

describe("streetLine", () => {
  it("names the street's zombies, and says nothing when the game showed none", () => {
    expect(streetLine(["zombie", "pole_vaulting_zombie"])).toBe("The street shows the zombies coming in this level: zombie, pole_vaulting_zombie.");
    expect(streetLine([])).toBe("");
    expect(streetLine(undefined)).toBe("");
  });
});
