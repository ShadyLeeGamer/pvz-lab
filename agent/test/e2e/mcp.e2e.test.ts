// The MCP server against the real game: an MCP client starts the server the way Claude Code does
// (a child process talking over stdin and stdout) and plays a little of 1-1 with its tools.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchGame, readGameConfig, type RunningGame } from "../../src/game-process.ts";
import { GameApi } from "./api.ts";

const serverScript = fileURLToPath(new URL("../../src/mcp/server.ts", import.meta.url));
// Like sessions/1-1-single-actions.json, but waits play out at 50x so the tests stay quick.
const sessionFile = fileURLToPath(new URL("./fast-session.json", import.meta.url));

describe("the MCP tools playing 1-1 (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;
  let api: GameApi;
  let client: Client;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content[0]?.text ?? "", isError: result.isError === true };
  }

  beforeAll(async () => {
    game = await launchGame(readGameConfig());
    api = new GameApi(game.baseUrl);
    const started = await api.control({ type: "startLevel", level: "1-1" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);

    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    client = new Client({ name: "e2e", version: "test" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverScript],
        env: { ...env, PVZ_API_URL: game.baseUrl, PVZ_SESSION: sessionFile },
        stderr: "ignore",
      }),
    );
  }, 150_000);

  afterAll(async () => {
    await client?.close();
    await game?.stop();
  });

  it("offers the session's four tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["collect_sun", "get_state", "place_plant", "wait"]);
  });

  it("get_state shows the level as a player sees it", async () => {
    const { text, isError } = await call("get_state");
    expect(isError).toBe(false);
    expect(text).toContain("Level 1-1 (day). Game time 0.0 s.");
    expect(text).toContain("- peashooter: 100 sun. Ready.");
  });

  it("place_plant plants in the real game", async () => {
    const { text, isError } = await call("place_plant", { plant: "peashooter", col: 0, row: 2 });
    expect(isError, text).toBe(false);
    expect(text).toMatch(/^row 2 {2}P \. \. \. \. \. \. \. \.$/m);
    const state = await api.state();
    expect(state.board.plants).toEqual([expect.objectContaining({ type: "peashooter", col: 0, row: 2 })]);
    expect(state.board.sun).toBe(50);
  });

  it("place_plant passes on the game's refusal", async () => {
    const { text, isError } = await call("place_plant", { plant: "peashooter", col: 1, row: 2 });
    expect(isError).toBe(true);
    expect(text).toBe("Not planted: peashooter isn't ready: it's still recharging (0% done).");
  });

  it("wait lets exactly the game time asked for pass, at the session's speed", async () => {
    const before = (await api.state()).board.gameTicks;
    const { text } = await call("wait", { seconds: 2 });
    expect(text.split("\n")[0]).toBe("2 s passed.");
    const after = await api.state();
    expect(after.board.gameTicks - before).toBe(200);
    expect(after.clock.speed).toBe(50);
  });

  it("collect_sun collects the sun that falls", async () => {
    let state = await api.state();
    for (let i = 0; i < 20 && !state.board.suns.some((sun: { beingCollected: boolean }) => !sun.beingCollected); i++) {
      await call("wait", { seconds: 1 });
      state = await api.state();
    }
    const { text, isError } = await call("collect_sun");
    expect(isError).toBe(false);
    expect(text.split("\n")[0]).toBe("Collected 1 sun worth 25.");
    expect((await api.state()).board.sunSpendable).toBe(state.board.sunSpendable + 25);
  });
});
