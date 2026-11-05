// Turns the zombie seat's view (view=zombies) into the text the zombie side's player reads: its points
// and the zombies it can send, the plants' defence row by row, and the same lawn map the plants see.
// Like the plants' summary, it only ever gets a seat's view, so nothing hidden from a player can reach it.
import { lawnLines, levelLines, packetLine, plantSymbols, words, zombieLine } from "../board-text.ts";
import type { BoardState, GameState, VersusState } from "../game-client.ts";

type VersusType = VersusState["types"][number];

const points = (count: number) => `${count} point${count === 1 ? "" : "s"}`;

export const NOT_STARTED = "The level hasn't started yet: the plants are choosing their seed packets. Play begins once they have.";

// Why a held zombie couldn't walk on: only the game's own rules can stop it once it's held.
const REFUND_REASONS: Record<string, string> = {
  row: "its row couldn't take it when the wave arrived",
  bungee_target: "its tile couldn't be taken when the wave arrived",
  too_many_zombies: "the game already had as many zombies as it can hold",
};

function typeLine(type: VersusType, versus: VersusState, totalWaves: number): string {
  let status: string;
  if (type.ready) status = "Ready.";
  else if (versus.wave === 0) status = "No points yet.";
  // The final wave allows every type.
  else if (versus.wave < type.firstWave && versus.wave < totalWaves) status = `Not before wave ${type.firstWave}.`;
  else if (type.cost > versus.points) status = `Needs ${type.cost - versus.points} more point${type.cost - versus.points === 1 ? "" : "s"}.`;
  else status = "Can't be sent right now.";
  return `- ${type.zombie}: ${points(type.cost)}. ${status}`;
}

// What stands in a row's way: its plants, left to right, and the mower at its end.
function defenceLine(board: BoardState, row: number): string {
  const terrain = board.lawn.rows[row];
  if (terrain === "dirt") return `- row ${row} (dirt): no zombie can walk here.`;
  const counts = new Map<string, number>();
  for (const plant of [...board.plants].filter((p) => p.row === row).sort((a, b) => a.col - b.col)) {
    counts.set(plant.type, (counts.get(plant.type) ?? 0) + 1);
  }
  const plants = [...counts].map(([type, count]) => (count === 1 ? type : `${type} (${count})`));
  const mower = board.mowers.find((m) => m.row === row && m.state !== "squished");
  let end: string;
  if (!mower) end = "no mower left";
  else if (mower.state === "triggered") end = `its ${words(mower.kind)} is clearing the row`;
  else end = `${words(mower.kind)} ready`;
  return `- row ${row}${terrain === "grass" ? "" : ` (${words(terrain!)})`}: ${plants.length > 0 ? plants.join(", ") : "nothing planted"}; ${end}.`;
}

function heldItem(held: NonNullable<VersusState["held"]>[number]): string {
  return held.col === undefined ? `${held.zombie} in row ${held.row}` : `${held.zombie} onto column ${held.col}, row ${held.row}`;
}

export function summarizeZombies(state: GameState): string {
  const board = state.board;
  if (!board) {
    if (state.scene === "award") return "The plants won: the game is showing their award screen.";
    return "No level is being played right now.";
  }

  const lines: string[] = [];
  if (board.result === "won") lines.push(`The plants won level ${board.levelName}.`);
  if (board.result === "lost") lines.push(`Your zombies got into the house: you won level ${board.levelName}!`);
  lines.push(...levelLines(state, board));

  const versus = state.versus;
  if (!versus) {
    // A match's zombie seat can join while the plants choose their seed packets; versus starts with play.
    lines.push(state.scene === "level_intro" ? NOT_STARTED : "This level isn't being played in versus, so there's no zombie side to play.");
    return lines.join("\n");
  }
  lines.push(
    versus.wave === 0
      ? "Your points: none yet. The first wave pays you when it arrives."
      : `Your points: ${versus.points}, for wave ${versus.wave}. Points still unspent when the next wave pays are lost.`,
  );
  lines.push("", "Zombies you can send:", ...versus.types.map((type) => typeLine(type, versus, board.progress.totalWaves)));
  if (versus.held && versus.held.length > 0) {
    lines.push(`Held to walk on with wave ${versus.wave}'s flag zombie: ${versus.held.map(heldItem).join(", ")}.`);
  }
  if (versus.refunds && versus.refunds.length > 0) {
    lines.push("Held zombies that couldn't walk on, with their points given back:");
    lines.push(...versus.refunds.map((refund) => `- ${refund.zombie} for row ${refund.row}: ${REFUND_REASONS[refund.reason] ?? words(refund.reason)}`));
  }

  lines.push("", `The plants have ${board.sunSpendable} sun to spend. Their seed packets:`);
  lines.push(...board.seedPackets.map((packet) => packetLine(packet, board.sunSpendable)));

  const lastRow = board.lawn.rows.length - 1;
  lines.push(
    "",
    `Lawn: columns 0-8 run from the plants' house (left) to where your zombies walk in (right); rows 0-${lastRow} run top to bottom.`,
    ...lawnLines(board, plantSymbols(board)),
  );
  lines.push("", "Each row's defence:", ...board.lawn.rows.map((_, row) => defenceLine(board, row)));

  const zombies = [...board.zombies].sort((a, b) => a.row - b.row || a.x - b.x);
  lines.push("", zombies.length > 0 ? "Zombies:" : "Zombies: none on the lawn.", ...zombies.map((zombie) => zombieLine(zombie, board, "zombies")));
  return lines.join("\n");
}
