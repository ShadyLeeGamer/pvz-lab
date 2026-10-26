// Saves real game states for the unit tests: launches the game, plays a little through the API,
// and writes /state (the player view) at interesting moments into this folder. The game's replies
// to a few requests go into replies.json, so the tests never need to make one up.
// Run with `pnpm fixtures:capture` (needs agent/.env, like the end-to-end tests). With --replies-only it
// refreshes replies.json and leaves the saved states, and the tests written against them, alone.
import { writeFile } from "node:fs/promises";
import { launchGame, readGameConfig } from "../../src/game-process.ts";

type Json = any;

interface Answer {
  status: number;
  body: Json;
}

const repliesOnly = process.argv.includes("--replies-only");
const game = await launchGame(readGameConfig());
const replies: Record<string, Answer> = {};

async function send(path: string, body: unknown): Promise<Answer> {
  const response = await fetch(`${game.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function post(path: string, body: unknown): Promise<Answer> {
  const answer = await send(path, body);
  if (answer.status !== 200) throw new Error(`${path} ${JSON.stringify(body)} -> ${answer.status} ${JSON.stringify(answer.body)}`);
  return answer;
}

// Keeps the first reply of each kind.
function keep(name: string, answer: Answer): void {
  replies[name] ??= answer;
}

async function state(): Promise<Json> {
  return (await fetch(`${game.baseUrl}/state`)).json();
}

async function save(name: string, content: Json): Promise<void> {
  if (repliesOnly && name !== "replies") return;
  await writeFile(new URL(`./${name}.json`, import.meta.url), `${JSON.stringify(content, null, 2)}\n`);
  console.log(`saved ${name}.json`);
}

// One plain move per step: collect sun, plant whatever is ready on its first free tile.
async function playStep(): Promise<Json> {
  const before = await state();
  if (before.board.suns.some((sun: Json) => !sun.beingCollected)) await post("/actions", { type: "collectSun" });
  for (const packet of before.board.seedPackets) {
    if (packet.ready && packet.plantableTiles.length > 0) {
      const tile = packet.plantableTiles[0];
      keep("placed", await post("/actions", { type: "placePlant", slot: packet.slot, col: tile.col, row: tile.row }));
      break;
    }
  }
  keep("stepped", await post("/control", { type: "step", ticks: 100, speed: 50 }));
  return state();
}

async function playUntil(done: (snapshot: Json) => boolean): Promise<Json> {
  for (let i = 0; i < 500; i++) {
    const snapshot = await playStep();
    if (done(snapshot)) return snapshot;
  }
  throw new Error("gave up waiting");
}

try {
  keep("level-started", await post("/control", { type: "startLevel", level: "1-1" }));
  await save("1-1-start", await state());

  // 1-1 only has sod in row 2, so the game refuses a plant in row 0.
  const refused = await send("/actions", { type: "placePlant", slot: 0, col: 0, row: 0 });
  if (refused.status !== 409) throw new Error(`expected the game to refuse row 0, got ${refused.status} ${JSON.stringify(refused.body)}`);
  keep("cant-plant-here", refused);

  await save("1-1-zombie", await playUntil((s) => s.board.zombies.length > 0 && s.board.plants.length >= 2));
  await save("1-1-won", await playUntil((s) => s.board.award !== null));

  keep("award-collected", await post("/actions", { type: "collectAward" }));
  for (let i = 0; i < 20 && (await state()).scene !== "award"; i++) await post("/control", { type: "step", ticks: 100, speed: 50 });
  await save("award-screen", await state());

  await post("/control", { type: "startLevel" });
  await save("1-2-start", await state());
  keep("ran", await post("/control", { type: "run", speed: 1 }));
  await post("/control", { type: "freeze" });

  const asked = await send("/control", { type: "startLevel", level: "1-8" });
  keep("seeds-asked", asked);
  const { choices, pick } = asked.body.error;
  await post("/control", { type: "startLevel", level: "1-8", seeds: choices.slice(0, pick) });
  await save("1-8-start", await state());
  await save("1-8-midgame", await playUntil((s) => s.board.zombies.length >= 2 && s.board.plants.length >= 6));

  // Lets sun pile up, so one collect_sun reply covers more than one sun.
  for (let i = 0; i < 60 && (await state()).board.suns.filter((sun: Json) => !sun.beingCollected).length < 2; i++) {
    await post("/control", { type: "step", ticks: 100, speed: 50 });
  }
  const collected = await post("/actions", { type: "collectSun" });
  if (!(collected.body.collected >= 2)) throw new Error(`expected to collect 2 or more suns, got ${JSON.stringify(collected.body)}`);
  keep("suns-collected", collected);

  // A rule the game explains with its own hint: a mushroom on a gravestone, at night.
  await post("/control", { type: "startLevel", level: "2-7", seeds: ["puff_shroom", "grave_buster", "sun_shroom", "fume_shroom", "wall_nut", "cherry_bomb"] });
  const night = await state();
  const grave = night.board.lawn.items.find((item: Json) => item.type === "grave");
  const puff = night.board.seedPackets.find((packet: Json) => packet.plant === "puff_shroom");
  const hinted = await send("/actions", { type: "placePlant", slot: puff.slot, col: grave.col, row: grave.row });
  if (hinted.status !== 409) throw new Error(`expected the game to refuse a mushroom on a grave, got ${hinted.status} ${JSON.stringify(hinted.body)}`);
  keep("game-hint", hinted);

  // A level the API can't start yet: it opens with Crazy Dave talking.
  const dave = await send("/control", { type: "startLevel", level: "2-1" });
  if (dave.status !== 409) throw new Error(`expected 2-1 to be refused, got ${dave.status} ${JSON.stringify(dave.body)}`);
  keep("crazy-dave", dave);

  await save("replies", replies);
} finally {
  await game.stop();
}
