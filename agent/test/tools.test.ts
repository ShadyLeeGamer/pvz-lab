// The MCP tools, called through a real MCP client and server. The game is a stand-in that replays
// states and replies captured from the real game and records every request, so these tests check
// what the tools send and say. The end-to-end tests check the same tools against the real game.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { Action, Control, Game, GameState, Result } from "../src/game-client.ts";
import { normalizePlantName, registerTools } from "../src/mcp/tools.ts";
import type { ToolName } from "../src/session.ts";
import { fixture, reply } from "./fixtures/fixture.ts";

// Hands out the given states in order (the last one repeats), answers with the game's replies, and
// records what it's asked to do.
class StandInGame implements Game {
  readonly actions: Action[] = [];
  readonly controls: Control[] = [];
  readonly replies: Record<Action["type"], Result> = {
    placePlant: reply("placed"),
    collectSun: reply("suns-collected"),
    collectAward: reply("award-collected"),
  };
  private readonly states: GameState[];

  constructor(...states: GameState[]) {
    this.states = states;
  }

  async state(): Promise<GameState> {
    return this.states.length > 1 ? this.states.shift()! : this.states[0]!;
  }

  async act(action: Action): Promise<Result> {
    this.actions.push(action);
    return this.replies[action.type];
  }

  async control(command: Control): Promise<Result> {
    this.controls.push(command);
    return reply("stepped");
  }
}

const ALL_TOOLS: ToolName[] = ["get_state", "place_plant", "collect_sun", "wait"];

async function connect(game: Game, tools = ALL_TOOLS, time: { clock: "waits" | "realtime"; speed: number } = { clock: "waits", speed: 1 }): Promise<Client> {
  const server = new McpServer({ name: "pvz", version: "test" });
  registerTools(server, tools, { game, ...time });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "test" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: result.isError === true };
}

describe("MCP tools", () => {
  it("offers only the tools the session lists", async () => {
    const client = await connect(new StandInGame(fixture("1-1-start")), ["get_state", "wait"]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_state", "wait"]);
  });

  it("place_plant finds the packet by name and clicks the tile asked for", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const { text, isError } = await call(await connect(game), "place_plant", { plant: "Peashooter", col: 0, row: 2 });
    expect(isError).toBe(false);
    expect(game.actions).toEqual([{ type: "placePlant", slot: 0, col: 0, row: 2 }]);
    expect(text.split("\n")[0]).toBe("Planted a peashooter at column 0, row 2.");
    expect(text).toContain("Level 1-1 (day)");
  });

  it("place_plant picks the slot of the packet named, wherever it is in the bank", async () => {
    const game = new StandInGame(fixture("1-8-start"));
    await call(await connect(game), "place_plant", { plant: "wall nut", col: 4, row: 1 });
    expect(game.actions).toEqual([{ type: "placePlant", slot: 3, col: 4, row: 1 }]);
  });

  it("place_plant passes on the game's reason when the game refuses", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    game.replies.placePlant = reply("cant-plant-here");
    const { text, isError } = await call(await connect(game), "place_plant", { plant: "peashooter", col: 0, row: 0 });
    expect(isError).toBe(true);
    expect(text).toBe("Not planted: peashooter can't go at column 0, row 0: that tile is dirt, where nothing grows.");
  });

  it("place_plant passes on the game's own hint", async () => {
    // The stand-in answers with the recorded refusal (a mushroom on a gravestone), whatever is asked.
    const game = new StandInGame(fixture("1-1-start"));
    game.replies.placePlant = reply("game-hint");
    const { text, isError } = await call(await connect(game), "place_plant", { plant: "peashooter", col: 0, row: 2 });
    expect(isError).toBe(true);
    expect(text).toMatch(/^Not planted: puff_shroom can't go at column \d, row \d: You can't plant on graves\.$/);
  });

  it("place_plant names the packets you do have, without asking the game to plant", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const { text, isError } = await call(await connect(game), "place_plant", { plant: "sunflower", col: 1, row: 2 });
    expect(isError).toBe(true);
    expect(text).toBe("You don't have a sunflower seed packet. Your packets: peashooter.");
    expect(game.actions).toEqual([]);
  });

  it("never sends a tile off the lawn to the game", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const outcome = await call(await connect(game), "place_plant", { plant: "peashooter", col: 9, row: 2 }).catch((error: Error) => ({
      text: error.message,
      isError: true,
    }));
    expect(outcome.isError).toBe(true);
    expect(game.actions).toEqual([]);
  });

  it("collect_sun reports what it collected", async () => {
    const game = new StandInGame(fixture("1-8-midgame"));
    const { text } = await call(await connect(game), "collect_sun");
    expect(game.actions).toEqual([{ type: "collectSun" }]);
    expect(text.split("\n")[0]).toBe("Collected 2 suns worth 50.");
  });

  it("wait runs exactly the game time asked for while the game is paused, at the session's speed", async () => {
    const game = new StandInGame(fixture("1-1-zombie"));
    const { text } = await call(await connect(game, ALL_TOOLS, { clock: "waits", speed: 7 }), "wait", { seconds: 2.5 });
    expect(game.controls).toEqual([{ type: "step", ticks: 250, speed: 7 }]);
    expect(text.split("\n")[0]).toBe("2.5 s passed.");
  });

  it("in real time, wait only waits, for the game seconds asked for at the session's speed", async () => {
    const game = new StandInGame(fixture("1-1-zombie"));
    const client = await connect(game, ALL_TOOLS, { clock: "realtime", speed: 10 });
    const start = performance.now();
    const { text } = await call(client, "wait", { seconds: 0.5 });
    const elapsed = performance.now() - start;
    expect(game.controls).toEqual([]);
    expect(text.split("\n")[0]).toBe("0.5 s passed.");
    // 0.5 s of game time at 10x is 50 ms; unscaled it would be 500 ms.
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(400);
  });

  it("collects the award for Claude when a wait wins the level, then says to stop", async () => {
    const game = new StandInGame(fixture("1-1-zombie"), fixture("1-1-won"), fixture("award-screen"));
    const { text } = await call(await connect(game), "wait", { seconds: 1 });
    expect(game.actions).toEqual([{ type: "collectAward" }]);
    expect(text).toBe("1 s passed.\n\nYou won level 1-1! The level is over, so you can stop playing.");
  });

  it("in real time, whichever tool sees the win collects the award and says the level is over", async () => {
    const game = new StandInGame(fixture("1-1-won"), fixture("award-screen"));
    const { text } = await call(await connect(game, ALL_TOOLS, { clock: "realtime", speed: 1 }), "get_state");
    expect(game.actions).toEqual([{ type: "collectAward" }]);
    expect(text).toBe("You won level 1-1! The level is over, so you can stop playing.");
  });

  it("collect_sun says the level is over instead of collecting", async () => {
    const game = new StandInGame(fixture("award-screen"));
    const { text, isError } = await call(await connect(game), "collect_sun");
    expect(isError).toBe(true);
    expect(text).toBe("You won the level! The level is over, so you can stop playing.");
    expect(game.actions).toEqual([]);
  });

  it("only says game time stands still during a move when the clock pauses the game", async () => {
    const descriptions = async (clock: "waits" | "realtime") =>
      (await (await connect(new StandInGame(fixture("1-1-start")), ALL_TOOLS, { clock, speed: 1 })).listTools()).tools
        .filter((tool) => tool.name !== "wait")
        .map((tool) => tool.description ?? "");
    expect(await descriptions("waits")).toEqual(Array(3).fill(expect.stringContaining("Game time doesn't move.")));
    for (const description of await descriptions("realtime")) expect(description).not.toContain("Game time doesn't move");
  });

  it("refuses moves once the level is over", async () => {
    const game = new StandInGame(fixture("award-screen"));
    const { text, isError } = await call(await connect(game), "place_plant", { plant: "peashooter", col: 0, row: 2 });
    expect(isError).toBe(true);
    expect(text).toBe("You won the level! The level is over, so you can stop playing.");
    expect(game.actions).toEqual([]);
  });
});

describe("normalizePlantName", () => {
  it("accepts the ways people write plant names", () => {
    expect(normalizePlantName("Wall-nut")).toBe("wall_nut");
    expect(normalizePlantName("  cherry bomb ")).toBe("cherry_bomb");
    expect(normalizePlantName("snow_pea")).toBe("snow_pea");
  });
});
