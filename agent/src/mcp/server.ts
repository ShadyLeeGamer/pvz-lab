// The MCP server the player uses. MCP messages travel over stdin and stdout, so anything meant for
// people goes to stderr. It runs in three ways:
// - from pnpm match and pnpm play, which start the game and the level themselves and give the server
//   the game's address;
// - from a chat app such as Claude Desktop, with a session that offers start_level: the server starts
//   its own copy of the game at the first start_level, closes it when the app closes the server, and
//   gives the app the session's instructions and a play_level prompt;
// - for the zombie side of a versus level that's already started, with a session whose side is
//   "zombies": it gives the app the session's instructions and a play_zombies prompt.
//
// Environment:
//   PVZ_SESSION          the session file: side, tools, clock, speed and brief (required)
//   PVZ_API_URL          the address of a game that's already running, as pnpm match and pnpm play set it
//   PVZ_LOG              a file to append every tool call to, one JSON line each (optional)
//   PVZ_NO_INSTRUCTIONS  1 when the player already has the brief as its system prompt, as pnpm match
//                        and pnpm play give it, so the server doesn't send it again (optional)
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeBrief } from "../brief.ts";
import { GameClient } from "../game-client.ts";
import { loadSession } from "../session.ts";
import { OwnGame } from "./own-game.ts";
import { createSeatServer } from "./seat-server.ts";

const { PVZ_SESSION, PVZ_API_URL, PVZ_LOG, PVZ_NO_INSTRUCTIONS } = process.env;
if (!PVZ_SESSION) {
  console.error("pvz MCP server: set PVZ_SESSION to a session file, e.g. sessions/chat.json");
  process.exit(1);
}

const session = await loadSession(PVZ_SESSION);
const { side, tools, clock, speed } = session.settings;
const chat = tools.includes("start_level");
if (!PVZ_API_URL && !chat) {
  console.error(
    "pvz MCP server: this session plays a level that's already started (pnpm match and pnpm play start it), so set PVZ_API_URL to the game's address. " +
      "For a chat app, use a session with start_level, e.g. sessions/chat.json",
  );
  process.exit(1);
}

const ownGame = PVZ_API_URL ? undefined : new OwnGame();
const game = ownGame ?? new GameClient(PVZ_API_URL!);
const brief = writeBrief(await readFile(session.briefPath, "utf8"), session.settings);
// Chat sessions and the zombie side send the brief here, for apps whose system prompt nobody sets. A
// player that pnpm match or pnpm play starts has it as its system prompt already (D47).
const sendsBrief = (chat || side === "zombies") && PVZ_NO_INSTRUCTIONS !== "1";
const server = createSeatServer(session.settings, brief, {
  game,
  starter: ownGame,
  clock,
  speed,
  log: PVZ_LOG ? (entry: Record<string, unknown>) => appendFileSync(PVZ_LOG, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`) : undefined,
}, sendsBrief);

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
