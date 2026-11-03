// How pnpm match's flags and pnpm play's session files turn into a match's settings, and the session the
// host writes for each Claude player. The end-to-end tests play matches with them.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchFromFlags, matchFromSession, seatSession } from "../src/match.ts";
import { loadSession } from "../src/session.ts";

const shipped = (name: string) => fileURLToPath(new URL(`../sessions/${name}`, import.meta.url));

describe("matchFromFlags", () => {
  it("reads the level and who plays each side, in real time at normal speed unless told otherwise", () => {
    expect(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "claude"])).toEqual({
      level: "1-9",
      plants: "claude",
      zombies: "claude",
      speed: 1,
      clock: "realtime",
      name: "match-1-9",
    });
    expect(matchFromFlags(["--zombies", "level", "2-7", "--plants", "claude", "--speed", "50"])).toMatchObject({ level: "2-7", zombies: "level", speed: 50 });
    expect(matchFromFlags(["1-9", "--plants", "human", "--zombies", "claude"])).toMatchObject({ plants: "human", speed: 1 });
  });

  it("refuses what it can't play, and says why", () => {
    const both = ["--plants", "claude", "--zombies", "claude"];
    expect(() => matchFromFlags(both)).toThrow(/name one level/);
    expect(() => matchFromFlags(["6-1", ...both])).toThrow(/name one level/);
    expect(() => matchFromFlags(["1-9", "1-8", ...both])).toThrow(/name one level/);
    expect(() => matchFromFlags(["1-9", "--plants", "level", "--zombies", "claude"])).toThrow(/--plants must be human or claude/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude"])).toThrow(/--zombies must be level or claude/);
    expect(() => matchFromFlags(["1-9", ...both, "--speed", "51"])).toThrow(/--speed must be a whole number from 1 to 50/);
    expect(() => matchFromFlags(["1-9", ...both, "--speed", "2.5"])).toThrow(/--speed must be/);
    expect(() => matchFromFlags(["1-9", ...both, "--seeds", "peashooter"])).toThrow(/usage: pnpm match/);
  });

  it("keeps a person's game at normal speed", () => {
    expect(() => matchFromFlags(["1-9", "--plants", "human", "--zombies", "claude", "--speed", "5"])).toThrow(/normal speed/);
  });
});

describe("matchFromSession", () => {
  it("turns a play session into Claude on the plants against the level, as the flags would, with the session's own settings", async () => {
    const session = await loadSession(shipped("1-8-single-actions.json"));
    const settings = matchFromSession(session);
    expect(settings).toEqual({
      level: "1-8",
      plants: "claude",
      zombies: "level",
      speed: session.settings.speed,
      clock: session.settings.clock,
      plantsSession: session,
      name: "1-8-single-actions",
    });
    expect(session.settings.seeds).toBeDefined(); // the match starts the level with them
    const { level, plants, zombies } = matchFromFlags(["1-8", "--plants", "claude", "--zombies", "level"]);
    expect(settings).toMatchObject({ level, plants, zombies });
  });

  it("refuses the sessions pnpm play can't run: chat sessions and the zombies' side", async () => {
    await expect(loadSession(shipped("chat.json")).then(matchFromSession)).rejects.toThrow(/pnpm play needs a session with a "level"/);
    await expect(loadSession(shipped("1-9-zombies.json")).then(matchFromSession)).rejects.toThrow(/plays the zombies/);
  });
});

describe("seatSession", () => {
  const versus = matchFromFlags(["1-9", "--plants", "claude", "--zombies", "claude", "--speed", "5"]);

  it("gives a match's plants their tools, choose_seeds while the level waits at its seed chooser, and the brief for playing against a player", () => {
    const plants = seatSession(versus, "plants", true);
    expect(plants).toMatchObject({ side: "plants", level: "1-9", clock: "realtime", speed: 5 });
    expect(plants.tools).toEqual(["choose_seeds", "get_state", "place_plant", "dig_up", "collect_sun", "wait"]);
    expect(plants.brief).toMatch(/[\\/]prompts[\\/]plants-versus\.md$/);
    expect(seatSession(versus, "plants", false).tools).not.toContain("choose_seeds");
    const againstLevel = seatSession(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "level"]), "plants", false);
    expect(againstLevel.brief).toMatch(/[\\/]prompts[\\/]plants\.md$/);
    for (const session of [plants, againstLevel]) expect(existsSync(session.brief)).toBe(true);
  });

  it("gives the zombies their three tools in real time, with the zombies' brief", () => {
    const zombies = seatSession(versus, "zombies", false);
    expect(zombies).toMatchObject({ side: "zombies", level: "1-9", clock: "realtime", speed: 5, tools: ["get_state", "send_zombie", "wait"] });
    expect(zombies.brief).toMatch(/[\\/]prompts[\\/]zombies\.md$/);
    expect(existsSync(zombies.brief)).toBe(true);
  });
});
