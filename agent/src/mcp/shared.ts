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

export const TICKS_PER_SECOND = 100;

// A wait in real time gives up once game time has stood still this long, so a paused or stuck game can't
// hold it forever. That's long enough for a match's start, where game time waits for every player.
export const STILL_LIMIT_MS = 30_000;
// How often such a wait looks again while game time stands still.
const STILL_POLL_MS = 250;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const gameSeconds = (ticks: number) => String(Number((ticks / TICKS_PER_SECOND).toFixed(1)));

// Lets `seconds` of game time pass while the game runs on its own (real time), by the game's own clock,
// which stands still while the game is frozen or paused: at a match's start, until every player is ready.
// Sleeps as long as the game time left takes at `speed`, then reads the game, until it has all passed.
// Reads at least every pollMs, ends as soon as stop says so, and gives up once game time has stood still
// for STILL_LIMIT_MS. Returns the game as the wait left it, and the line saying how much time passed.
export async function waitGameTime(
  seconds: number,
  speed: number,
  before: GameState,
  read: () => Promise<GameState>,
  stop: (state: GameState) => boolean,
  pollMs = Number.POSITIVE_INFINITY,
): Promise<{ state: GameState; line: string }> {
  const asked = Math.round(seconds * TICKS_PER_SECOND);
  const start = before.board?.gameTicks ?? 0;
  let ticks = start;
  let moved = true;
  let stillSince = Date.now();
  for (;;) {
    const leftMs = ((asked - (ticks - start)) * 1000) / TICKS_PER_SECOND / speed;
    await sleep(Math.min(pollMs, moved ? leftMs : Math.max(leftMs, STILL_POLL_MS)));
    const state = await read();
    const now = state.board?.gameTicks ?? ticks; // the award screen after a win has no board
    moved = now !== ticks;
    ticks = now;
    if (stop(state) || ticks - start >= asked) return { state, line: `${gameSeconds(ticks - start)} s passed.` };
    if (moved) stillSince = Date.now();
    else if (Date.now() - stillSince >= STILL_LIMIT_MS) {
      return { state, line: `Only ${gameSeconds(ticks - start)} of the ${seconds} s passed: game time stood still.` };
    }
  }
}

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
