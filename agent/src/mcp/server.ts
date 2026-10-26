// The MCP server Claude Code starts for a play session. MCP messages travel over stdin and stdout,
// so anything meant for people goes to stderr.
//
// Environment:
//   PVZ_SESSION  the session file: level, clock, speed and tools (required)
//   PVZ_API_URL  the game's local API (default http://127.0.0.1:7310)
//   PVZ_LOG      a file to append every tool call to, one JSON line each (optional)
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GameClient } from "../game-client.ts";
import { loadSession } from "../session.ts";
import { registerTools } from "./tools.ts";

const { PVZ_SESSION, PVZ_API_URL, PVZ_LOG } = process.env;
if (!PVZ_SESSION) {
  console.error("pvz MCP server: set PVZ_SESSION to a session file, e.g. sessions/1-1-single-actions.json");
  process.exit(1);
}

const session = await loadSession(PVZ_SESSION);
const game = new GameClient(PVZ_API_URL ?? "http://127.0.0.1:7310");
const server = new McpServer({ name: "pvz", version: "0.1.0" });

registerTools(server, session.settings.tools, {
  game,
  clock: session.settings.clock,
  speed: session.settings.speed,
  log: PVZ_LOG ? (entry) => appendFileSync(PVZ_LOG, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`) : undefined,
});

await server.connect(new StdioServerTransport());
console.error(`pvz MCP server: tools ${session.settings.tools.join(", ")}; game at ${game.baseUrl}`);
