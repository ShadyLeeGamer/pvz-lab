// The MCP server the way a chat app such as Claude Desktop runs it: a session with start_level and no
// game address, so the server starts its own game at the first start_level and closes it when the
// app closes the server.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const serverScript = fileURLToPath(new URL("../../src/mcp/server.ts", import.meta.url));
// Its own session (paused clock, every tool), so changing sessions/chat.json to play differently
// doesn't change what's tested.
const sessionFile = fileURLToPath(new URL("./chat-session.json", import.meta.url));
const NO_GAME_YET = "No level is being played yet. Start one with start_level.";

describe("the MCP server in a chat app (starts its own game; needs agent/.env)", () => {
  let client: Client;
  let gameUrl: string | undefined;
  let serverLog = "";

  async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content[0]?.text ?? "", isError: result.isError === true };
  }

  beforeAll(async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "PVZ_API_URL"),
    );
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverScript], env: { ...env, PVZ_SESSION: sessionFile }, stderr: "pipe" });
    // The server says on stderr where its game is once it has started one, and when it closes it.
    transport.stderr?.on("data", (chunk) => {
      serverLog += String(chunk);
      gameUrl ??= /started the game at (\S+)/.exec(serverLog)?.[1];
    });
    client = new Client({ name: "e2e-chat", version: "test" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it("gives the app the session's instructions and a play_level prompt", async () => {
    expect(client.getInstructions()).toContain("Start a level with start_level.");
    const prompt = await client.getPrompt({ name: "play_level", arguments: { level: "2-7" } });
    expect(JSON.stringify(prompt.messages)).toContain("Start level 2-7 with start_level and play it to the end on your own.");
  });

  it("before a level, says to start one, and doesn't start the game", async () => {
    expect(await call("get_state")).toEqual({ text: NO_GAME_YET, isError: false });
    expect(gameUrl).toBeUndefined();
  });

  it("starts its own game at start_level, asks for seeds the way the level does, then plays", async () => {
    const asked = await call("start_level", { level: "1-8" });
    expect(asked.isError, asked.text).toBe(false);
    expect(asked.text.split("\n")[0]).toBe("Level 1-8 asks you to choose 6 seed packets first.");
    expect(asked.text).toContain("sunflower (50 sun)");
    expect(asked.text).toMatch(/^The street shows the zombies coming in this level: zombie, .+\.$/m);
    expect(gameUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const seeds = ["sunflower", "peashooter", "wall_nut", "potato_mine", "cherry_bomb", "snow_pea"];
    const started = await call("start_level", { level: "1-8", seeds });
    expect(started.text.split("\n")[0], started.text).toBe("Level 1-8 started. The game is paused while you think.");
    const planted = await call("place_plant", { plant: "sunflower", col: 0, row: 2 });
    expect(planted.text.split("\n")[0], planted.text).toBe("Planted a sunflower at column 0, row 2.");
    const dug = await call("dig_up", { col: 0, row: 2 });
    expect(dug.text.split("\n")[0], dug.text).toBe("Dug up the sunflower at column 0, row 2.");
    expect(dug.text).toMatch(/^row 2 {2}\. \. \. \. \. \. \. \. \.$/m);
  }, 120_000);

  it("closes its game, tidily, when the app closes the server", async () => {
    expect((await fetch(`${gameUrl}/health`)).ok).toBe(true);
    await client.close();
    // Closed by the server itself (which also removes the game's temporary save folder), not just
    // taken down with it when the app gives up and kills the server.
    expect(serverLog).toContain("closed the game");
    await expect
      .poll(
        async () =>
          fetch(`${gameUrl}/health`).then(
            () => "answering",
            () => "closed",
          ),
        { timeout: 15_000 },
      )
      .toBe("closed");
  }, 30_000);
});
