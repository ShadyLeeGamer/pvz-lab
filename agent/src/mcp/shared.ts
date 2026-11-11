// What both sides' tools share: the context they play in, how they reply and log, and how they read
// names and the end of a level.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Game, GameState } from "../game-client.ts";
import type { Side, ToolName } from "../session.ts";
import type { GameStarter } from "./own-game.ts";

export interface ToolContext {
  game: Game;
  starter?: GameStarter; // in a chat app the server starts its own game, when start_level is first called
  clock: "waits" | "realtime";
  speed: number; // how fast game time runs whenever it runs; 1 is normal speed
  log?: (entry: Record<string, unknown>) => void;
  lobby?: Lobby; // in a match with a player on each side, the ready check it starts on (D62)
}

// A match with a player on each side starts on a ready check, as a game lobby does (D62): each player
// calls ready, and the host starts the match once every one has. Until then, their moves are refused.
export class Lobby {
  started = false;
  // The sides whose players must be ready: every player but a person, who plays in the game window.
  readonly players: readonly Side[];
  private readonly readySides = new Set<Side>();
  private readonly gone = new Set<Side>();
  private readonly starting: (() => void)[] = [];

  constructor(players: readonly Side[]) {
    this.players = players;
  }

  isReady(side: Side): boolean {
    return this.readySides.has(side);
  }

  markReady(side: Side): void {
    this.readySides.add(side);
  }

  // A player that stops before it's ready doesn't hold the start.
  leave(side: Side): void {
    this.gone.add(side);
  }

  waitingFor(): Side[] {
    return this.players.filter((side) => !this.readySides.has(side) && !this.gone.has(side));
  }

  start(): void {
    this.started = true;
    for (const wake of this.starting.splice(0)) wake();
  }

  // True once the match has started, or false after ms.
  whenStarted(ms: number): Promise<boolean> {
    if (this.started) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      this.starting.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

export const NOT_READY = "The match hasn't started yet: call ready once you're set. It starts when every player is ready.";

function waitingLine(lobby: Lobby): string {
  const waiting = lobby.waitingFor().map((side) => `the ${side}' player`);
  return waiting.length > 0 ? `it's waiting for ${waiting.join(" and ")}.` : "it's about to start.";
}

// Why a side can't move yet, or undefined once the match has started (or when there's no ready check).
export function notStartedYet(context: ToolContext, side: Side): string | undefined {
  const { lobby } = context;
  if (!lobby || lobby.started) return undefined;
  if (!lobby.isReady(side)) return NOT_READY;
  return `The match hasn't started yet: ${waitingLine(lobby)} Call wait to wait for the start.`;
}

// Waits for the match to start, up to STILL_LIMIT_MS as a wait would, and says whether it has.
export async function awaitStart(lobby: Lobby): Promise<string> {
  if (await lobby.whenStarted(STILL_LIMIT_MS)) return "Everyone's ready: the match has started.";
  return `You're ready. The match hasn't started yet: ${waitingLine(lobby)} Call wait to wait on.`;
}

// What wait does before the match starts: a player that's ready waits for the start, and one that
// isn't is told to call ready. Undefined once the match has started (or when there's no ready check).
export async function waitBeforeStart(context: ToolContext, side: Side): Promise<{ line: string; refused: boolean } | undefined> {
  const { lobby } = context;
  if (!lobby || lobby.started) return undefined;
  if (!lobby.isReady(side)) return { line: NOT_READY, refused: true };
  return { line: await awaitStart(lobby), refused: false };
}

// What ready says in a game without a ready check.
export const NO_READY_CHECK = "This game has no ready check: just play.";

export const MAX_WAIT_SECONDS = 30;

// What every tool says, on either side, once the level is decided.
export const LEVEL_OVER = "The level is over, so you can stop playing.";

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
