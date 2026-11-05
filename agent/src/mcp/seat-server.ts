// The MCP server one side's player talks to: that side's tools, its brief as the server's instructions
// when the player has no other way to get it (D47), and a prompt to start playing. The stdio server
// (server.ts) and pnpm match's URL seats (url-seats.ts) build theirs here.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerPlantTools } from "../plants/tools.ts";
import type { Session } from "../session.ts";
import { registerZombieTools } from "../zombies/tools.ts";
import type { ToolContext } from "./shared.ts";

export function createSeatServer(settings: Session, brief: string, context: ToolContext, sendsBrief: boolean): McpServer {
  const { side, tools } = settings;
  const server = new McpServer({ name: "pvz", version: "0.1.0" }, sendsBrief ? { instructions: brief } : undefined);
  if (side === "zombies") registerZombieTools(server, tools, context);
  else registerPlantTools(server, tools, context);

  if (side === "zombies") {
    server.registerPrompt(
      "play_zombies",
      { title: "Play the zombies", description: "Plays the zombie side of the versus level being played, to the end." },
      () => ({ messages: [{ role: "user", content: { type: "text", text: `${brief}\nPlay the zombies until the level is over.` } }] }),
    );
  }

  if (tools.includes("start_level")) {
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
  return server;
}
