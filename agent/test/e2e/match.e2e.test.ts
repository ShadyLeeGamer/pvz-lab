// Matches through the real game, with scripted players in Claude Code's place. Each one starts its side's
// MCP server the way Claude Code does (a child process talking over stdin and stdout), as the host
// configures it, or joins a URL seat over HTTP as any MCP app would, and plays a short script.
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchFromFlags, matchFromSession, runMatch } from "../../src/match.ts";
import { sleep } from "../../src/mcp/shared.ts";
import type { LaunchPlayer, PlayerSpec } from "../../src/player.ts";
import { loadSession, type Side } from "../../src/session.ts";

type Call = (name: string, args?: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
type Script = (call: Call, stopped: () => boolean) => Promise<void>;

// What a scripted player saw when it joined: its tools, any instructions, and its first message.
interface Joined {
  tools: string[];
  instructions?: string;
  prompt: string;
  brief: string;
}

// Every tool says so once the level is over, from either side.
const over = (text: string) => /The level is over|No level is being played/.test(text);
// A script gives up after this long, so a match that never ends fails its test instead of hanging it.
// At speed 50 a level takes seconds.
const SCRIPT_MS = 120_000;

// Calls a tool through a connected client.
function caller(client: Client): Call {
  return async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content[0]?.text ?? "", isError: result.isError === true };
  };
}

// Plays each side with its script instead of Claude Code.
function scripted(scripts: Partial<Record<Side, Script>>, joined: Partial<Record<Side, Joined>>): LaunchPlayer {
  return (spec: PlayerSpec) => {
    let markReady: (ready: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => (markReady = resolve));
    let stopped = false;
    const play = async () => {
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const client = new Client({ name: "scripted", version: "test" });
      await client.connect(new StdioClientTransport({ ...spec.server, env: { ...env, ...spec.server.env }, stderr: "ignore" }));
      const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
      joined[spec.side] = { tools, instructions: client.getInstructions(), prompt: spec.prompt, brief: spec.brief };
      markReady(true);
      let toolCalls = 0;
      const call: Call = (name, args) => {
        toolCalls++;
        return caller(client)(name, args);
      };
      try {
        await scripts[spec.side]!(call, () => stopped);
      } finally {
        await client.close();
      }
      return { exitCode: 0, toolCalls, finish: "script ended" };
    };
    const done = play().finally(() => markReady(false));
    return { ready, done, stop: () => (stopped = true) };
  };
}

// The plants: a peashooter on the next tile of the first four columns, sun collected, ten seconds of
// game time, again and again until the level is over. Each request to the game opens a connection
// that holds a port for two minutes after it closes, so a script that played as fast as it could would
// leave too few ports for the end-to-end tests after it.
async function plantsUntilOver(call: Call, stopped: () => boolean): Promise<void> {
  const giveUpAt = Date.now() + SCRIPT_MS;
  for (let i = 0; !stopped() && Date.now() < giveUpAt; i++) {
    for (const move of [() => call("collect_sun"), () => call("place_plant", { plant: "peashooter", col: Math.floor(i / 5) % 4, row: i % 5 }), () => call("wait", { seconds: 10 })]) {
      if (over((await move()).text)) return;
    }
  }
}

// The zombies: a plain zombie down the middle row at each payday, until the level is over.
async function zombiesUntilOver(call: Call): Promise<void> {
  const giveUpAt = Date.now() + SCRIPT_MS;
  for (let { text } = await call("get_state"); !over(text) && Date.now() < giveUpAt; ) {
    ({ text } = await call("wait", { seconds: 30 }));
    if (text.includes("paid you")) await call("send_zombie", { zombie: "zombie", row: 2 });
  }
}

const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("matches with scripted players (launch the game; need agent/.env)", () => {
  let runsDir: string;

  beforeAll(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "pvz-lab-runs-"));
  });

  afterAll(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("plays 1-9 in versus at speed 50 to a recorded result: the plants pick seeds with choose_seeds, and the level plays on after the zombies' player stops", async () => {
    const joined: Partial<Record<Side, Joined>> = {};
    let choices = "";
    const scripts: Partial<Record<Side, Script>> = {
      plants: async (call, stopped) => {
        choices = (await call("choose_seeds")).text;
        const chosen = await call("choose_seeds", { seeds: ["peashooter", "sunflower", "cherry_bomb", "wall_nut", "potato_mine", "snow_pea"] });
        if (chosen.isError) throw new Error(chosen.text);
        await plantsUntilOver(call, stopped);
      },
      // Plain zombies down the middle row at each of the first three paydays, then it stops.
      zombies: async (call, stopped) => {
        const giveUpAt = Date.now() + SCRIPT_MS;
        for (let paydays = 0; paydays < 3 && !stopped() && Date.now() < giveUpAt; ) {
          const { text } = await call("wait", { seconds: 30 });
          if (over(text)) return;
          if (!text.includes("paid you")) continue;
          paydays++;
          while (!(await call("send_zombie", { zombie: "zombie", row: 2 })).isError);
        }
      },
    };
    const printed: string[] = [];
    const { runDir, result } = await runMatch(matchFromFlags(["1-9", "--plants", "claude", "--zombies", "claude", "--speed", "50"]), {
      launchPlayer: scripted(scripts, joined),
      print: (line) => printed.push(line),
      runsDir,
    });

    // Each side got only its own tools, and its brief only as its system prompt (D47).
    expect(joined.plants?.tools).toEqual(["choose_seeds", "collect_sun", "dig_up", "get_state", "place_plant", "wait"]);
    expect(joined.zombies?.tools).toEqual(["get_state", "send_zombie", "wait"]);
    expect(joined.plants?.instructions).toBeUndefined();
    expect(joined.zombies?.instructions).toBeUndefined();
    expect(joined.plants?.brief).toContain("You are playing the plants in Plants vs. Zombies, Adventure level 1-9");
    expect(joined.zombies?.brief).toContain("You are playing the zombies in Plants vs. Zombies, Adventure level 1-9");
    expect(joined.plants?.prompt).toMatch(/^Choose your seed packets with choose_seeds, then play the level\. The street shows the zombies coming in this level: /);
    expect(choices).toContain("Call choose_seeds again with the 6 you pick.");

    // The host ran game time once both were up, told of the paydays, and played on once the zombies stopped.
    expect(printed).toContain("Starting level 1-9 in versus...");
    expect(printed).toContain("Game time is running at 50x.");
    expect(printed.some((line) => /^\[zombies\] Wave \d+ paid the zombie side: \d+ points? to spend\.$/.test(line))).toBe(true);
    expect(printed).toContain("The zombies' player stopped (script ended); the level plays on without it.");

    // The level was decided, and the run folder holds the result and each side's moves.
    expect(["won", "lost"]).toContain(result.outcome);
    expect(result.winner).toBe(result.outcome === "won" ? "plants" : "zombies");
    expect(result.players.zombies).toMatchObject({ stoppedBeforeTheEnd: true, finish: "script ended" });
    expect(result.players.plants).toMatchObject({ stoppedBeforeTheEnd: false });
    expect(JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"))).toEqual(result);
    expect(lines(join(runDir, "plants", "moves.jsonl")).map((move) => move.tool)).toContain("choose_seeds");
    expect(lines(join(runDir, "zombies", "moves.jsonl")).filter((move) => move.tool === "send_zombie" && !move.error).length).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(runDir, "plants", "session.json"), "utf8")).tools).toContain("choose_seeds");
    expect(printed.at(-1)).toMatch(/^Result: level 1-9: the (plants|zombies) won\. Plants: \d+ tool calls\. Zombies: \d+ tool calls, stopped before the end \(script ended\)\.$/);
  }, 300_000);

  it("plays 1-9 in versus with both seats taken by URL, starting game time once both players have moved since play began (D56)", async () => {
    const printed: string[] = [];
    const seatsDir = join(runsDir, "seats");
    const match = runMatch(matchFromFlags(["1-9", "--plants", "url", "--zombies", "url", "--speed", "50"]), { print: (line) => printed.push(line), runsDir, seatsDir });
    // The link the host prints for a seat, once it has.
    const link = async (side: Side): Promise<string> => {
      const label = `The ${side}' seat: `;
      for (;;) {
        const line = printed.find((printedLine) => printedLine.startsWith(label));
        if (line) return line.slice(label.length);
        await sleep(100);
      }
    };
    const takeSeat = async (side: Side, name: string) => {
      const client = new Client({ name, version: "test" });
      await client.connect(new StreamableHTTPClientTransport(new URL(await link(side))));
      return { client, call: caller(client) };
    };

    // The zombies' player joins while the plants choose their seed packets: it's told the level hasn't
    // started, and its wait ends when play begins.
    const zombies = await takeSeat("zombies", "url-zombies");
    expect(zombies.client.getInstructions()).toContain("You are playing the zombies in Plants vs. Zombies, Adventure level 1-9");
    expect((await zombies.call("get_state")).text).toContain("The level hasn't started yet: the plants are choosing their seed packets.");
    const waitingForPlay = zombies.call("wait", { seconds: 30 });

    const plants = await takeSeat("plants", "url-plants");
    const chosen = await plants.call("choose_seeds", { seeds: ["peashooter", "sunflower", "cherry_bomb", "wall_nut", "potato_mine", "snow_pea"] });
    expect(chosen.isError, chosen.text).toBe(false);
    const chosenAt = Date.now();
    expect((await waitingForPlay).text.split("\n")[0]).toBe("Play has begun: the plants have chosen their seed packets.");
    expect(Date.now() - chosenAt).toBeLessThan(10_000); // not after the 30 s a wait gives game time that stands still

    // Game time waits for the zombies' player to move since play began: its look and its wait began before.
    await sleep(1500);
    expect((await plants.call("get_state")).text).toContain("Game time 0.0 s.");
    expect(printed).not.toContain("Game time is running at 50x.");

    await Promise.all([plantsUntilOver(plants.call, () => false), zombiesUntilOver(zombies.call)]);
    // Both players have been told the level is over, so the host ends the match without waiting out its
    // 60 s for players to stop.
    const told = Date.now();
    const { runDir, result } = await match;
    expect(Date.now() - told).toBeLessThan(20_000);
    await Promise.all([plants.client.close(), zombies.client.close()]).catch(() => {});

    // Each seat's app was told, its moves shown with its side, and game time ran once both had moved.
    expect(printed).toContain("[plants] url-plants test took the plants' seat.");
    expect(printed).toContain("[zombies] url-zombies test took the zombies' seat.");
    expect(printed).toContain("[zombies]   -> get_state {}");
    expect(printed).toContain("Game time is running at 50x.");

    // The level was decided, and the run folder holds each seat's moves and the command for Claude Code.
    expect(["won", "lost"]).toContain(result.outcome);
    expect(result.players.plants).toMatchObject({ app: "url-plants test", stoppedBeforeTheEnd: false });
    expect(result.players.zombies).toMatchObject({ app: "url-zombies test", stoppedBeforeTheEnd: false });
    expect(lines(join(runDir, "plants", "moves.jsonl"))[0].tool).toBe("choose_seeds");
    expect(lines(join(runDir, "zombies", "moves.jsonl")).length).toBe(result.players.zombies!.toolCalls);
    expect(JSON.parse(readFileSync(join(runDir, "zombies", "mcp.json"), "utf8")).mcpServers.pvz.url).toBe(await link("zombies"));
    expect(readFileSync(join(runDir, "zombies", "claude.cmd"), "utf8")).toContain("--strict-mcp-config");
    // Each seat's own folder has this match's link, for apps that play from it, such as Antigravity CLI.
    for (const side of ["plants", "zombies"] as const) {
      expect(JSON.parse(readFileSync(join(seatsDir, side, ".agents", "mcp_config.json"), "utf8")).mcpServers.pvz.serverUrl).toBe(await link(side));
      expect(readFileSync(join(runDir, side, "agy.cmd"), "utf8")).toContain(`cd /d "${join(seatsDir, side)}"`);
    }
    expect(printed.at(-1)).toMatch(/^Result: level 1-9: the (plants|zombies) won\. Plants \(url-plants test\): \d+ tool calls\. Zombies \(url-zombies test\): \d+ tool calls\.$/);
  }, 300_000);

  it("plays a play session as before: 1-8 with its own seeds against the level, until its player stops", async () => {
    const joined: Partial<Record<Side, Joined>> = {};
    let firstLook = "";
    const scripts: Partial<Record<Side, Script>> = {
      plants: async (call) => {
        firstLook = (await call("get_state")).text;
        for (let i = 0; i < 3; i++) {
          await call("place_plant", { plant: "sunflower", col: 0, row: i });
          await call("wait", { seconds: 2 });
        }
      },
    };
    const session = await loadSession(fileURLToPath(new URL("./play-session.json", import.meta.url)));
    const printed: string[] = [];
    const { runDir, result } = await runMatch(matchFromSession(session), { launchPlayer: scripted(scripts, joined), print: (line) => printed.push(line), runsDir });

    expect(joined.plants?.tools).toEqual(["collect_sun", "get_state", "place_plant", "wait"]);
    expect(joined.plants?.instructions).toBeUndefined();
    expect(joined.plants?.prompt).toMatch(/^Play the level\. The street shows the zombies coming in this level: /);
    // The level started with the session's seeds, against the level's own zombies.
    const packets = firstLook.split("Seed packets:\n")[1]!.split("\n\n")[0]!.split("\n").map((line) => line.split(":")[0]);
    expect(packets).toEqual(session.settings.seeds!.map((seed) => `- ${seed}`));
    expect(firstLook).not.toContain("zombie side");
    expect(printed.slice(1, 5)).toEqual([
      "Starting level 1-8...",
      expect.stringMatching(/^The street shows the zombies coming in this level: /),
      "Game time will run at 50x.",
      "Game time is running at 50x.",
    ]);
    // Its player stopped, and nobody else plays, so the run ended there.
    expect(result).toMatchObject({ level: "1-8", plants: "claude", zombies: "level", outcome: "unfinished", winner: null });
    expect(result.players.plants).toMatchObject({ toolCalls: 7, stoppedBeforeTheEnd: true });
    expect(printed.at(-1)).toBe("Result: level 1-8 unfinished after 7 tool calls.");
    expect(lines(join(runDir, "plants", "moves.jsonl")).map((move) => move.tool)).toEqual(["get_state", ...Array(3).fill(["place_plant", "wait"]).flat()]);
  }, 300_000);
});
