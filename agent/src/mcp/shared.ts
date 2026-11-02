// What both sides' tools share: the context they play in, how they reply and log, and how they read
// names and the end of a level.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Game, GameState } from "../game-client.ts";
import type { ToolName } from "../session.ts";
import type { GameStarter } from "./own-game.ts";

export interface ToolContext {
  game: Game;
  starter?: GameStarter; // in a chat app the server starts its own game, when start_level is first called
  clock: "waits" | "realtime";
  speed: number; // how fast game time runs whenever it runs; 1 is normal speed
  log?: (entry: Record<string, unknown>) => void;
}

export const MAX_WAIT_SECONDS = 30;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function reply(text: string, isError = false): CallToolResult {
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };
}

// Names the way people write them: "Wall-nut", "wall nut" and "wall_nut" all mean the game's wall_nut,
// and "Conehead Zombie" the game's conehead_zombie.
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function levelIsOver(state: GameState): boolean {
  return !state.board || state.board.result !== "playing";
}

// Runs a tool, logs the call, and turns anything unexpected into an error Claude can read.
export async function logged(context: ToolContext, tool: ToolName, input: unknown, handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  let result: CallToolResult;
  try {
    result = await handler();
  } catch (error) {
    result = reply(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`, true);
  }
  const first = result.content[0];
  context.log?.({ tool, input, error: result.isError === true, text: first?.type === "text" ? first.text : "" });
  return result;
}
