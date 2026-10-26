// Turns the game state into the short text Claude reads: a map of the lawn, then the details as lists.
// It only ever gets the player view, so nothing hidden from a player can reach Claude.
import type { BoardState, GameState } from "./game-client.ts";

type Plant = BoardState["plants"][number];
type Zombie = BoardState["zombies"][number];
type SeedPacket = BoardState["seedPackets"][number];

const COLUMNS = 9;
const LAWN_LEFT = 40; // pixels: where column 0 starts
const TILE_WIDTH = 80;
// A normal zombie bites from 50 px right of its x (Zombie::mZombieAttackRect), so that's its front.
const ZOMBIE_FRONT = 50;

const ITEM_SYMBOLS: Record<string, string> = { grave: "g", crater: "o", ladder: "l", rake: "r", vase: "v" };
const LAYER_ORDER = ["normal", "pumpkin", "under", "flying", "none"];

// The column a zombie's front is in, so one eating a plant is in that plant's column.
// 9 or more: still walking in from the right. Below 0: at the house.
export function zombieColumn(x: number): number {
  return Math.floor((x + ZOMBIE_FRONT - LAWN_LEFT) / TILE_WIDTH);
}

// One capital letter per plant type, kept the same for a whole level: seed packets first, in slot order.
export function plantSymbols(board: BoardState): Map<string, string> {
  const types = [...board.seedPackets.map((packet) => packet.plant), ...board.plants.map((plant) => plant.type).sort()];
  const symbols = new Map<string, string>();
  const used = new Set(["Z"]);
  for (const type of types) {
    if (symbols.has(type)) continue;
    const wordStarts = type.split("_").map((word) => word.charAt(0));
    const candidates = [...wordStarts, ...type.replaceAll("_", ""), ..."ABCDEFGHIJKLMNOPQRSTUVWXY"];
    const symbol = candidates.map((c) => c.toUpperCase()).find((c) => /^[A-Z]$/.test(c) && !used.has(c)) ?? "?";
    used.add(symbol);
    symbols.set(type, symbol);
  }
  return symbols;
}

const words = (name: string) => name.replaceAll("_", " ");
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
const list = (items: (string | number)[]) => items.join(", ");

function topPlantAt(board: BoardState, col: number, row: number): Plant | undefined {
  return board.plants
    .filter((plant) => plant.col === col && plant.row === row)
    .sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))[0];
}

function packetLine(packet: SeedPacket, sunToSpend: number): string {
  const shortBy = packet.cost - sunToSpend;
  let status: string;
  if (packet.ready) status = packet.plantableTiles.length > 0 ? "Ready." : "Ready, but there's nowhere it can go right now.";
  else if (packet.recharge < 1) status = `Recharging, ${percent(packet.recharge)} done${shortBy > 0 ? `; then needs ${shortBy} more sun` : ""}.`;
  else if (shortBy > 0) status = `Needs ${shortBy} more sun.`;
  else status = "Can't be used yet.";
  return `- ${packet.plant}: ${packet.cost} sun. ${status}`;
}

function lawnLines(board: BoardState, symbols: Map<string, string>): string[] {
  const used = new Set<string>();
  const lines = [`       ${Array.from({ length: COLUMNS }, (_, col) => col).join(" ")} +`];
  board.lawn.rows.forEach((terrain, row) => {
    const zombieColumns = board.zombies.filter((zombie) => zombie.row === row).map((zombie) => zombieColumn(zombie.x));
    const cells = Array.from({ length: COLUMNS }, (_, col) => {
      const plant = topPlantAt(board, col, row);
      const item = board.lawn.items.find((it) => it.col === col && it.row === row);
      let cell: string;
      if (plant) cell = symbols.get(plant.type) ?? "?";
      else if (item) cell = ITEM_SYMBOLS[item.type] ?? "?";
      else if (zombieColumns.includes(col)) cell = "Z";
      else if (board.lawn.ice.some((tile) => tile.col === col && tile.row === row)) cell = "i";
      else cell = terrain === "dirt" ? "x" : terrain === "water" ? "~" : ".";
      used.add(cell);
      return cell;
    });
    const walkingIn = zombieColumns.some((col) => col >= COLUMNS);
    if (walkingIn) used.add("+");
    lines.push(`row ${row}  ${cells.join(" ")} ${walkingIn ? "Z" : ""}`.trimEnd());
  });

  const key: string[] = [];
  for (const [type, symbol] of symbols) if (used.has(symbol)) key.push(`${symbol} ${type}`);
  const terrain: [string, string][] = [
    [".", "empty"],
    ["x", "dirt (nothing can be planted)"],
    ["~", "water"],
    ["i", "ice (nothing can be planted)"],
    ["g", "grave"],
    ["o", "crater"],
    ["l", "ladder"],
    ["r", "rake"],
    ["v", "vase"],
  ];
  for (const [symbol, meaning] of terrain) if (used.has(symbol)) key.push(`${symbol} ${meaning}`);
  if (used.has("Z") || used.has("+")) key.push("Z zombie");
  if (used.has("+")) key.push("a Z in the + column is still walking in");
  lines.push(key.join(", "));
  return lines;
}

function zombieLine(zombie: Zombie, board: BoardState): string {
  const col = zombieColumn(zombie.x);
  const where = col >= COLUMNS ? "walking in from the right" : col < 0 ? "at your house" : `at column ${col}`;
  const notes: string[] = [];
  if (zombie.eating) {
    const plant = topPlantAt(board, col, zombie.row);
    notes.push(plant ? `eating the ${plant.type}` : "eating");
  }
  for (const armor of [zombie.helm, zombie.shield]) {
    if (armor) notes.push(`with a ${words(armor.type)}${armor.damage === "none" ? "" : ` (${words(armor.damage)})`}`);
  }
  if (!zombie.hasHead) notes.push("lost its head");
  else if (!zombie.hasArm) notes.push("lost an arm");
  if (zombie.slowed) notes.push("slowed");
  if (zombie.frozen) notes.push("frozen");
  if (zombie.buttered) notes.push("buttered");
  if (zombie.hypnotized) notes.push("hypnotized, fighting for you");
  if (zombie.flying) notes.push("flying");
  if (zombie.underground) notes.push("underground");
  return `- row ${zombie.row}: ${zombie.type} ${where}${notes.length > 0 ? `, ${notes.join(", ")}` : ""}`;
}

function plantNote(plant: Plant): string | undefined {
  const notes: string[] = [];
  if (plant.damage && plant.damage !== "none") notes.push(words(plant.damage));
  if (plant.state) notes.push(plant.state);
  if (plant.asleep) notes.push("asleep");
  return notes.length > 0 ? `- ${plant.type} at column ${plant.col}, row ${plant.row}: ${notes.join(", ")}` : undefined;
}

export function summarize(state: GameState): string {
  const board = state.board;
  if (!board) {
    if (state.scene === "award") return "Level won! The game is showing the award screen.";
    return "No level is being played right now.";
  }

  const lines: string[] = [];
  if (board.result === "won") lines.push(`You won level ${board.levelName}!`);
  if (board.result === "lost") lines.push(`The zombies got into your house. Level ${board.levelName} is lost.`);
  if (state.minimized) lines.push("The game window is minimized, so game time can't pass.");
  if (state.dialogOpen || board.paused) lines.push("The game is paused by a menu or dialog.");

  const { wave, totalWaves, meter, hugeWaveIncoming } = board.progress;
  lines.push(
    `Level ${board.levelName} (${board.stage}). Game time ${(board.gameTicks / 100).toFixed(1)} s. ` +
      `Waves: ${wave} of ${totalWaves} sent (${percent(meter)} through the level).${hugeWaveIncoming ? " A huge wave is coming!" : ""}`,
  );
  const flying = board.sunSpendable - board.sun;
  lines.push(`Sun: ${board.sunSpendable} to spend${flying > 0 ? ` (${flying} of it still flying to the counter)` : ""}.`);

  lines.push("", "Seed packets:", ...board.seedPackets.map((packet) => packetLine(packet, board.sunSpendable)));

  const lastRow = board.lawn.rows.length - 1;
  lines.push(
    "",
    `Lawn: columns 0-8 run from your house (left) to where zombies come in (right); rows 0-${lastRow} run top to bottom.`,
    ...lawnLines(board, plantSymbols(board)),
  );

  const zombies = [...board.zombies].sort((a, b) => a.row - b.row || a.x - b.x);
  lines.push("", zombies.length > 0 ? "Zombies:" : "Zombies: none in sight.", ...zombies.map((zombie) => zombieLine(zombie, board)));

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
