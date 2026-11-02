// The text the zombie side's player reads, checked against the zombie seat's real views of versus
// levels (test/fixtures, captured with `pnpm fixtures:capture versus`).
import { describe, expect, it } from "vitest";
import type { GameState } from "../src/game-client.ts";
import { summarizeZombies } from "../src/summarize-zombies.ts";
import { fixture } from "./fixtures/fixture.ts";

describe("summarizeZombies", () => {
  it("before the first payday, says there are no points yet and lists the level's types with their costs", () => {
    const text = summarizeZombies(fixture("1-9-versus-start"));
    expect(text).toContain("Level 1-9 (day). Game time 0.0 s. Waves: 0 of 20 sent (0% through the level).");
    expect(text).toContain("Your points: none yet. The first wave pays you when it arrives.");
    expect(text).toContain(
      "Zombies you can send:\n- zombie: 1 point. No points yet.\n- conehead_zombie: 2 points. No points yet.\n" +
        "- pole_vaulting_zombie: 2 points. No points yet.\n- buckethead_zombie: 4 points. No points yet.",
    );
  });

  it("says why each type can't be sent: points short, or before its first wave", () => {
    const text = summarizeZombies(fixture("1-9-versus-midgame"));
    expect(text).toContain("Your points: 0, for wave 4. Points still unspent when the next wave pays are lost.");
    expect(text).toContain("- conehead_zombie: 2 points. Needs 2 more points.");
    expect(text).toContain("- pole_vaulting_zombie: 2 points. Not before wave 5.");
  });

  it("shows the plants' sun and seed packets, and each row's defence and mower", () => {
    const text = summarizeZombies(fixture("1-9-versus-midgame"));
    expect(text).toContain("The plants have 50 sun to spend. Their seed packets:\n- peashooter: 100 sun. Needs 50 more sun.");
    expect(text).toContain("- row 0: sunflower (6), potato_mine (2), wall_nut; lawn mower ready.");
    expect(text).toContain("- row 2: nothing planted; no mower left.");
  });

  it("shows its own zombie walking in, which the plants can't see yet", () => {
    const text = summarizeZombies(fixture("1-9-versus-midgame"));
    expect(text).toMatch(/^row 0 {2}S S S M S W S S M Z$/m);
    expect(text).toContain("- row 0: conehead_zombie walking in from the right, with a cone");
  });

  it("in the final wave, which allows every type, never says a type must wait for a later wave", () => {
    // 1-2 at its final payday, given a type whose first wave is past the level's last, in the shape
    // docs/api.md gives it: 1-2's only type comes from wave 1.
    const state = fixture("1-2-versus-lost");
    const finalWave: GameState = {
      ...state,
      versus: { ...state.versus!, wave: 6, points: 0, types: [{ zombie: "conehead_zombie", cost: 2, firstWave: 10, ready: false }] },
    };
    expect(summarizeZombies(finalWave)).toContain("- conehead_zombie: 2 points. Needs 2 more points.");
  });

  it("during a huge wave's warning, lists what's ready and the zombies held for the wave", () => {
    const text = summarizeZombies(fixture("1-9-versus-warning"));
    expect(text).toContain("Waves: 9 of 20 sent (39% through the level). A huge wave is coming!");
    expect(text).toContain("Your points: 7, for wave 10.");
    expect(text).toContain("- buckethead_zombie: 4 points. Ready.");
    expect(text).toContain("Held to walk on with wave 10's flag zombie: conehead_zombie in row 1.");
  });

  it("says which held zombies couldn't walk on, and why", () => {
    // No recorded state has a refund (it takes two bungees aimed at one tile), so this adds one to a
    // real state in the shape docs/api.md gives it.
    const state = fixture("1-9-versus-warning");
    const withRefund: GameState = { ...state, versus: { ...state.versus!, refunds: [{ zombie: "bungee_zombie", row: 1, reason: "bungee_target" }] } };
    expect(summarizeZombies(withRefund)).toContain(
      "Held zombies that couldn't walk on, with their points given back:\n- bungee_zombie for row 1: its tile couldn't be taken when the wave arrived",
    );
  });

  it("marks the rows no zombie can walk, and tells the zombies' win from their side", () => {
    const text = summarizeZombies(fixture("1-2-versus-lost"));
    expect(text.split("\n")[0]).toBe("Your zombies got into the house: you won level 1-2!");
    expect(text).toContain("- row 0 (dirt): no zombie can walk here.");
    expect(text).toContain("- row 2: zombie at the plants' house");
  });

  it("says when the level isn't being played in versus", () => {
    expect(summarizeZombies(fixture("1-1-start"))).toContain("This level isn't being played in versus, so there's no zombie side to play.");
  });
});
