// Session files: what a play session may set, and what a broken one says.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBrief } from "../src/brief.ts";
import { loadSession, TOOL_NAMES } from "../src/session.ts";

describe("loadSession", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "pvz-lab-session-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  async function write(json: unknown): Promise<string> {
    const path = join(folder, "session.json");
    await writeFile(path, typeof json === "string" ? json : JSON.stringify(json));
    return path;
  }

  it("fills in the defaults and finds the brief next to the session file", async () => {
    const session = await loadSession(await write({ level: "1-1", tools: ["get_state", "wait"], brief: "brief.md" }));
    expect(session.settings).toEqual({ side: "plants", level: "1-1", clock: "waits", speed: 1, tools: ["get_state", "wait"], brief: "brief.md", maxTurns: 400 });
    expect(session.briefPath).toBe(join(folder, "brief.md"));
  });

  it("loads every session the repo ships, with a brief that fills in and names no tool the session leaves out", async () => {
    const sessions = fileURLToPath(new URL("../sessions/", import.meta.url));
    const files = readdirSync(sessions).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const session = await loadSession(join(sessions, file));
      expect(existsSync(session.briefPath), `${file}: ${session.briefPath}`).toBe(true);
      const brief = writeBrief(readFileSync(session.briefPath, "utf8"), session.settings);
      expect(brief, file).not.toMatch(/\{(level|rules)\}/);
      for (const tool of TOOL_NAMES.filter((name) => !session.settings.tools.includes(name))) {
        expect(brief, `${file} names ${tool}`).not.toMatch(new RegExp(`\\b${tool}\\b`));
      }
    }
  });

  it("for a chat app, offers start_level instead of a level, and never both", async () => {
    const chat = await loadSession(fileURLToPath(new URL("../sessions/chat.json", import.meta.url)));
    expect(chat.settings.level).toBeUndefined();
    expect(chat.settings.tools).toContain("start_level");
    await expect(loadSession(await write({ level: "1-1", tools: ["start_level", "wait"], brief: "b.md" }))).rejects.toThrow(
      /leave out "level" and "seeds"/,
    );
    await expect(loadSession(await write({ tools: ["get_state", "wait"], brief: "b.md" }))).rejects.toThrow(/offer "start_level"/);
  });

  it("refuses a paused clock without wait, since game time would never move", async () => {
    await expect(loadSession(await write({ level: "1-1", clock: "waits", tools: ["get_state", "place_plant"], brief: "b.md" }))).rejects.toThrow(
      /must include "wait"/,
    );
  });

  it("lets the plants choose seeds at a level started for them, which needs the level and no seeds of its own", async () => {
    const match = { level: "1-9", clock: "realtime", tools: ["choose_seeds", "get_state", "wait"], brief: "b.md" };
    expect((await loadSession(await write(match))).settings.tools).toEqual(["choose_seeds", "get_state", "wait"]);
    await expect(loadSession(await write({ ...match, seeds: ["peashooter"] }))).rejects.toThrow(/with "choose_seeds" the player picks the seeds/);
    await expect(loadSession(await write({ ...match, level: undefined }))).rejects.toThrow(/with "choose_seeds" the player picks the seeds/);
    await expect(loadSession(await write({ ...match, side: "zombies", tools: ["choose_seeds", "send_zombie"] }))).rejects.toThrow(/the zombies' side takes/);
  });

  it("gives each side only its own tools, and the zombie side a real-time game with no seeds", async () => {
    const zombies = { side: "zombies", level: "1-9", clock: "realtime", tools: ["get_state", "send_zombie", "wait"], brief: "b.md" };
    expect((await loadSession(await write(zombies))).settings).toMatchObject({ side: "zombies", clock: "realtime", tools: ["get_state", "send_zombie", "wait"] });
    await expect(loadSession(await write({ ...zombies, tools: ["get_state", "place_plant"] }))).rejects.toThrow(/the zombies' side takes ready, get_state, send_zombie and wait/);
    await expect(loadSession(await write({ level: "1-9", clock: "realtime", tools: ["send_zombie"], brief: "b.md" }))).rejects.toThrow(/the plants' side takes/);
    await expect(loadSession(await write({ ...zombies, clock: "waits" }))).rejects.toThrow(/the zombies' side plays in real time/);
    await expect(loadSession(await write({ ...zombies, seeds: ["peashooter"] }))).rejects.toThrow(/brings no seeds/);
  });

  it("takes the seeds to bring and a speed from 1 to 50", async () => {
    const session = await loadSession(await write({ level: "1-8", seeds: ["peashooter", "wall_nut"], speed: 50, tools: ["wait"], brief: "b.md" }));
    expect(session.settings).toMatchObject({ seeds: ["peashooter", "wall_nut"], speed: 50 });
  });

  it("refuses unknown tools, repeated tools, levels that don't exist, speeds out of range and empty seed lists", async () => {
    await expect(loadSession(await write({ level: "1-1", tools: ["shovel"], brief: "b.md" }))).rejects.toThrow(/isn't valid/);
    await expect(loadSession(await write({ level: "1-1", tools: ["wait", "wait"], brief: "b.md" }))).rejects.toThrow(/only be listed once/);
    await expect(loadSession(await write({ level: "6-1", tools: ["wait"], brief: "b.md" }))).rejects.toThrow(/isn't valid/);
    for (const speed of [0, 51, 1.5]) {
      await expect(loadSession(await write({ level: "1-1", speed, tools: ["wait"], brief: "b.md" })), `speed ${speed}`).rejects.toThrow(/isn't valid/);
    }
    await expect(loadSession(await write({ level: "1-8", seeds: [], tools: ["wait"], brief: "b.md" }))).rejects.toThrow(/isn't valid/);
  });

  it("says which file it couldn't read", async () => {
    await expect(loadSession(await write("{ not json"))).rejects.toThrow(/couldn't read the session file .*session\.json/);
  });
});
