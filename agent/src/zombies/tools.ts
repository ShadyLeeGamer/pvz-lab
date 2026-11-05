// The tools the zombie side plays with in a versus level: look, send a zombie, let time pass. The game
// carries out every send and decides what's allowed; like the plants' tools, these functions only translate
// and describe. The zombie side always plays in real time, so wait never touches the game's clock.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GameState } from "../game-client.ts";
import { LEVEL_OVER, levelIsOver, logged, MAX_WAIT_SECONDS, normalizeName, reply, type ToolContext, waitGameTime } from "../mcp/shared.ts";
import type { ToolName } from "../session.ts";
import { summarizeZombies } from "./summary.ts";

// How often wait looks for a payday or the level's end (D16).
export const PAYDAY_POLL_MS = 250;

const points = (count: number) => `${count} point${count === 1 ? "" : "s"}`;

// A match's zombie seat can join while the level waits for the plants to choose their seed packets.
const atSeedChooser = (state: GameState): boolean => state.scene === "level_intro" && !state.versus;

// The end of the level, told from the zombies' side.
function endOfLevel(state: GameState): string {
  const level = state.board ? `level ${state.board.levelName}` : "the level";
  const stop = LEVEL_OVER;
  if (state.board?.result === "lost") return `Your zombies got into the house: you won ${level}! ${stop}`;
  if (state.board?.result === "won" || state.scene === "award") return `The plants held out and won ${level}. ${stop}`;
  return "No level is being played right now.";
}

export function registerZombieTools(server: McpServer, tools: readonly ToolName[], context: ToolContext): void {
  const { game } = context;
  const enabled = new Set(tools);

  const look = (): Promise<GameState> => game.state("zombies");
  const show = (state: GameState): string => (levelIsOver(state) ? endOfLevel(state) : summarizeZombies(state));

  if (enabled.has("get_state")) {
    server.registerTool(
      "get_state",
      {
        title: "Look at the game",
        description: "Shows your points and the zombies you can send, the plants' sun and seed packets, the lawn, each row's defence and the zombies on it.",
        annotations: { readOnlyHint: true },
      },
      () => logged(context, "get_state", {}, async () => reply(show(await look()))),
    );
  }

  if (enabled.has("send_zombie")) {
    server.registerTool(
      "send_zombie",
      {
        title: "Send a zombie",
        description:
          "Sends one of the level's zombies, paid from your points, into a row: it walks in from the right. A bungee_zombie " +
          "drops onto the tile you name with col instead. During a huge wave's warning the zombie is held, and walks on with " +
          "the wave. If it can't be sent, the game refuses and says why.",
        inputSchema: {
          zombie: z.string().min(1).describe("The zombie's name as get_state lists it, e.g. conehead_zombie."),
          row: z.number().int().min(0).max(5).describe("Row, counting from 0 at the top."),
          col: z
            .number()
            .int()
            .min(0)
            .max(8)
            .optional()
            .describe("Only for bungee_zombie: the column it drops onto, from 0 next to the plants' house to 8."),
        },
      },
      (input) =>
        logged(context, "send_zombie", input, async () => {
          const before = await look();
          if (levelIsOver(before)) return reply(endOfLevel(before), true);
          const zombie = normalizeName(input.zombie);
          const result = await game.act({ type: "sendZombie", zombie, row: input.row, ...(input.col === undefined ? {} : { col: input.col }) });
          if (!result.ok) {
            // Before play begins, the game has no versus yet to send into.
            const why = result.error.code === "not_versus" && atSeedChooser(before) ? "the level hasn't started yet, as the plants are choosing their seed packets" : result.error.message;
            return reply(`Not sent: ${why}.`, true);
          }
          const after = await look();
          const wave = after.versus?.wave ?? before.versus?.wave;
          const where = input.col === undefined ? `into row ${input.row}` : `onto column ${input.col}, row ${input.row}`;
          const left = `${points(result.reply.points ?? 0)} left for wave ${wave}.`;
          const what = result.reply.held
            ? `Held a ${zombie} to go ${where} when wave ${wave} arrives with its flag zombie. ${left}`
            : `Sent a ${zombie} ${where}. ${left}`;
          return reply(`${what}\n\n${show(after)}`);
        }),
    );
  }

  if (enabled.has("wait")) {
    server.registerTool(
      "wait",
      {
        title: "Let time pass",
        description:
          "Waits for a number of seconds while the game keeps running, then shows the game. It ends early when a wave pays you or the level ends, " +
          "and when play begins if the plants are still choosing their seed packets.",
        inputSchema: {
          seconds: z.number().min(0.1).max(MAX_WAIT_SECONDS).describe(`Seconds of game time, from 0.1 to ${MAX_WAIT_SECONDS}.`),
        },
      },
      (input) =>
        logged(context, "wait", input, async () => {
          const before = await look();
          if (levelIsOver(before)) return reply(endOfLevel(before), true);
          const paidFor = before.versus?.wave ?? 0;
          const waitingForPlay = atSeedChooser(before);
          const stop = (state: GameState) => levelIsOver(state) || (state.versus?.wave ?? 0) > paidFor || (waitingForPlay && !atSeedChooser(state));
          const { state: now, line } = await waitGameTime(input.seconds, context.speed, before, look, stop, PAYDAY_POLL_MS);
          if (levelIsOver(now)) return reply(endOfLevel(now));
          if (now.versus && now.versus.wave > paidFor) {
            const huge = now.board?.progress.hugeWaveIncoming ? " It's a huge wave: zombies you send now are held, and walk on with its flag zombie." : "";
            return reply(`Wave ${now.versus.wave} paid you ${points(now.versus.points)}.${huge}\n\n${show(now)}`);
          }
          if (waitingForPlay && !atSeedChooser(now)) return reply(`Play has begun: the plants have chosen their seed packets.\n\n${show(now)}`);
          return reply(`${line}\n\n${show(now)}`);
        }),
    );
  }
}
