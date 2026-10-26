// The instructions a player starts with, filled in from the session: they describe only the clock,
// the speed and the tools that session gives the player.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeBrief } from "../src/brief.ts";
import type { Session } from "../src/session.ts";

const template = readFileSync(new URL("../prompts/play.md", import.meta.url), "utf8");

function session(settings: Partial<Session>): Session {
  return { level: "1-1", clock: "waits", speed: 1, tools: ["get_state", "place_plant", "collect_sun", "wait"], brief: "play.md", maxTurns: 400, ...settings };
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
    const chat = readFileSync(new URL("../prompts/chat.md", import.meta.url), "utf8");
    const text = writeBrief(chat, session({ level: undefined, tools: ["start_level", "get_state", "place_plant", "collect_sun", "wait"] }));
    expect(text).toContain("- Start a level with start_level. From 1-8 on, a level first asks which seed packets to bring");
    expect(text).not.toMatch(/\{\w+\}/);
  });

  it("in real time without wait, says the game keeps running and never mentions wait", () => {
    const text = writeBrief(template, session({ level: "1-7", clock: "realtime", tools: ["get_state", "place_plant", "collect_sun"] }));
    expect(text).toContain("Adventure level 1-7");
    expect(text).toContain("The game keeps running while you think");
    expect(text).not.toMatch(/\bwait\b/);
    expect(text).not.toContain("paused");
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
