// Sending zombies in versus levels, through the real game. 1-9: the checks, zombies walking on in
// their rows, and the game's early-wave check measuring the zombie side's waves. 3-9: water rows and
// the zombies' win. 5-9: aimed bungees. 1-2: the final flag wave, with zombies held for it, with none,
// and with one sent after it arrives, and the plants' win. The tests run in order and share one game.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchGame, readGameConfig, type RunningGame } from "../../src/game-process.ts";
import { GameApi, type Json } from "./api.ts";

interface Spot {
  plant: string;
  col: number;
  row: number;
}

// Starts a level in versus and picks its seeds: the wanted ones first, then the chooser's others in order.
async function startVersus(api: GameApi, level: string, wanted: string[] = []): Promise<void> {
  const first = await api.control({ type: "startLevel", level, versus: true });
  if (first.status === 200) return;
  expect(first.body.error.code, JSON.stringify(first.body)).toBe("bad_seeds");
  const choices: string[] = first.body.error.choices;
  const seeds = [...wanted.filter((seed) => choices.includes(seed)), ...choices.filter((seed) => !wanted.includes(seed))].slice(0, first.body.error.pick);
  const { status, body } = await api.control({ type: "chooseSeeds", seeds });
  expect(status, JSON.stringify(body)).toBe(200);
}

function send(api: GameApi, zombie: string, row: number, col?: number) {
  return api.act({ type: "sendZombie", zombie, row, ...(col === undefined ? {} : { col }) });
}

// Steps game time 50 ticks at a time, at the fastest speed, until `done` holds for the full view.
async function stepUntil(api: GameApi, done: (state: Json) => boolean, whileWaiting?: (state: Json) => Promise<void>, maxSteps = 4000): Promise<Json> {
  for (let i = 0; i < maxSteps; i++) {
    const state = await api.state("full");
    if (done(state)) return state;
    if (whileWaiting) await whileWaiting(state);
    const { status, body } = await api.control({ type: "step", ticks: 50, speed: 50 });
    expect(status, JSON.stringify(body)).toBe(200);
  }
  throw new Error(`still waiting after ${maxSteps} steps`);
}

const wave = (state: Json): number => state.board.progress.wave;
const plantAt = (state: Json, spot: Omit<Spot, "plant">, plant?: string): boolean =>
  state.board.plants.some((p: Json) => p.col === spot.col && p.row === spot.row && (plant === undefined || p.type === plant));
const aliveOf = (state: Json, ids: number[]): number[] => state.board.zombies.filter((z: Json) => ids.includes(z.id)).map((z: Json) => z.id);

// Collects any sun on screen, then plants the next spot on the list once its packet is ready.
function gardener(api: GameApi, spots: Spot[]): (state: Json) => Promise<void> {
  return async (state) => {
    if (state.board.suns.some((sun: Json) => !sun.beingCollected)) await api.act({ type: "collectSun" });
    const next = spots.find((spot) => !plantAt(state, spot));
    const packet = next && state.board.seedPackets.find((p: Json) => p.plant === next.plant);
    if (next && packet?.ready) await api.act({ type: "placePlant", slot: packet.slot, col: next.col, row: next.row });
  };
}

describe("sending zombies in versus levels (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;
  let api: GameApi;

  beforeAll(async () => {
    game = await launchGame(readGameConfig());
    api = new GameApi(game.baseUrl);
  });

  afterAll(async () => {
    await game?.stop();
  });

  // 1-9: two peashooters guard row 2, and a wall-nut in row 4 holds a zombie up without killing it.
  const garden = () =>
    gardener(api, [
      { plant: "sunflower", col: 0, row: 0 },
      { plant: "peashooter", col: 0, row: 2 },
      { plant: "wall_nut", col: 6, row: 4 },
      { plant: "peashooter", col: 1, row: 2 },
      { plant: "sunflower", col: 1, row: 0 },
    ]);

  it("refuses a send outside a versus level, before the first payday, for a zombie the level doesn't have, and when the request can't be right", async () => {
    const noLevel = await send(api, "zombie", 2);
    expect(noLevel.status).toBe(409);
    expect(noLevel.body.error.code).toBe("not_versus");

    await startVersus(api, "1-9", ["peashooter", "sunflower", "wall_nut"]);

    const early = await send(api, "zombie", 2);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "cant_send_zombie", reason: "too_few_points" });

    const stranger = await send(api, "football_zombie", 2);
    expect(stranger.status).toBe(409);
    expect(stranger.body.error).toMatchObject({
      code: "cant_send_zombie",
      reason: "not_in_level",
      message: "football_zombie isn't one of this level's zombies: zombie, conehead_zombie, pole_vaulting_zombie, buckethead_zombie",
    });

    expect((await send(api, "zombie", 2, 3)).status).toBe(400);
    expect((await send(api, "zombie", 7)).status).toBe(400);
  }, 150_000);

  it("sends a zombie into its row; the zombie seat sees it coming before the plants can", async () => {
    await stepUntil(api, (state) => wave(state) >= 1, garden());
    const { status, body } = await send(api, "zombie", 1);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, zombie: { type: "zombie", row: 1 }, points: 0 });

    const full = await api.state("full");
    const sent = full.board.zombies.find((z: Json) => z.id === body.zombie.id);
    expect(sent).toMatchObject({ type: "zombie", row: 1, onScreen: false });
    expect(full.versus.sentIds).toContain(body.zombie.id);
    expect((await api.state("plants")).board.zombies.map((z: Json) => z.id)).not.toContain(body.zombie.id);
    expect((await api.state("zombies")).board.zombies.map((z: Json) => z.id)).toContain(body.zombie.id);
  });

  it("keeps the next wave on its timer while the zombie side's full wave is alive", async () => {
    const arrived = await stepUntil(api, (state) => wave(state) >= 3, garden());
    expect(plantAt(arrived, { col: 6, row: 4 }, "wall_nut"), "the wall-nut should be up by wave 3").toBe(true);
    const { body } = await send(api, "zombie", 4);
    expect(body.points).toBe(0);

    // The game counts the zombie's 270 health, and comes early once 35-50% of it is gone.
    const full = await api.state("full");
    expect(full.versus.waveHealthStart).toBe(270);
    expect(full.versus.waveHealthTarget).toBeGreaterThanOrEqual(135);
    expect(full.versus.waveHealthTarget).toBeLessThanOrEqual(175);

    const next = await stepUntil(api, (state) => wave(state) >= 4, garden());
    expect(next.board.gameTicks - arrived.board.gameTicks).toBeGreaterThanOrEqual(2400);
    expect(aliveOf(next, [body.zombie.id]), "the wall-nut keeps it alive").toEqual([body.zombie.id]);
  }, 150_000);

  it("never brings the next wave early for part of a wave's points, even once those zombies are dead", async () => {
    const arrived = await api.state("full");
    expect(wave(arrived)).toBe(4);
    expect(plantAt(arrived, { col: 0, row: 2 }, "peashooter"), "a peashooter should guard row 2 by wave 4").toBe(true);
    const { body } = await send(api, "zombie", 2);
    expect(body.points).toBe(1);
    expect((await api.state("full")).versus.waveHealthTarget).toBe(-1);

    const next = await stepUntil(api, (state) => wave(state) >= 5, garden());
    expect(aliveOf(next, [body.zombie.id]), "the peashooters kill it before wave 5").toEqual([]);
    expect(next.board.gameTicks - arrived.board.gameTicks).toBeGreaterThanOrEqual(2400);
  }, 150_000);

  it("brings the next wave early once a full wave is beaten down past its target, before it's wiped out", async () => {
    const arrived = await api.state("full");
    expect(wave(arrived)).toBe(5);
    expect(plantAt(arrived, { col: 1, row: 2 }, "peashooter"), "two peashooters should guard row 2 by wave 5").toBe(true);
    const first = await send(api, "zombie", 2);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    for (let i = 0; i < 4; i++) await api.control({ type: "step", ticks: 50, speed: 50 });
    const second = await send(api, "zombie", 2);
    expect(second.body.points).toBe(0);

    const full = await api.state("full");
    expect(full.versus.waveHealthStart).toBe(540);
    expect(full.versus.waveHealthTarget).toBeGreaterThanOrEqual(270);
    expect(full.versus.waveHealthTarget).toBeLessThanOrEqual(351);

    // The game's rule: once 35-50% of the wave's health is gone, the next wave comes about 2 s later,
    // so it arrives while the wave is beaten down but not wiped out.
    const ours = [first.body.zombie.id, second.body.zombie.id];
    const next = await stepUntil(api, (state) => wave(state) >= 6, garden());
    expect(next.board.gameTicks - arrived.board.gameTicks).toBeLessThan(2400);
    expect(aliveOf(next, ours).length, "the wave isn't wiped out").toBeGreaterThan(0);
    const left = next.board.zombies.filter((z: Json) => ours.includes(z.id)).reduce((sum: number, z: Json) => sum + z.health.current, 0);
    expect(left).toBeLessThanOrEqual(full.versus.waveHealthTarget);
  }, 150_000);

  it("keeps land zombies out of the water until wave 6, as the game does with its own waves (3-9)", async () => {
    await startVersus(api, "3-9");
    await stepUntil(api, (state) => wave(state) >= 1);
    expect((await send(api, "zombie", 0)).status).toBe(200);	// the first zombie down row 0 takes its mower

    const fifth = await stepUntil(api, (state) => wave(state) >= 5);
    expect(fifth.board.lawn.rows[2]).toBe("water");
    const tooSoon = await send(api, "zombie", 2);
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error).toMatchObject({
      code: "cant_send_zombie",
      reason: "row",
      message: "row 2 is water, which zombies that walk only take from wave 6",
    });

    await stepUntil(api, (state) => wave(state) >= 6);
    const inTime = await send(api, "zombie", 2);
    expect(inTime.status, JSON.stringify(inTime.body)).toBe(200);
  }, 150_000);

  it("lets the zombies win down a row whose mower is gone, then refuses any more sends", async () => {
    const state = await api.state("full");
    expect(state.board.mowers.some((mower: Json) => mower.row === 0 && mower.state === "ready"), "row 0's mower should be used").toBe(false);
    expect((await send(api, "zombie", 0)).status).toBe(200);

    const lost = await stepUntil(api, (s) => s.board?.result === "lost");
    expect(lost.scene).toBe("zombies_won");
    const after = await send(api, "zombie", 1);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe("level_ending");
  }, 150_000);

  it("aims a bungee at a tile and keeps the game's bungee rules, holding sends during a flag wave's warning (5-9)", async () => {
    await startVersus(api, "5-9", ["flower_pot"]);
    const start = await api.state("full");
    const pot = start.board.seedPackets.find((p: Json) => p.plant === "flower_pot");
    expect((await api.act({ type: "placePlant", slot: pot.slot, col: 4, row: 1 })).status).toBe(200);

    // Bungees first come in wave 10.
    await stepUntil(api, (state) => wave(state) >= 9);
    const early = await send(api, "bungee_zombie", 1, 4);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ reason: "too_early", message: "bungee_zombie can't come before wave 10, and this is wave 9" });

    // Wave 10 is a flag wave: it pays at its warning, and sends wait for it. One bungee is aimed at the
    // pot; another at an empty tile, which the game's own bungees rarely pick (they favour plants 10,000 to 1).
    await stepUntil(api, (state) => state.board.progress.hugeWaveIncoming && wave(state) === 9);
    const atPot = await send(api, "bungee_zombie", 1, 4);
    expect(atPot.body).toMatchObject({ ok: true, held: true, points: 6 });
    const atEmpty = await send(api, "bungee_zombie", 3, 6);
    expect(atEmpty.body).toMatchObject({ ok: true, held: true, points: 3 });
    const twin = await send(api, "bungee_zombie", 1, 4);
    expect(twin.body).toMatchObject({ ok: true, held: true, points: 0 });
    expect((await api.state("zombies")).versus.held).toEqual([
      { zombie: "bungee_zombie", row: 1, col: 4 },
      { zombie: "bungee_zombie", row: 3, col: 6 },
      { zombie: "bungee_zombie", row: 1, col: 4 },
    ]);

    // When the wave arrives, each bungee drops on its tile; the twin can't take the pot's tile too, so its points come back.
    const arrived = await stepUntil(api, (state) => wave(state) >= 10);
    // The game lists zombies in its own slot order, which reuses freed slots, so sort them by row.
    const bungees = arrived.board.zombies.filter((z: Json) => z.type === "bungee_zombie").sort((a: Json, b: Json) => a.row - b.row);
    expect(bungees.map((z: Json) => ({ row: z.row, targetCol: z.targetCol }))).toEqual([
      { row: 1, targetCol: 4 },
      { row: 3, targetCol: 6 },
    ]);
    const zombiesView = await api.state("zombies");
    expect(zombiesView.versus).toMatchObject({ points: 3, held: [], refunds: [{ zombie: "bungee_zombie", row: 1, reason: "bungee_target" }] });
    // Points are left, so the wave waits for its timer.
    expect((await api.state("full")).versus.waveHealthTarget).toBe(-1);

    const third = await send(api, "bungee_zombie", 1, 4);
    expect(third.status).toBe(409);
    expect(third.body.error).toMatchObject({ reason: "bungee_target", message: "another bungee is already dropping onto that tile" });

    // Spending the rest hands the game the wave: its own flag zombie and three plain zombies, 270 each
    // (the game's count leaves out bungees).
    for (const row of [0, 2, 4]) expect((await send(api, "zombie", row)).status).toBe(200);
    const spent = await api.state("full");
    expect(spent.versus.points).toBe(0);
    expect(spent.versus.waveHealthStart).toBe(4 * 270);

    await stepUntil(api, (state) => !plantAt(state, { col: 4, row: 1 }));
  }, 150_000);

  it("walks the final wave's held zombies on with its flag zombie (1-2)", async () => {
    await startVersus(api, "1-2");
    const warning = await stepUntil(api, (state) => state.board.progress.hugeWaveIncoming && wave(state) === 5);
    expect(warning.board.progress.totalWaves).toBe(6);
    for (const row of [1, 2, 3]) expect((await send(api, "zombie", row)).body).toMatchObject({ held: true });
    expect(warning.board.zombies).toEqual([]);

    // A held zombie is checked against the lawn when it's sent, not when it walks on: 1-2 has grass in rows 1-3 only.
    const { points } = (await api.state("zombies")).versus;
    const dirt = await send(api, "zombie", 0);
    expect(dirt.status).toBe(409);
    expect(dirt.body.error).toMatchObject({ reason: "row", message: "a zombie can't go in row 0" });
    expect((await api.state("zombies")).versus).toMatchObject({ points, held: [{ row: 1 }, { row: 2 }, { row: 3 }] });

    const arrived = await stepUntil(api, (state) => wave(state) >= 6);
    expect(arrived.board.zombies.filter((z: Json) => z.type === "flag_zombie")).toHaveLength(1);
    expect(arrived.board.zombies.filter((z: Json) => z.type === "zombie")).toHaveLength(3);
    expect(arrived.versus.sentIds).toHaveLength(3);
  }, 150_000);

  it("doesn't end the level when the final flag zombie dies while the zombie side's zombies live; the plants win once they're all gone", async () => {
    const ours: number[] = (await api.state("full")).versus.sentIds;
    const flagGone = await stepUntil(api, (state) => !state.board.zombies.some((z: Json) => z.type === "flag_zombie"));
    expect(aliveOf(flagGone, ours).length, "the flag zombie is faster, so it reaches its mower first").toBeGreaterThan(0);
    expect(flagGone.board.result).toBe("playing");

    const won = await stepUntil(api, (state) => state.board.result === "won");
    expect(aliveOf(won, ours)).toEqual([]);

    const after = await send(api, "zombie", 2);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe("level_ending");
    expect((await api.state()).board.result).toBe("won");
  }, 150_000);

  it("brings only its flag zombie when nothing is held for the final wave; once it dies the plants win, and the points left can't be spent (1-2)", async () => {
    await startVersus(api, "1-2");
    const arrived = await stepUntil(api, (state) => wave(state) >= 6);
    expect(arrived.board.zombies.map((z: Json) => z.type)).toEqual(["flag_zombie"]);
    expect(arrived.versus.points).toBeGreaterThan(0);

    // With no plants, the flag zombie's mower takes it, and the game drops the plants' award.
    await stepUntil(api, (state) => state.board.result === "won");
    const after = await send(api, "zombie", 2);
    expect(after.status).toBe(409);
    expect(after.body.error).toMatchObject({ code: "level_ending", message: "the level is over" });
    expect((await api.state()).board.result).toBe("won");
  }, 150_000);

  it("walks a zombie sent after the final wave has arrived on at once, and the level goes on while it lives (1-2)", async () => {
    await startVersus(api, "1-2");
    const arrived = await stepUntil(api, (state) => wave(state) >= 6);
    const flag = arrived.board.zombies.find((z: Json) => z.type === "flag_zombie");
    // Away from the flag zombie's row, so the mower that takes it doesn't take ours too.
    const row = flag.row === 1 ? 2 : 1;
    const sent = await send(api, "zombie", row);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ ok: true, zombie: { type: "zombie", row }, points: arrived.versus.points - 1 });
    expect(sent.body.held).toBeUndefined();

    // The flag zombie walks at 0.45 a tick and plain zombies at 0.23-0.37, so its mower takes it first.
    const flagGone = await stepUntil(api, (state) => !state.board.zombies.some((z: Json) => z.type === "flag_zombie"));
    expect(aliveOf(flagGone, [sent.body.zombie.id])).toEqual([sent.body.zombie.id]);
    expect(flagGone.board.result).toBe("playing");
    await stepUntil(api, (state) => state.board.result === "won");
  }, 150_000);
});
