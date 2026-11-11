// How pnpm match's flags and pnpm play's session files turn into a match's settings, and the session the
// host writes for each player. The end-to-end tests play matches with them.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchFromFlags, matchFromSession, playerPlaces, seatSession } from "../src/match.ts";
import { loadSession } from "../src/session.ts";

const shipped = (name: string) => fileURLToPath(new URL(`../sessions/${name}`, import.meta.url));

describe("matchFromFlags", () => {
  it("reads the level and who plays each side, in real time at normal speed unless told otherwise", () => {
    expect(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "claude"])).toEqual({
      level: "1-9",
      plants: "claude",
      zombies: "claude",
      windows: false,
      models: {},
      speed: 1,
      clock: "realtime",
      name: "match-1-9",
    });
    expect(matchFromFlags(["--zombies", "level", "2-7", "--plants", "claude", "--speed", "50"])).toMatchObject({ level: "2-7", zombies: "level", speed: 50 });
    expect(matchFromFlags(["1-9", "--plants", "human", "--zombies", "claude"])).toMatchObject({ plants: "human", speed: 1 });
    // A URL seat on either side, against anyone.
    expect(matchFromFlags(["1-9", "--plants", "url", "--zombies", "url"])).toMatchObject({ plants: "url", zombies: "url" });
    expect(matchFromFlags(["1-9", "--plants", "human", "--zombies", "url"])).toMatchObject({ plants: "human", zombies: "url" });
    expect(matchFromFlags(["2-7", "--plants", "url", "--zombies", "level", "--speed", "3"])).toMatchObject({ plants: "url", zombies: "level", speed: 3 });
  });

  it("refuses what it can't play, and says why", () => {
    const both = ["--plants", "claude", "--zombies", "claude"];
    expect(() => matchFromFlags(both)).toThrow(/name one level/);
    expect(() => matchFromFlags(["6-1", ...both])).toThrow(/name one level/);
    expect(() => matchFromFlags(["1-9", "1-8", ...both])).toThrow(/name one level/);
    expect(() => matchFromFlags(["1-9", "--plants", "level", "--zombies", "claude"])).toThrow(/--plants must be human, claude, agy or url/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude"])).toThrow(/--zombies must be level, claude, agy or url/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude", "--zombies", "human"])).toThrow(/--zombies must be level, claude, agy or url/);
    expect(() => matchFromFlags(["1-9", ...both, "--speed", "51"])).toThrow(/--speed must be a whole number from 1 to 50/);
    expect(() => matchFromFlags(["1-9", ...both, "--speed", "2.5"])).toThrow(/--speed must be/);
    expect(() => matchFromFlags(["1-9", ...both, "--seeds", "peashooter"])).toThrow(/usage: pnpm match/);
  });

  it("keeps a person's game at normal speed", () => {
    expect(() => matchFromFlags(["1-9", "--plants", "human", "--zombies", "claude", "--speed", "5"])).toThrow(/normal speed/);
  });

  it("opens Claude and agy players in chat windows of their own with --windows, each with the model picked for its side (D60, D61)", () => {
    expect(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "agy", "--windows"])).toMatchObject({ plants: "claude", zombies: "agy", windows: true, models: {} });
    const both = ["1-9", "--plants", "agy", "--plants-model", "gpt-oss-120b-medium", "--zombies", "claude", "--zombies-model", "opus", "--windows"];
    expect(matchFromFlags(both)).toMatchObject({ plants: "agy", zombies: "claude", windows: true, models: { plants: "gpt-oss-120b-medium", zombies: "opus" } });
    // A Claude player in the terminal takes a model too, and a person can play against a window.
    expect(matchFromFlags(["1-9", "--plants", "claude", "--plants-model", "sonnet", "--zombies", "level"])).toMatchObject({ windows: false, models: { plants: "sonnet" } });
    expect(matchFromFlags(["1-9", "--plants", "human", "--zombies", "claude", "--windows"])).toMatchObject({ plants: "human", zombies: "claude", windows: true });
    expect(matchFromFlags(["1-9", "--plants", "url", "--zombies", "agy", "--windows", "--zombies-model", "claude-opus-4-6-thinking"]).models).toEqual({ zombies: "claude-opus-4-6-thinking" });
  });

  it("refuses an agy player without --windows, --windows with nobody to open, and a model for a side with no Claude or agy player", () => {
    expect(() => matchFromFlags(["1-9", "--plants", "agy", "--zombies", "claude"])).toThrow(/agy plays in a chat window of its own, so add --windows/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude", "--zombies", "agy"])).toThrow(/so add --windows/);
    expect(() => matchFromFlags(["1-9", "--plants", "url", "--zombies", "url", "--windows"])).toThrow(/--windows opens claude and agy players .* and this match has none/);
    expect(() => matchFromFlags(["1-9", "--plants", "human", "--zombies", "level", "--windows"])).toThrow(/this match has none/);
    expect(() => matchFromFlags(["1-9", "--plants", "human", "--zombies", "claude", "--plants-model", "opus"])).toThrow(/--plants-model picks a claude or agy player's model, and the plants have none/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude", "--zombies", "url", "--zombies-model", "opus"])).toThrow(/the zombies have none/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude", "--zombies", "level", "--zombies-model", "opus"])).toThrow(/the zombies have none/);
    // A model's name goes into a command file, so nothing a command line would act on.
    expect(() => matchFromFlags(["1-9", "--plants", "claude", "--plants-model", "opus & calc", "--zombies", "level"])).toThrow(/--plants-model takes a model's name/);
    expect(() => matchFromFlags(["1-9", "--plants", "claude", "--plants-model", 'opus"', "--zombies", "level"])).toThrow(/takes a model's name/);
  });
});

describe("playerPlaces", () => {
  it("puts a Claude player in the terminal, or in a window with --windows, an agy player in a window, and url at a link (D60)", () => {
    expect(playerPlaces(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "claude"]))).toEqual({ plants: "terminal", zombies: "terminal" });
    // In a window, a Claude player isn't also started in the terminal.
    expect(playerPlaces(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "agy", "--windows"]))).toEqual({ plants: "window", zombies: "window" });
    expect(playerPlaces(matchFromFlags(["1-9", "--plants", "url", "--zombies", "claude", "--windows"]))).toEqual({ plants: "link", zombies: "window" });
    expect(playerPlaces(matchFromFlags(["1-9", "--plants", "human", "--zombies", "url"]))).toEqual({ zombies: "link" });
    expect(playerPlaces(matchFromFlags(["1-9", "--plants", "human", "--zombies", "level"]))).toEqual({});
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
      windows: false,
      models: {},
      speed: session.settings.speed,
      clock: session.settings.clock,
      plantsSession: session,
      name: "1-8-single-actions",
    });
    expect(session.settings.seeds).toBeDefined(); // the match starts the level with them
    const { level, plants, zombies, windows, models } = matchFromFlags(["1-8", "--plants", "claude", "--zombies", "level"]);
    expect(settings).toMatchObject({ level, plants, zombies, windows, models });
  });

  it("refuses the sessions pnpm play can't run: chat sessions and the zombies' side", async () => {
    await expect(loadSession(shipped("chat.json")).then(matchFromSession)).rejects.toThrow(/pnpm play needs a session with a "level"/);
    await expect(loadSession(shipped("1-9-zombies.json")).then(matchFromSession)).rejects.toThrow(/plays the zombies/);
  });
});

describe("seatSession", () => {
  const versus = matchFromFlags(["1-9", "--plants", "claude", "--zombies", "claude", "--speed", "5"]);

  it("gives a match's plants their tools, choose_seeds while the level waits at its seed chooser, ready against a player (D62), and the brief for playing against one", () => {
    const plants = seatSession(versus, "plants", true);
    expect(plants).toMatchObject({ side: "plants", level: "1-9", clock: "realtime", speed: 5 });
    expect(plants.tools).toEqual(["choose_seeds", "ready", "get_state", "place_plant", "dig_up", "collect_sun", "wait"]);
    expect(plants.brief).toMatch(/[\\/]prompts[\\/]plants-versus\.md$/);
    expect(seatSession(versus, "plants", false).tools).not.toContain("choose_seeds");
    const againstLevel = seatSession(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "level"]), "plants", false);
    expect(againstLevel.tools).toEqual(["get_state", "place_plant", "dig_up", "collect_sun", "wait"]);
    expect(againstLevel.brief).toMatch(/[\\/]prompts[\\/]plants\.md$/);
    // A URL seat on the zombies makes it versus too, and a URL seat on the plants gets the same session.
    expect(seatSession(matchFromFlags(["1-9", "--plants", "url", "--zombies", "url"]), "plants", true)).toEqual({ ...plants, speed: 1 });
    for (const session of [plants, againstLevel]) expect(existsSync(session.brief)).toBe(true);
  });

  it("gives the zombies their tools, ready among them (D62), in real time, with the zombies' brief", () => {
    const zombies = seatSession(versus, "zombies", false);
    expect(zombies).toMatchObject({ side: "zombies", level: "1-9", clock: "realtime", speed: 5, tools: ["ready", "get_state", "send_zombie", "wait"] });
    expect(zombies.brief).toMatch(/[\\/]prompts[\\/]zombies\.md$/);
    expect(existsSync(zombies.brief)).toBe(true);
  });
});
