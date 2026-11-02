// The zombie side's MCP server against the real game: an MCP client starts the server the way Claude
// Code does (a child process talking over stdin and stdout) with a zombie session, and plays the
// zombies of 1-2 in versus while the test runs the game's clock.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchGame, readGameConfig, type RunningGame } from "../../src/game-process.ts";
import { GameApi, type Json } from "./api.ts";

const serverScript = fileURLToPath(new URL("../../src/mcp/server.ts", import.meta.url));
// The zombies of 1-2 at normal speed. The test steps the clock, so a wait lasts until the test steps
// past whatever ends it.
const sessionFile = fileURLToPath(new URL("./zombie-session.json", import.meta.url));

// Gives a tool call that's just been made time to read the game before the test moves the clock on.
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("the zombie side's MCP tools on 1-2 in versus (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;
  let api: GameApi;
  let client: Client;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content[0]?.text ?? "", isError: result.isError === true };
  }

  const stepUntil = (done: (state: Json) => boolean) => api.stepUntil(done, { ticks: 50, speed: 50, maxSteps: 4000 });

  beforeAll(async () => {
    game = await launchGame(readGameConfig());
    api = new GameApi(game.baseUrl);
    const started = await api.control({ type: "startLevel", level: "1-2", versus: true });
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

  it("offers the zombie side's three tools, its brief, and a play_zombies prompt", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_state", "send_zombie", "wait"]);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual(["play_zombies"]);
    expect(client.getInstructions()).toContain("You are playing the zombies in Plants vs. Zombies, Adventure level 1-2");
  });

  it("get_state shows the zombie seat's view before the first payday", async () => {
    const { text, isError } = await call("get_state");
    expect(isError).toBe(false);
    expect(text).toContain("Level 1-2 (day). Game time 0.0 s.");
    expect(text).toContain("Your points: none yet. The first wave pays you when it arrives.");
    expect(text).toContain("- zombie: 1 point. No points yet.");
    expect(text).toContain("- row 0 (dirt): no zombie can walk here.");
  });

  it("wait ends early when the first wave pays", async () => {
    const waiting = call("wait", { seconds: 30 });
    await settle();
    await stepUntil((state) => state.versus.wave >= 1);
    expect((await waiting).text.split("\n")[0]).toBe("Wave 1 paid you 1 point.");
  });

  it("send_zombie sends a zombie into its row in the real game, and passes on the game's refusal", async () => {
    const sent = await call("send_zombie", { zombie: "zombie", row: 2 });
    expect(sent.text.split("\n")[0]).toBe("Sent a zombie into row 2. 0 points left for wave 1.");
    const full = await api.state("full");
    expect(full.board.zombies.filter((z: Json) => full.versus.sentIds.includes(z.id))).toEqual([expect.objectContaining({ type: "zombie", row: 2 })]);

    expect(await call("send_zombie", { zombie: "zombie", row: 1 })).toEqual({
      isError: true,
      text: "Not sent: zombie costs 1 and there are 0 points left to spend on wave 1.",
    });
  });

  it("holds a zombie sent during the final wave's warning", async () => {
    await stepUntil((state) => state.board.progress.hugeWaveIncoming && state.board.progress.wave === 5);
    const { text, isError } = await call("send_zombie", { zombie: "zombie", row: 1 });
    expect(isError, text).toBe(false);
    expect(text.split("\n")[0]).toMatch(/^Held a zombie to go into row 1 when wave 6 arrives with its flag zombie\. \d+ points? left for wave 6\.$/);
    expect(text).toContain("Held to walk on with wave 6's flag zombie: zombie in row 1.");
  });

  it("wait ends when the level does, and says who won", async () => {
    const waiting = call("wait", { seconds: 30 });
    await settle();
    await stepUntil((state) => !state.board || state.board.result !== "playing");
    expect((await waiting).text).toMatch(
      /^(Your zombies got into the house: you won level 1-2!|The plants held out and won level 1-2\.) The level is over, so you can stop playing\.$/,
    );
  });
});
