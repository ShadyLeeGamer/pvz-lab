// The zombie side's MCP tools, called through a real MCP client and server. The game is the stand-in
// from tools.test.ts, replaying the zombie seat's real views and the game's own replies to sendZombie.
// The end-to-end tests check the same tools against the real game.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { Game } from "../src/game-client.ts";
import { registerZombieTools } from "../src/mcp/zombie-tools.ts";
import { fixture, reply } from "./fixtures/fixture.ts";
import { StandInGame } from "./stand-in-game.ts";

async function connect(game: Game, speed = 1): Promise<Client> {
  const server = new McpServer({ name: "pvz", version: "test" });
  registerZombieTools(server, ["get_state", "send_zombie", "wait"], { game, clock: "realtime", speed });
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

describe("zombie tools", () => {
  it("get_state shows the zombie seat's own view, never the player's", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"));
    const { text } = await call(await connect(game), "get_state");
    expect(game.views).toEqual(["zombies"]);
    expect(text).toContain("- row 0: conehead_zombie walking in from the right");
  });

  it("send_zombie sends the zombie named, by the game's name for it, into the row asked for", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"));
    const { text, isError } = await call(await connect(game), "send_zombie", { zombie: "Conehead Zombie", row: 2 });
    expect(isError).toBe(false);
    expect(game.actions).toEqual([{ type: "sendZombie", zombie: "conehead_zombie", row: 2 }]);
    expect(game.views.every((view) => view === "zombies")).toBe(true);
    // The recorded reply left 0 points, and the state after says the payday is wave 4.
    expect(text.split("\n")[0]).toBe("Sent a conehead_zombie into row 2. 0 points left for wave 4.");
    expect(text).toContain("Each row's defence:");
  });

  it("send_zombie aims a bungee at the column asked for", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"));
    const { text } = await call(await connect(game), "send_zombie", { zombie: "bungee_zombie", row: 1, col: 4 });
    expect(game.actions).toEqual([{ type: "sendZombie", zombie: "bungee_zombie", row: 1, col: 4 }]);
    expect(text.split("\n")[0]).toBe("Sent a bungee_zombie onto column 4, row 1. 0 points left for wave 4.");
  });

  it("send_zombie says when a zombie is held for a huge wave", async () => {
    const game = new StandInGame(fixture("1-9-versus-warning"));
    game.replies.sendZombie = reply("zombie-held");
    const { text } = await call(await connect(game), "send_zombie", { zombie: "conehead_zombie", row: 1 });
    expect(text.split("\n")[0]).toBe("Held a conehead_zombie to go into row 1 when wave 10 arrives with its flag zombie. 7 points left for wave 10.");
  });

  it("send_zombie passes on the game's reason when it refuses", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"));
    game.replies.sendZombie = reply("zombie-refused");
    expect(await call(await connect(game), "send_zombie", { zombie: "zombie", row: 1 })).toEqual({
      isError: true,
      text: "Not sent: zombie costs 1 and there are 0 points left to spend on wave 1.",
    });
    game.replies.sendZombie = reply("not-versus");
    expect(await call(await connect(game), "send_zombie", { zombie: "zombie", row: 1 })).toEqual({
      isError: true,
      text: "Not sent: this level isn't being played in versus.",
    });
  });

  it("send_zombie sends nothing once the level is over, and says who won", async () => {
    const game = new StandInGame(fixture("1-1-won"));
    expect(await call(await connect(game), "send_zombie", { zombie: "zombie", row: 2 })).toEqual({
      isError: true,
      text: "The plants held out and won level 1-1. The level is over, so you can stop playing.",
    });
    expect(game.actions).toEqual([]);
  });

  it("wait ends early when a wave pays, and says when it's a huge wave", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"), fixture("1-9-versus-midgame"), fixture("1-9-versus-warning"));
    const started = Date.now();
    const { text } = await call(await connect(game), "wait", { seconds: 30 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(text.split("\n")[0]).toBe("Wave 10 paid you 7 points. It's a huge wave: zombies you send now are held, and walk on with its flag zombie.");
  });

  it("wait lets its seconds pass at the session's speed when no wave pays", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"));
    const started = Date.now();
    // 2 s of game time at 4 times normal speed is half a second.
    const { text } = await call(await connect(game, 4), "wait", { seconds: 2 });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(450);
    expect(took).toBeLessThan(1500);
    expect(text.split("\n")[0]).toBe("2 s passed.");
  });

  it("wait ends when the level does, with the result told from the zombies' side", async () => {
    const game = new StandInGame(fixture("1-9-versus-midgame"), fixture("1-2-versus-lost"));
    expect((await call(await connect(game), "wait", { seconds: 30 })).text).toBe(
      "Your zombies got into the house: you won level 1-2! The level is over, so you can stop playing.",
    );
  });
});
