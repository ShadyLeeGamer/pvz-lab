// The tools Claude plays with: look, plant, dig up, collect sun, let time pass. The game carries out
// every move and decides what's allowed; these functions only translate and describe.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ApiError, Game, GameState } from "../game-client.ts";
import type { ToolName } from "../session.ts";
import { summarize } from "../summarize.ts";
import type { GameStarter } from "./own-game.ts";

export interface ToolContext {
  game: Game;
  starter?: GameStarter; // in a chat app the server starts its own game, when start_level is first called
  clock: "waits" | "realtime";
  speed: number; // how fast game time runs whenever it runs; 1 is normal speed
  log?: (entry: Record<string, unknown>) => void;
}

const NO_GAME_YET = "No level is being played yet. Start one with start_level.";

export const MAX_WAIT_SECONDS = 30;
const TICKS_PER_SECOND = 100;

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

function endOfLevel(state: GameState, levelName = state.board?.levelName): string {
  const stop = "The level is over, so you can stop playing.";
  const level = levelName ? `level ${levelName}` : "the level";
  if (state.scene === "award" || state.board?.result === "won") return `You won ${level}! ${stop}`;
  if (state.board?.result === "lost") return `The zombies got into your house, so you lost ${level}. ${stop}`;
  return "No level is being played right now.";
}

// Collecting the award is part of winning, not a choice, so it's done for Claude, by whichever tool
// sees the win first. The level then fades out and the game moves on to its award screen.
async function finishWonLevel(context: ToolContext, state: GameState): Promise<GameState> {
  if (state.board?.result !== "won" || !state.board.award) return state;
  await context.game.act({ type: "collectAward" });
  for (let i = 0; i < 30; i++) {
    const now = await context.game.state();
    if (now.scene === "award" || !now.board) return now;
    if (context.clock === "waits") await context.game.control({ type: "step", ticks: 100, speed: context.speed });
    else await sleep(500);
  }
  return context.game.state();
}

// Reads the game, finishing a win first. Keeps the level's name, which the award screen no longer shows.
async function look(context: ToolContext): Promise<{ state: GameState; levelName?: string }> {
  const first = await context.game.state();
  return { state: await finishWonLevel(context, first), levelName: first.board?.levelName };
}

// The zombies a level's intro shows waiting on the street, as a line for the player; empty if there are none.
export function streetLine(zombies: string[] | undefined): string {
  return zombies && zombies.length > 0 ? `The street shows the zombies coming in this level: ${zombies.join(", ")}.` : "";
}

// What start_level says when a level asks which seed packets to bring, like the seed chooser screen.
function seedChoice(level: string, error: ApiError, triedSeeds: boolean): string {
  const choices = (error.choices ?? []).map((plant, i) => (error.costs?.[i] === undefined ? plant : `${plant} (${error.costs[i]} sun)`));
  const why = triedSeeds ? `Level ${level} didn't start: ${error.message}.` : `Level ${level} asks you to choose ${error.pick} seed packets first.`;
  const street = streetLine(error.zombies);
  return `${why}\n${street ? `${street}\n` : ""}You can choose from: ${choices.join(", ")}.\nCall start_level again with the ${error.pick} you pick.`;
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

export function registerTools(server: McpServer, tools: readonly ToolName[], context: ToolContext): void {
  const { game } = context;
  const enabled = new Set(tools);
  // Only true while the game waits for the player; in real time the game runs on during every call.
  const timeStands = context.clock === "waits" ? " Game time doesn't move." : "";
  const summary = { shovel: enabled.has("dig_up") };

  // What a tool shows after acting: the game, or the end of the level if it ended meanwhile.
  const show = async (levelName?: string): Promise<string> => {
    const now = await look(context);
    return levelIsOver(now.state) ? endOfLevel(now.state, now.levelName ?? levelName) : summarize(now.state, summary);
  };
  // In a chat app nothing runs until the first start_level.
  const noGameYet = (): boolean => context.starter !== undefined && !context.starter.started;

  if (enabled.has("start_level")) {
    server.registerTool(
      "start_level",
      {
        title: "Start a level",
        description:
          "Starts an Adventure level, such as 1-1 or 2-7, and shows the game. From 1-8 on, the game first asks which seed packets " +
          "to bring: call it without seeds to see the choices and their costs, then again with the ones you pick. " +
          "Starting a level ends any level being played.",
        inputSchema: {
          level: z.string().regex(/^[1-5]-([1-9]|10)$/).describe("The level, from 1-1 to 5-10."),
          seeds: z.array(z.string().min(1)).optional().describe("The seed packets to bring, by name, when the level asks you to choose."),
        },
      },
      (input) =>
        logged(context, "start_level", input, async () => {
          await context.starter?.start();
          const seeds = input.seeds?.map(normalizeName);
          const result = await game.control({ type: "startLevel", level: input.level, seeds, then: "freeze" });
          if (!result.ok) {
            if (result.error.code === "bad_seeds" && result.error.choices) return reply(seedChoice(input.level, result.error, seeds !== undefined), seeds !== undefined);
            if (result.error.code === "needs_input") return reply(`Level ${input.level} isn't supported yet: it opens with Crazy Dave talking.`, true);
            return reply(`Level ${input.level} didn't start: ${result.error.message}.`, true);
          }
          if (context.clock === "realtime") {
            const running = await game.control({ type: "run", speed: context.speed });
            if (!running.ok) return reply(`Level ${input.level} started, but time didn't start: ${running.error.message}.`, true);
          }
          const how = context.clock === "waits" ? "The game is paused while you think." : "The game is running.";
          const street = streetLine(result.reply.zombies);
          return reply(`Level ${input.level} started. ${how}\n${street ? `${street}\n` : ""}\n${summarize(await game.state(), summary)}`);
        }),
    );
  }

  if (enabled.has("get_state")) {
    server.registerTool(
      "get_state",
      {
        title: "Look at the game",
        description: `Shows your sun, your seed packets, the lawn, the zombies and any sun waiting to be collected.${timeStands}`,
        // In real time it can be the tool that sees a win, and then it collects the award.
        annotations: { readOnlyHint: context.clock === "waits" },
      },
      () => logged(context, "get_state", {}, async () => reply(noGameYet() ? NO_GAME_YET : await show())),
    );
  }

  if (enabled.has("place_plant")) {
    server.registerTool(
      "place_plant",
      {
        title: "Plant a seed packet",
        description:
          "Plants from one of your seed packets on a lawn tile, the way a player clicks the packet and then the tile. " +
          "It costs the packet's sun and starts its recharge. If the packet isn't ready, or the plant can't go on that tile, " +
          `the game refuses and says why.${timeStands}`,
        inputSchema: {
          plant: z.string().min(1).describe("The plant's name as your seed packets show it, e.g. peashooter."),
          col: z.number().int().min(0).max(8).describe("Column 0-8: 0 is next to your house, 8 is where zombies come in."),
          row: z.number().int().min(0).max(5).describe("Row, counting from 0 at the top."),
        },
      },
      (input) =>
        logged(context, "place_plant", input, async () => {
          if (noGameYet()) return reply(NO_GAME_YET, true);
          const { state, levelName } = await look(context);
          if (levelIsOver(state)) return reply(endOfLevel(state, levelName), true);
          const packets = state.board!.seedPackets;
          const packet = packets.find((p) => p.plant === normalizeName(input.plant));
          if (!packet) {
            return reply(`You don't have a ${input.plant} seed packet. Your packets: ${packets.map((p) => p.plant).join(", ")}.`, true);
          }
          const result = await game.act({ type: "placePlant", slot: packet.slot, col: input.col, row: input.row });
          if (!result.ok) return reply(`Not planted: ${result.error.message}.`, true);
          return reply(`Planted a ${packet.plant} at column ${input.col}, row ${input.row}.\n\n${await show(levelName)}`);
        }),
    );
  }

  if (enabled.has("dig_up")) {
    server.registerTool(
      "dig_up",
      {
        title: "Dig up a plant",
        description:
          "Digs up one of your plants with the shovel, the way a player clicks the shovel and then the plant, to free its tile. " +
          "You get no sun back. On a tile with more than one plant, it digs up the plant itself unless you name another, " +
          "such as the pumpkin around it or the lily pad under it. If there's nothing to dig up, or the level has no shovel, " +
          `the game refuses and says why.${timeStands}`,
        inputSchema: {
          col: z.number().int().min(0).max(8).describe("Column 0-8: 0 is next to your house, 8 is where zombies come in."),
          row: z.number().int().min(0).max(5).describe("Row, counting from 0 at the top."),
          plant: z.string().min(1).optional().describe("Which plant on the tile to dig up, e.g. pumpkin. Leave it out to dig up the plant itself."),
        },
      },
      (input) =>
        logged(context, "dig_up", input, async () => {
          if (noGameYet()) return reply(NO_GAME_YET, true);
          const { state, levelName } = await look(context);
          if (levelIsOver(state)) return reply(endOfLevel(state, levelName), true);
          const plant = input.plant === undefined ? undefined : normalizeName(input.plant);
          const result = await game.act({ type: "digUp", col: input.col, row: input.row, plant });
          if (!result.ok) return reply(`Not dug up: ${result.error.message}.`, true);
          const dug = result.reply.plant!;
          return reply(`Dug up the ${dug.type} at column ${dug.col}, row ${dug.row}.\n\n${await show(levelName)}`);
        }),
    );
  }

  if (enabled.has("collect_sun")) {
    server.registerTool(
      "collect_sun",
      {
        title: "Collect sun",
        description: `Collects every sun on the lawn, like clicking each one. Collected sun can be spent straight away.${timeStands}`,
      },
      () =>
        logged(context, "collect_sun", {}, async () => {
          if (noGameYet()) return reply(NO_GAME_YET, true);
          const { state, levelName } = await look(context);
          if (levelIsOver(state)) return reply(endOfLevel(state, levelName), true);
          const result = await game.act({ type: "collectSun" });
          if (!result.ok) return reply(`No sun collected: ${result.error.message}.`, true);
          const { collected = 0, value = 0 } = result.reply;
          const what = collected === 0 ? "There was no sun to collect." : `Collected ${collected} sun${collected === 1 ? "" : "s"} worth ${value}.`;
          return reply(`${what}\n\n${await show(levelName)}`);
        }),
    );
  }

  if (enabled.has("wait")) {
    server.registerTool(
      "wait",
      {
        title: "Let time pass",
        description:
          context.clock === "waits"
            ? "Lets game time run for a number of seconds, then shows the game. The game is paused while you think: this is the only way time passes."
            : "Waits for a number of seconds while the game keeps running, then shows the game.",
        inputSchema: {
          seconds: z.number().min(0.1).max(MAX_WAIT_SECONDS).describe(`Seconds of game time, from 0.1 to ${MAX_WAIT_SECONDS}.`),
        },
      },
      (input) =>
        logged(context, "wait", input, async () => {
          if (noGameYet()) return reply(NO_GAME_YET, true);
          const { state: before, levelName } = await look(context);
          if (levelIsOver(before)) return reply(endOfLevel(before, levelName), true);
          if (context.clock === "waits") {
            const ticks = Math.max(1, Math.round(input.seconds * TICKS_PER_SECOND));
            const result = await game.control({ type: "step", ticks, speed: context.speed });
            if (!result.ok) return reply(`Time didn't pass: ${result.error.message}.`, true);
          } else {
            await sleep((input.seconds * 1000) / context.speed); // the game runs at that speed, so this is `seconds` of game time
          }
          return reply(`${input.seconds} s passed.\n\n${await show(levelName)}`);
        }),
    );
  }
}
