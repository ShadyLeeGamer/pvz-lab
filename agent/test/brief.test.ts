// The instructions a player starts with, filled in from the session: they describe only the clock,
// the speed and the tools that session gives the player.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeBrief } from "../src/brief.ts";
import type { Session } from "../src/session.ts";

const template = readFileSync(new URL("../prompts/plants.md", import.meta.url), "utf8");

function session(settings: Partial<Session>): Session {
  return { side: "plants", level: "1-1", clock: "waits", speed: 1, tools: ["get_state", "place_plant", "collect_sun", "wait"], brief: "plants.md", maxTurns: 400, ...settings };
}

describe("writeBrief", () => {
  it("gives a paused session with every tool the instructions the first wins were played with", () => {
    expect(writeBrief(template, session({}))).toBe(`You are playing Plants vs. Zombies, Adventure level 1-1, using the tools you've been given.

Your goal is to win the level: get through every wave of zombies without letting one reach your house.

How the game works here:
- The game is paused while you think. Game time only passes when you call wait, and you choose how long each wait is.
- Planting costs sun. After each use, a seed packet recharges before you can plant from it again.
- Sun drops onto the lawn during play. Collect it, or it fades away after a while.
- The lawn is a grid. Columns run from 0, next to your house on the left, to 8, where zombies walk in on the right. Rows count from 0 at the top. Plants can only go on some tiles, and the game tells you when a plant can't go somewhere.
- Every tool tells you what happened and then shows the game.

Play the level to the end on your own. When a tool says the level is over, stop.
`);
  });

  it("tells a chat app's player how to start levels, with no level of its own", () => {
    const chat = readFileSync(new URL("../prompts/plants-chat.md", import.meta.url), "utf8");
    const text = writeBrief(chat, session({ level: undefined, tools: ["start_level", "get_state", "place_plant", "collect_sun", "wait"] }));
    expect(text).toContain("- Start a level with start_level. From 1-8 on, a level first asks which seed packets to bring");
    expect(text).not.toMatch(/\{\w+\}/);
  });

  it("tells a player with dig_up what digging up a plant does", () => {
    const text = writeBrief(template, session({ level: "1-7", tools: ["get_state", "place_plant", "dig_up", "collect_sun", "wait"] }));
    expect(text).toContain(
      "- Planting costs sun. After each use, a seed packet recharges before you can plant from it again.\n" +
        "- Digging up a plant with dig_up frees its tile, but gives no sun back.\n",
    );
  });

  it("in real time without wait, says the game keeps running and never mentions wait", () => {
    const text = writeBrief(template, session({ level: "1-7", clock: "realtime", tools: ["get_state", "place_plant", "collect_sun"] }));
    expect(text).toContain("Adventure level 1-7");
    expect(text).toContain("The game keeps running while you think");
    expect(text).not.toMatch(/\bwait\b/);
    expect(text).not.toContain("paused");
  });

  it("tells the zombie side about paydays, held sends, the early-wave check and the final wave", () => {
    const zombies = readFileSync(new URL("../prompts/zombies.md", import.meta.url), "utf8");
    const settings = session({ side: "zombies", level: "1-9", clock: "realtime", tools: ["get_state", "send_zombie", "wait"] });
    expect(writeBrief(zombies, settings)).toBe(`You are playing the zombies in Plants vs. Zombies, Adventure level 1-9, using the tools you've been given. Someone else plays the plants.

Your goal is to get a zombie into the plants' house: past their plants, and past the lawnmower at the end of its row.

How the game works here:
- The game keeps running while you think: your zombies keep walking and the plants keep fighting, so the time between your moves is game time too.
- Each wave pays you points when it arrives: what the game's own zombies in that wave would have cost. Spend them on that wave. Points still unspent when the next wave pays are lost.
- You can send the level's own zombie types, each for its cost. A type can't come before its first wave, except in the final wave, which allows every type. get_state shows what each costs and which are ready to send.
- Your zombies walk in from the right, in the row you choose. The game refuses a row a zombie can't use, such as dirt, or water before wave 6 for a zombie that only walks.
- In a level with bungee zombies, a bungee_zombie drops onto the tile you name and carries off the plant there.
- A huge wave pays you 7.5 seconds early, when its warning shows. Zombies you send during the warning are held, and walk on together with the wave's flag zombie, which the game still sends.
- Once a wave's points are spent, your zombies count as that wave: if the plants beat them down, the next wave comes early, as it does with the game's own waves. Until then, the next wave waits for its timer.
- The final wave is your last payday. Once it has arrived, the plants win as soon as no zombie is left on the lawn, so send its zombies during its warning or as soon as it arrives.
- wait lets time pass, and ends early when a wave pays you or the level ends.
- The lawn is a grid. Columns run from 0, next to the plants' house on the left, to 8 on the right, where your zombies walk in. Rows count from 0 at the top.
- Every tool tells you what happened and then shows the game.

Play the level to the end on your own. When a tool says the level is over, stop.
`);
    // Without wait or get_state, it never names them.
    const bare = writeBrief(zombies, session({ side: "zombies", level: "1-9", clock: "realtime", speed: 5, tools: ["send_zombie"] }));
    expect(bare).toContain("It runs at 5 times normal speed.");
    expect(bare).not.toMatch(/\b(wait|get_state)\b/);
  });

  it("tells a real-time player how fast the game runs, and leaves out what its missing tools would do", () => {
    const text = writeBrief(template, session({ clock: "realtime", speed: 3, tools: ["get_state", "wait"] }));
    expect(text).toContain("It runs at 3 times normal speed.");
    expect(text).toContain("Sun drops onto the lawn during play and fades away after a while.");
    expect(text).not.toContain("Collect it");
    expect(text).not.toContain("Planting costs sun");
    expect(text).not.toContain("Plants can only go on some tiles");
  });
});
