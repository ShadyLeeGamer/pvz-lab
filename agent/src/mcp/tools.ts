// The tools Claude plays with: look, plant, collect sun, let time pass. The game carries out every
// move and decides what's allowed; these functions only translate and describe.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Game, GameState } from "../game-client.ts";
import type { ToolName } from "../session.ts";
import { summarize } from "../summarize.ts";

export interface ToolContext {
  game: Game;
  clock: "waits" | "realtime";
  speed: number; // how fast game time runs whenever it runs; 1 is normal speed
  log?: (entry: Record<string, unknown>) => void;
}

export const MAX_WAIT_SECONDS = 30;
const TICKS_PER_SECOND = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function reply(text: string, isError = false): CallToolResult {
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };
}

// Names the way people write them: "Wall-nut", "wall nut" and "wall_nut" all mean the game's wall_nut.
export function normalizePlantName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function levelIsOver(state: GameState): boolean {
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

// Runs a tool, logs the call, and turns anything unexpected into an error Claude can read.
async function logged(context: ToolContext, tool: ToolName, input: unknown, handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
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

  // What a tool shows after acting: the game, or the end of the level if it ended meanwhile.
  const show = async (levelName?: string): Promise<string> => {
    const now = await look(context);
    return levelIsOver(now.state) ? endOfLevel(now.state, now.levelName ?? levelName) : summarize(now.state);
  };

  if (enabled.has("get_state")) {
    server.registerTool(
      "get_state",
      {
        title: "Look at the game",
        description: `Shows your sun, your seed packets, the lawn, the zombies and any sun waiting to be collected.${timeStands}`,
        // In real time it can be the tool that sees a win, and then it collects the award.
        annotations: { readOnlyHint: context.clock === "waits" },
      },
      () => logged(context, "get_state", {}, async () => reply(await show())),
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
          const { state, levelName } = await look(context);
          if (levelIsOver(state)) return reply(endOfLevel(state, levelName), true);
          const packets = state.board!.seedPackets;
          const packet = packets.find((p) => p.plant === normalizePlantName(input.plant));
          if (!packet) {
            return reply(`You don't have a ${input.plant} seed packet. Your packets: ${packets.map((p) => p.plant).join(", ")}.`, true);
          }
          const result = await game.act({ type: "placePlant", slot: packet.slot, col: input.col, row: input.row });
          if (!result.ok) return reply(`Not planted: ${result.error.message}.`, true);
          return reply(`Planted a ${packet.plant} at column ${input.col}, row ${input.row}.\n\n${await show(levelName)}`);
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
