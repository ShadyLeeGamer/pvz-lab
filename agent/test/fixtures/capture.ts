// Saves real game states for the unit tests: launches the game, plays a little through the API,
// and writes /state (the plants' view) at interesting moments into this folder. The game's replies
// to a few requests go into replies.json, so the tests never need to make one up.
// Run with `pnpm fixtures:capture` (needs agent/.env, like the end-to-end tests). With --replies-only it
// refreshes replies.json and leaves the saved states, and the tests written against them, alone. Naming
// parts captures only those, e.g. `pnpm fixtures:capture versus`: the parts are "classic", "versus" and
// "match".
import { readFile, writeFile } from "node:fs/promises";
import { launchGame, readGameConfig } from "../../src/game-process.ts";

type Json = any;

interface Answer {
  status: number;
  body: Json;
}

const repliesOnly = process.argv.includes("--replies-only");
const parts = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const wanted = (part: string) => parts.length === 0 || parts.includes(part);
const game = await launchGame(readGameConfig());
// Replies from the parts not captured this time stay as they were.
const replies: Record<string, Answer> = parts.length === 0 ? {} : JSON.parse(await readFile(new URL("./replies.json", import.meta.url), "utf8"));
const kept = new Set<string>();

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
  if (kept.has(name)) return;
  kept.add(name);
  replies[name] = answer;
}

async function state(): Promise<Json> {
  return (await fetch(`${game.baseUrl}/state`)).json();
}

async function zombiesView(): Promise<Json> {
  return (await fetch(`${game.baseUrl}/state?view=zombies`)).json();
}

async function save(name: string, content: Json): Promise<void> {
  if (repliesOnly && name !== "replies") return;
  await writeFile(new URL(`./${name}.json`, import.meta.url), `${JSON.stringify(content, null, 2)}\n`);
  console.log(`saved ${name}.json`);
}

// One plain move per step: collect sun, plant whatever is ready on its first free tile. Only the
// classic part keeps the replies, so capturing versus alone leaves them as they were.
async function playStep(keepReplies: boolean): Promise<Json> {
  const before = await state();
  if (before.board.suns.some((sun: Json) => !sun.beingCollected)) await post("/actions", { type: "collectSun" });
  for (const packet of before.board.seedPackets) {
    if (packet.ready && packet.plantableTiles.length > 0) {
      const tile = packet.plantableTiles[0];
      const placed = await post("/actions", { type: "placePlant", slot: packet.slot, col: tile.col, row: tile.row });
      if (keepReplies) keep("placed", placed);
      break;
    }
  }
  const stepped = await post("/control", { type: "step", ticks: 100, speed: 50 });
  if (keepReplies) keep("stepped", stepped);
  return state();
}

async function playUntil(done: (snapshot: Json) => boolean, keepReplies = true): Promise<Json> {
  for (let i = 0; i < 500; i++) {
    const snapshot = await playStep(keepReplies);
    if (done(snapshot)) return snapshot;
  }
  throw new Error("gave up waiting");
}

async function classic(): Promise<void> {
  keep("level-started", await post("/control", { type: "startLevel", level: "1-1" }));
  await save("1-1-start", await state());

  // 1-1 only has sod in row 2, so the game refuses a plant in row 0.
  const refused = await send("/actions", { type: "placePlant", slot: 0, col: 0, row: 0 });
  if (refused.status !== 409) throw new Error(`expected the game to refuse row 0, got ${refused.status} ${JSON.stringify(refused.body)}`);
  keep("cant-plant-here", refused);

  // The first time through Adventure, the shovel only comes in 1-5.
  const noShovel = await send("/actions", { type: "digUp", col: 0, row: 2 });
  if (noShovel.status !== 409) throw new Error(`expected 1-1 to have no shovel, got ${noShovel.status} ${JSON.stringify(noShovel.body)}`);
  keep("no-shovel", noShovel);

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
  const midgame = await playUntil((s) => s.board.zombies.length >= 2 && s.board.plants.length >= 6);
  await save("1-8-midgame", midgame);

  // The shovel: one of the plants, then a tile with nothing on it.
  const dugPlant = midgame.board.plants[0];
  keep("dug-up", await post("/actions", { type: "digUp", col: dugPlant.col, row: dugPlant.row }));
  // Plants fill the lawn from the top left, so the bottom right is still empty.
  const nothing = await send("/actions", { type: "digUp", col: 8, row: 4 });
  if (nothing.status !== 409) throw new Error(`expected nothing to dig up at column 8, row 4, got ${nothing.status} ${JSON.stringify(nothing.body)}`);
  keep("nothing-to-dig", nothing);

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
}

// Versus levels, as the zombie seat sees them, and the game's answers to sendZombie.
async function versus(): Promise<void> {
  const outside = await send("/actions", { type: "sendZombie", zombie: "zombie", row: 2 });
  if (outside.status !== 409) throw new Error(`expected a send outside versus to be refused, got ${outside.status} ${JSON.stringify(outside.body)}`);
  keep("not-versus", outside);

  // 1-9 makes you choose seeds: the first ones it offers.
  const asked = await send("/control", { type: "startLevel", level: "1-9", versus: true });
  const { choices, pick } = asked.body.error;
  await post("/control", { type: "chooseSeeds", seeds: choices.slice(0, pick) });
  await save("1-9-versus-start", await zombiesView());

  // The first wave pays 1 point: one zombie spends it, and the next costs more than is left.
  await playUntil((s) => s.versus.wave >= 1, false);
  keep("zombie-sent", await post("/actions", { type: "sendZombie", zombie: "zombie", row: 2 }));
  const refused = await send("/actions", { type: "sendZombie", zombie: "zombie", row: 1 });
  if (refused.status !== 409) throw new Error(`expected a send with no points left to be refused, got ${refused.status} ${JSON.stringify(refused.body)}`);
  keep("zombie-refused", refused);

  // A few waves on, with plants up and a conehead walking in that only the zombie seat sees yet.
  await playUntil((s) => s.versus.wave >= 4 && s.board.plants.length >= 6, false);
  await post("/actions", { type: "sendZombie", zombie: "conehead_zombie", row: 0 });
  await save("1-9-versus-midgame", await zombiesView());

  // The first huge wave's warning: a send is held until the wave arrives.
  await playUntil((s) => s.board.progress.hugeWaveIncoming && s.board.progress.wave === 9, false);
  keep("zombie-held", await post("/actions", { type: "sendZombie", zombie: "conehead_zombie", row: 1 }));
  await save("1-9-versus-warning", await zombiesView());

  // The zombies' win: 1-2 with no plants, a zombie down row 2 at each payday, until one gets past the mower.
  await post("/control", { type: "startLevel", level: "1-2", versus: true });
  for (let i = 0; i < 500 && (await state()).board?.result === "playing"; i++) {
    if ((await state()).versus.points > 0) await post("/actions", { type: "sendZombie", zombie: "zombie", row: 2 });
    await post("/control", { type: "step", ticks: 100, speed: 50 });
  }
  const lost = await zombiesView();
  if (lost.board?.result !== "lost") throw new Error(`expected the zombies to win 1-2, got ${JSON.stringify(lost.board?.result)}`);
  await save("1-2-versus-lost", lost);
}

// A match's plant seat: a versus level waiting at its seed chooser, the game's answers to chooseSeeds,
// and the plants' view once the zombie side has been paid.
async function match(): Promise<void> {
  const started = await send("/control", { type: "startLevel", level: "1-9", versus: true });
  if (started.status !== 409) throw new Error(`expected 1-9 to wait at its seed chooser, got ${started.status} ${JSON.stringify(started.body)}`);
  await save("1-9-versus-chooser", await state());

  const asked = await send("/control", { type: "chooseSeeds", seeds: [] });
  if (asked.status !== 409) throw new Error(`expected chooseSeeds with no seeds to list the choices, got ${asked.status} ${JSON.stringify(asked.body)}`);
  keep("seeds-asked-at-chooser", asked);
  const { choices, pick } = asked.body.error;
  const tooFew = await send("/control", { type: "chooseSeeds", seeds: choices.slice(0, 1) });
  if (tooFew.status !== 409) throw new Error(`expected one seed to be refused, got ${tooFew.status} ${JSON.stringify(tooFew.body)}`);
  keep("seeds-refused-at-chooser", tooFew);
  keep("seeds-chosen", await post("/control", { type: "chooseSeeds", seeds: choices.slice(0, pick) }));
  await save("1-9-versus-plants-start", await state());
  const again = await send("/control", { type: "chooseSeeds", seeds: choices.slice(0, pick) });
  if (again.status !== 409) throw new Error(`expected a second chooseSeeds to be refused, got ${again.status} ${JSON.stringify(again.body)}`);
  keep("not-at-seed-chooser", again);

  await save("1-9-versus-plants", await playUntil((s) => s.versus.wave >= 1, false));
}

try {
  if (wanted("classic")) await classic();
  if (wanted("versus")) await versus();
  if (wanted("match")) await match();
  await save("replies", replies);
} finally {
  await game.stop();
}
