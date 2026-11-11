// The plants' MCP tools, called through a real MCP client and server. The game is a stand-in that
// replays states and replies captured from the real game and records every request, so these tests
// check what the tools send and say. The end-to-end tests check the same tools against the real game.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { Game } from "../../src/game-client.ts";
import type { GameStarter } from "../../src/mcp/own-game.ts";
import { Lobby, NO_READY_CHECK, NOT_READY, sleep } from "../../src/mcp/shared.ts";
import { registerPlantTools } from "../../src/plants/tools.ts";
import type { ToolName } from "../../src/session.ts";
import { fixture, fixtureAt, reply, savedReply } from "../fixtures/fixture.ts";
import { StandInGame } from "../stand-in-game.ts";

// Stands in for the server's own game in a chat app: it only records that it was started.
class StandInStarter implements GameStarter {
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }
}

const ALL_TOOLS: ToolName[] = ["get_state", "place_plant", "dig_up", "collect_sun", "wait"];

interface Options {
  clock?: "waits" | "realtime";
  speed?: number;
  starter?: GameStarter;
  lobby?: Lobby;
}

async function connect(game: Game, tools = ALL_TOOLS, options: Options = {}): Promise<Client> {
  const server = new McpServer({ name: "pvz", version: "test" });
  registerPlantTools(server, tools, { game, clock: options.clock ?? "waits", speed: options.speed ?? 1, starter: options.starter, lobby: options.lobby });
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

  it("dig_up asks the game to dig up the tile's plant, and says which plant came up", async () => {
    const game = new StandInGame(fixture("1-8-midgame"));
    const { text, isError } = await call(await connect(game), "dig_up", { col: 0, row: 0 });
    expect(isError).toBe(false);
    expect(game.actions).toEqual([{ type: "digUp", col: 0, row: 0 }]);
    expect(text.split("\n")[0]).toBe("Dug up the sunflower at column 0, row 0.");
    expect(text).toContain("Level 1-8 (day)");
  });

  it("dig_up passes a named plant on in the game's names", async () => {
    const game = new StandInGame(fixture("1-8-midgame"));
    await call(await connect(game), "dig_up", { col: 3, row: 2, plant: "Lily Pad" });
    expect(game.actions).toEqual([{ type: "digUp", col: 3, row: 2, plant: "lily_pad" }]);
  });

  it("dig_up passes on the game's refusal", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const client = await connect(game);
    game.replies.digUp = reply("no-shovel");
    expect(await call(client, "dig_up", { col: 0, row: 2 })).toEqual({ text: "Not dug up: there's no shovel in this level.", isError: true });
    game.replies.digUp = reply("nothing-to-dig");
    expect(await call(client, "dig_up", { col: 8, row: 4 })).toEqual({ text: "Not dug up: there's nothing to dig up at column 8, row 4.", isError: true });
  });

  it("tells a player that can dig when the level has no shovel", async () => {
    const withShovelTool = await call(await connect(new StandInGame(fixture("1-1-start"))), "get_state");
    expect(withShovelTool.text).toContain("This level has no shovel, so nothing can be dug up.");
    const without = await call(await connect(new StandInGame(fixture("1-1-start")), ["get_state"]), "get_state");
    expect(without.text).not.toContain("shovel");
  });

  it("collect_sun reports what it collected", async () => {
    const game = new StandInGame(fixture("1-8-midgame"));
    const { text } = await call(await connect(game), "collect_sun");
    expect(game.actions).toEqual([{ type: "collectSun" }]);
    // The recording has two suns or more (capture.ts makes sure), and changes each time it's made.
    const { collected, value } = savedReply("suns-collected").body as { collected: number; value: number };
    expect(text.split("\n")[0]).toBe(`Collected ${collected} suns worth ${value}.`);
  });

  it("wait runs exactly the game time asked for while the game is paused, at the session's speed", async () => {
    const game = new StandInGame(fixture("1-1-zombie"));
    const { text } = await call(await connect(game, ALL_TOOLS, { clock: "waits", speed: 7 }), "wait", { seconds: 2.5 });
    expect(game.controls).toEqual([{ type: "step", ticks: 250, speed: 7 }]);
    expect(text.split("\n")[0]).toBe("2.5 s passed.");
  });

  it("in real time, wait only waits, for the game seconds asked for at the session's speed, and says how many passed", async () => {
    // By the time the wait looks again, the game has moved on 0.57 s.
    const game = new StandInGame(fixture("1-1-zombie"), fixtureAt("1-1-zombie", 1501 + 57));
    const client = await connect(game, ALL_TOOLS, { clock: "realtime", speed: 10 });
    const start = performance.now();
    const { text } = await call(client, "wait", { seconds: 0.5 });
    const elapsed = performance.now() - start;
    expect(game.controls).toEqual([]);
    expect(text.split("\n")[0]).toBe("0.6 s passed.");
    // 0.5 s of game time at 10x is 50 ms; unscaled it would be 500 ms.
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(400);
  });

  it("in real time, wait goes by the game's clock: it waits on while game time stands still, as at a match's start", async () => {
    // 8 s of game time at 50x takes 160 ms, but the game was frozen for part of it: only 5.8 s had passed
    // when the wait looked, so it waits on for the rest.
    const game = new StandInGame(fixture("1-1-zombie"), fixtureAt("1-1-zombie", 1501 + 580), fixtureAt("1-1-zombie", 1501 + 800));
    const { text } = await call(await connect(game, ALL_TOOLS, { clock: "realtime", speed: 50 }), "wait", { seconds: 8 });
    expect(game.views).toHaveLength(3);
    expect(text.split("\n")[0]).toBe("8 s passed.");
    expect(text).toContain("Game time 23.0 s.");
  });

  it("in real time, a wait that sees the win collects the award and says the level is over", async () => {
    const game = new StandInGame(fixture("1-1-zombie"), fixtureAt("1-1-won", 1501 + 50), fixture("award-screen"));
    const { text } = await call(await connect(game, ALL_TOOLS, { clock: "realtime", speed: 50 }), "wait", { seconds: 1 });
    expect(game.actions).toEqual([{ type: "collectAward" }]);
    expect(text).toBe("0.5 s passed.\n\nYou won level 1-1! The level is over, so you can stop playing.");
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
    expect(await descriptions("waits")).toEqual(Array(4).fill(expect.stringContaining("Game time doesn't move.")));
    for (const description of await descriptions("realtime")) expect(description).not.toContain("Game time doesn't move");
  });

  it("refuses moves once the level is over", async () => {
    const game = new StandInGame(fixture("award-screen"));
    const client = await connect(game);
    const over = { text: "You won the level! The level is over, so you can stop playing.", isError: true };
    expect(await call(client, "place_plant", { plant: "peashooter", col: 0, row: 2 })).toEqual(over);
    expect(await call(client, "dig_up", { col: 0, row: 2 })).toEqual(over);
    expect(game.actions).toEqual([]);
  });
});

describe("choose_seeds, for a level someone else started", () => {
  const MATCH_TOOLS: ToolName[] = ["choose_seeds", ...ALL_TOOLS];
  const SEEDS = ["peashooter", "sunflower", "cherry_bomb", "wall_nut", "potato_mine", "snow_pea"];

  it("is only offered when the session lists it", async () => {
    const offered = async (tools: ToolName[]) => (await (await connect(new StandInGame(fixture("1-9-versus-chooser")), tools)).listTools()).tools.map((tool) => tool.name);
    expect(await offered(MATCH_TOOLS)).toContain("choose_seeds");
    expect(await offered(ALL_TOOLS)).not.toContain("choose_seeds");
  });

  it("shows what the level offers to bring, and what each costs, as the seed chooser does", async () => {
    const game = new StandInGame(fixture("1-9-versus-chooser"));
    game.controlReplies.chooseSeeds = reply("seeds-asked-at-chooser");
    const { text, isError } = await call(await connect(game, MATCH_TOOLS, { clock: "realtime" }), "choose_seeds");
    expect(game.controls).toEqual([{ type: "chooseSeeds", seeds: [] }]);
    expect(isError).toBe(false);
    expect(text).toBe(
      "The level asks you to choose 6 seed packets.\n" +
        "The street shows the zombies coming in this level: zombie, conehead_zombie, pole_vaulting_zombie, buckethead_zombie.\n" +
        "You can choose from: peashooter (100 sun), sunflower (50 sun), cherry_bomb (150 sun), wall_nut (50 sun), " +
        "potato_mine (25 sun), snow_pea (175 sun), chomper (150 sun), repeater (200 sun).\n" +
        "Call choose_seeds again with the 6 you pick.",
    );
  });

  it("says why the game didn't take the seeds given, with the choices again", async () => {
    const game = new StandInGame(fixture("1-9-versus-chooser"));
    game.controlReplies.chooseSeeds = reply("seeds-refused-at-chooser");
    const { text, isError } = await call(await connect(game, MATCH_TOOLS, { clock: "realtime" }), "choose_seeds", { seeds: ["peashooter"] });
    expect(isError).toBe(true);
    expect(text.split("\n")[0]).toBe('Not chosen: this level makes you choose 6 seeds; "seeds" has 1.');
    expect(text).toContain("Call choose_seeds again with the 6 you pick.");
  });

  it("picks the seeds in the game's names, then shows the game with the zombie side's points", async () => {
    const game = new StandInGame(fixture("1-9-versus-plants"));
    game.controlReplies.chooseSeeds = reply("seeds-chosen");
    const named = ["Peashooter", "Sunflower", "Cherry Bomb", "Wall-nut", "Potato Mine", "Snow Pea"];
    const { text, isError } = await call(await connect(game, MATCH_TOOLS, { clock: "realtime" }), "choose_seeds", { seeds: named });
    expect(game.controls).toEqual([{ type: "chooseSeeds", seeds: SEEDS }]);
    expect(isError).toBe(false);
    expect(text.split("\n")[0]).toBe(`Chose ${SEEDS.join(", ")}. Play is starting.`);
    expect(text).toContain("The zombie side has 1 point left to spend on wave 1.");
  });

  it("says when there's no seed chooser to pick from", async () => {
    const game = new StandInGame(fixture("1-9-versus-plants"));
    game.controlReplies.chooseSeeds = reply("not-at-seed-chooser");
    const { text, isError } = await call(await connect(game, MATCH_TOOLS, { clock: "realtime" }), "choose_seeds", { seeds: SEEDS });
    expect(isError).toBe(true);
    expect(text).toBe("There's no seed chooser open: the seed packets are already chosen.");
  });
});

describe("before a match with a player on each side starts (D62)", () => {
  const MATCH_TOOLS: ToolName[] = ["choose_seeds", "ready", ...ALL_TOOLS];
  const SEEDS = ["peashooter", "sunflower", "cherry_bomb", "wall_nut", "potato_mine", "snow_pea"];
  const zombiesReady = () => {
    const lobby = new Lobby(["plants", "zombies"]);
    lobby.markReady("zombies");
    return lobby;
  };
  // Starts the match as the host does, once the plants have said they're ready.
  const startOnReady = async (lobby: Lobby) => {
    while (!lobby.isReady("plants")) await sleep(10);
    lobby.start();
  };

  it("refuses the plants' moves until they're ready, while get_state shows the game under why", async () => {
    const game = new StandInGame(fixture("1-9-versus-plants"));
    const client = await connect(game, MATCH_TOOLS, { clock: "realtime", lobby: zombiesReady() });
    for (const [tool, args] of [
      ["place_plant", { plant: "peashooter", col: 0, row: 2 }],
      ["dig_up", { col: 0, row: 2 }],
      ["collect_sun", {}],
      ["wait", { seconds: 5 }],
    ] as const) {
      expect(await call(client, tool, args), tool).toEqual({ isError: true, text: NOT_READY });
    }
    expect(game.actions).toEqual([]);
    const { text, isError } = await call(client, "get_state");
    expect(isError).toBe(false);
    expect(text.split("\n\n")[0]).toBe(NOT_READY);
    expect(text).toContain("Seed packets:");
  });

  it("lets the plants choose their seeds, then says to call ready", async () => {
    const game = new StandInGame(fixture("1-9-versus-plants"));
    game.controlReplies.chooseSeeds = reply("seeds-chosen");
    const { text, isError } = await call(await connect(game, MATCH_TOOLS, { clock: "realtime", lobby: zombiesReady() }), "choose_seeds", { seeds: SEEDS });
    expect(isError).toBe(false);
    expect(text.split("\n")[0]).toBe(`Chose ${SEEDS.join(", ")}. Call ready once you're set: the match starts when every player is ready.`);
  });

  it("ready waits for the seed packets to be chosen first", async () => {
    const lobby = zombiesReady();
    const { text, isError } = await call(await connect(new StandInGame(fixture("1-9-versus-chooser")), MATCH_TOOLS, { clock: "realtime", lobby }), "ready");
    expect({ text, isError }).toEqual({ isError: true, text: "Choose your seed packets with choose_seeds first: the level is waiting for them." });
    expect(lobby.isReady("plants")).toBe(false);
  });

  it("ready says the plants are ready, waits for the match to start, then shows the game, and moves go through", async () => {
    const lobby = zombiesReady();
    const game = new StandInGame(fixture("1-9-versus-plants"));
    const client = await connect(game, MATCH_TOOLS, { clock: "realtime", lobby });
    const [{ text, isError }] = await Promise.all([call(client, "ready"), startOnReady(lobby)]);
    expect(isError).toBe(false);
    expect(text.split("\n\n")[0]).toBe("Everyone's ready: the match has started.");
    expect(text).toContain("Seed packets:");
    expect((await call(client, "place_plant", { plant: "peashooter", col: 0, row: 2 })).isError).toBe(false);
    expect(game.actions.map((action) => action.type)).toEqual(["placePlant"]);
  });

  it("once ready, a move says whom the match waits for, and wait waits for the start", async () => {
    const lobby = new Lobby(["plants", "zombies"]);
    lobby.markReady("plants");
    const game = new StandInGame(fixture("1-9-versus-plants"));
    const client = await connect(game, MATCH_TOOLS, { clock: "realtime", lobby });
    expect(await call(client, "collect_sun")).toEqual({
      isError: true,
      text: "The match hasn't started yet: it's waiting for the zombies' player. Call wait to wait for the start.",
    });
    const [{ text, isError }] = await Promise.all([call(client, "wait", { seconds: 30 }), sleep(50).then(() => lobby.start())]);
    expect(isError).toBe(false);
    expect(text.split("\n\n")[0]).toBe("Everyone's ready: the match has started.");
    expect(game.controls).toEqual([]);
  });

  it("without a ready check, ready says so", async () => {
    expect(await call(await connect(new StandInGame(fixture("1-9-versus-plants")), ["ready", ...ALL_TOOLS], { clock: "realtime" }), "ready")).toEqual({
      isError: false,
      text: NO_READY_CHECK,
    });
  });
});

describe("start_level, for chat apps", () => {
  const CHAT_TOOLS: ToolName[] = ["start_level", ...ALL_TOOLS];
  const NO_GAME_YET = "No level is being played yet. Start one with start_level.";

  it("starts the game and the level asked for, paused, and shows it", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const starter = new StandInStarter();
    const { text, isError } = await call(await connect(game, CHAT_TOOLS, { starter }), "start_level", { level: "1-1" });
    expect(starter.started).toBe(true);
    expect(game.controls).toEqual([{ type: "startLevel", level: "1-1", then: "freeze" }]);
    expect(isError).toBe(false);
    expect(text.split("\n").slice(0, 3)).toEqual([
      "Level 1-1 started. The game is paused while you think.",
      "The street shows the zombies coming in this level: zombie.",
      "",
    ]);
    expect(text).toContain("Level 1-1 (day)");
  });

  it("in real time, also starts the clock at the session's speed", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const { text } = await call(await connect(game, CHAT_TOOLS, { clock: "realtime", speed: 3 }), "start_level", { level: "1-1" });
    expect(game.controls).toEqual([{ type: "startLevel", level: "1-1", then: "freeze" }, { type: "run", speed: 3 }]);
    expect(text.split("\n")[0]).toBe("Level 1-1 started. The game is running.");
  });

  it("shows what a level offers to bring, and what each costs, as the seed chooser does", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    game.controlReplies.startLevel = reply("seeds-asked");
    const { text, isError } = await call(await connect(game, CHAT_TOOLS), "start_level", { level: "1-8" });
    expect(isError).toBe(false);
    expect(text).toBe(
      "Level 1-8 asks you to choose 6 seed packets first.\n" +
        "The street shows the zombies coming in this level: zombie, conehead_zombie, buckethead_zombie.\n" +
        "You can choose from: peashooter (100 sun), sunflower (50 sun), cherry_bomb (150 sun), wall_nut (50 sun), " +
        "potato_mine (25 sun), snow_pea (175 sun), chomper (150 sun).\n" +
        "Call start_level again with the 6 you pick.",
    );
  });

  it("passes the seeds on in the game's names", async () => {
    const game = new StandInGame(fixture("1-8-start"));
    await call(await connect(game, CHAT_TOOLS), "start_level", { level: "1-8", seeds: ["Wall-nut", "Snow Pea"] });
    expect(game.controls).toEqual([{ type: "startLevel", level: "1-8", seeds: ["wall_nut", "snow_pea"], then: "freeze" }]);
  });

  it("says when a level isn't supported yet", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    game.controlReplies.startLevel = reply("crazy-dave");
    const { text, isError } = await call(await connect(game, CHAT_TOOLS), "start_level", { level: "2-1" });
    expect(isError).toBe(true);
    expect(text).toBe("Level 2-1 isn't supported yet: it opens with Crazy Dave talking.");
  });

  it("before the first level, the other tools say to start one, and nothing reaches the game", async () => {
    const game = new StandInGame(fixture("1-1-start"));
    const client = await connect(game, CHAT_TOOLS, { starter: new StandInStarter() });
    expect(await call(client, "get_state")).toEqual({ text: NO_GAME_YET, isError: false });
    expect(await call(client, "place_plant", { plant: "peashooter", col: 0, row: 2 })).toEqual({ text: NO_GAME_YET, isError: true });
    expect(await call(client, "dig_up", { col: 0, row: 2 })).toEqual({ text: NO_GAME_YET, isError: true });
    expect(await call(client, "wait", { seconds: 1 })).toEqual({ text: NO_GAME_YET, isError: true });
    expect(game.actions).toEqual([]);
    expect(game.controls).toEqual([]);
  });
});
