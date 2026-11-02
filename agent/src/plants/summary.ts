// Turns the game state into the short text the plants' side reads: a map of the lawn, then the details
// as lists. It only ever gets the plants' view, so nothing hidden from a player can reach Claude.
import { lawnLines, levelLines, packetLine, plantSymbols, words, zombieLine } from "../board-text.ts";
import type { BoardState, GameState } from "../game-client.ts";

type Plant = BoardState["plants"][number];

const list = (items: (string | number)[]) => items.join(", ");

function plantNote(plant: Plant): string | undefined {
  const notes: string[] = [];
  if (plant.damage && plant.damage !== "none") notes.push(words(plant.damage));
  if (plant.state) notes.push(plant.state);
  if (plant.asleep) notes.push("asleep");
  return notes.length > 0 ? `- ${plant.type} at column ${plant.col}, row ${plant.row}: ${notes.join(", ")}` : undefined;
}

export interface SummaryOptions {
  shovel?: boolean; // the player can dig plants up, so say when the level has no shovel
}

export function summarizePlants(state: GameState, options: SummaryOptions = {}): string {
  const board = state.board;
  if (!board) {
    if (state.scene === "award") return "Level won! The game is showing the award screen.";
    return "No level is being played right now.";
  }

  const lines: string[] = [];
  if (board.result === "won") lines.push(`You won level ${board.levelName}!`);
  if (board.result === "lost") lines.push(`The zombies got into your house. Level ${board.levelName} is lost.`);
  lines.push(...levelLines(state, board));
  const flying = board.sunSpendable - board.sun;
  lines.push(`Sun: ${board.sunSpendable} to spend${flying > 0 ? ` (${flying} of it still flying to the counter)` : ""}.`);

  lines.push("", "Seed packets:", ...board.seedPackets.map((packet) => packetLine(packet, board.sunSpendable)));
  if (options.shovel && !board.shovel) lines.push("This level has no shovel, so nothing can be dug up.");

  const lastRow = board.lawn.rows.length - 1;
  lines.push(
    "",
    `Lawn: columns 0-8 run from your house (left) to where zombies come in (right); rows 0-${lastRow} run top to bottom.`,
    ...lawnLines(board, plantSymbols(board)),
  );

  const zombies = [...board.zombies].sort((a, b) => a.row - b.row || a.x - b.x);
  lines.push("", zombies.length > 0 ? "Zombies:" : "Zombies: none in sight.", ...zombies.map((zombie) => zombieLine(zombie, board, "plants")));

  const notes = board.plants.map(plantNote).filter((note) => note !== undefined);
  if (notes.length > 0) lines.push("Plants to note:", ...notes);

  const suns = board.suns.filter((sun) => !sun.beingCollected);
  const sunValue = suns.reduce((total, sun) => total + sun.value, 0);
  lines.push(suns.length > 0 ? `Suns waiting to be collected: ${suns.length} (${sunValue} sun).` : "Suns waiting to be collected: none.");

  const mowerRows = board.mowers.filter((mower) => mower.state === "ready" || mower.state === "rolling_in").map((mower) => mower.row);
  lines.push(mowerRows.length > 0 ? `Lawnmowers left in rows: ${list(mowerRows)}.` : "Lawnmowers left: none.");
  for (const mower of board.mowers.filter((m) => m.state === "triggered")) lines.push(`A lawnmower is clearing row ${mower.row}.`);

  return lines.join("\n");
}
