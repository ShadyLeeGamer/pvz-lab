// The MCP server the player uses. MCP messages travel over stdin and stdout, so anything meant for
// people goes to stderr. It runs in three ways:
// - from pnpm play, which starts the game and the level itself and gives the server the game's address;
// - from a chat app such as Claude Desktop, with a session that offers start_level: the server starts
//   its own copy of the game at the first start_level, closes it when the app closes the server, and
//   gives the app the session's instructions and a play_level prompt;
// - for the zombie side of a versus level that's already started, with a session whose side is
//   "zombies": it gives the app the session's instructions and a play_zombies prompt.
//
// Environment:
//   PVZ_SESSION  the session file: side, tools, clock, speed and brief (required)
//   PVZ_API_URL  the address of a game that's already running, as pnpm play sets it
//   PVZ_LOG      a file to append every tool call to, one JSON line each (optional)
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeBrief } from "../brief.ts";
import { GameClient } from "../game-client.ts";
import { registerPlantTools } from "../plants/tools.ts";
import { loadSession } from "../session.ts";
import { registerZombieTools } from "../zombies/tools.ts";
import { OwnGame } from "./own-game.ts";

const { PVZ_SESSION, PVZ_API_URL, PVZ_LOG } = process.env;
if (!PVZ_SESSION) {
  console.error("pvz MCP server: set PVZ_SESSION to a session file, e.g. sessions/chat.json");
  process.exit(1);
}

const session = await loadSession(PVZ_SESSION);
const { side, tools, clock, speed } = session.settings;
const chat = tools.includes("start_level");
if (!PVZ_API_URL && !chat) {
  console.error(
    "pvz MCP server: this session plays a level that's already started (pnpm play starts it), so set PVZ_API_URL to the game's address. " +
      "For a chat app, use a session with start_level, e.g. sessions/chat.json",
  );
  process.exit(1);
}

const ownGame = PVZ_API_URL ? undefined : new OwnGame();
const game = ownGame ?? new GameClient(PVZ_API_URL!);
const brief = writeBrief(await readFile(session.briefPath, "utf8"), session.settings);
// pnpm play hands the plants' player the brief itself (as its system prompt), so only chat sessions
// and the zombie side send it here.
const sendsBrief = chat || side === "zombies";
const server = new McpServer({ name: "pvz", version: "0.1.0" }, sendsBrief ? { instructions: brief } : undefined);

const context = {
  game,
  starter: ownGame,
  clock,
  speed,
  log: PVZ_LOG ? (entry: Record<string, unknown>) => appendFileSync(PVZ_LOG, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`) : undefined,
};
if (side === "zombies") registerZombieTools(server, tools, context);
else registerPlantTools(server, tools, context);

if (side === "zombies") {
  server.registerPrompt(
    "play_zombies",
    { title: "Play the zombies", description: "Plays the zombie side of the versus level being played, to the end." },
    () => ({ messages: [{ role: "user", content: { type: "text", text: `${brief}\nPlay the zombies until the level is over.` } }] }),
  );
}

if (chat) {
  server.registerPrompt(
    "play_level",
    {
      title: "Play a level",
      description: "Starts a Plants vs. Zombies Adventure level and plays it to the end.",
      argsSchema: { level: z.string().describe("The level, from 1-1 to 5-10, e.g. 2-7.") },
    },
    ({ level }) => ({
      messages: [{ role: "user", content: { type: "text", text: `${brief}\nStart level ${level} with start_level and play it to the end on your own.` } }],
    }),
  );
}

// An app shuts the server down by closing its stdin (or ending it); the game goes with it.
const shutDown = async (): Promise<void> => {
  await ownGame?.stop();
  process.exit(0);
};
process.stdin.on("end", shutDown);
process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);

await server.connect(new StdioServerTransport());
console.error(`pvz MCP server: ${side}; tools ${tools.join(", ")}; ${PVZ_API_URL ? `game at ${PVZ_API_URL}` : "starts its own game at the first start_level"}`);
