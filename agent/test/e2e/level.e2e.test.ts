// Plays real levels through the local API: starts 1-1 from the title screen, plants, steps time,
// collects sun, wins with a plain script, moves on to the next level, and picks seeds on 1-8.
// The tests run in order and share one game.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameApi, type Json } from "./api.ts";
import { launchGame, readGameConfig, type RunningGame } from "./game.ts";

const config = readGameConfig();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!config)("playing levels through the API (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;
  let api: GameApi;

  beforeAll(async () => {
    game = await launchGame(config!);
    api = new GameApi(game.baseUrl);
  });

  afterAll(async () => {
    await game?.stop();
  });

  it("starts 1-1 from the title screen and freezes at the first moment of play", async () => {
    const { status, body } = await api.control({ type: "startLevel", level: "1-1" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, level: 1, levelName: "1-1", clock: { state: "frozen" } });

    const state = await api.state();
    expect(state.scene).toBe("playing");
    expect(state.clock.state).toBe("frozen");
    expect(state.board).toMatchObject({ levelName: "1-1", gameTicks: 1, sun: 150, plants: [], zombies: [] });
    expect(state.board.lawn.rows).toEqual(["dirt", "dirt", "grass", "dirt", "dirt"]);
    expect(state.board.seedPackets).toHaveLength(1);
    expect(state.board.seedPackets[0]).toMatchObject({ plant: "peashooter", cost: 100, ready: true, recharge: 1 });
    // The game's own rules: in 1-1 only the sodded middle row takes plants.
    expect(state.board.seedPackets[0].plantableTiles).toEqual(Array.from({ length: 9 }, (_, col) => ({ col, row: 2 })));
  }, 150_000);

  it("stays frozen: no game time passes until someone steps", async () => {
    const before = await api.state();
    await sleep(500);
    const after = await api.state();
    expect(after.appTicks).toBe(before.appTicks);
    expect(after.board.gameTicks).toBe(before.board.gameTicks);
  });

  it("refuses a plant the rules forbid, and nothing changes", async () => {
    const { status, body } = await api.act({ type: "placePlant", slot: 0, col: 3, row: 0 });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "cant_plant_here", reason: "not_here" });

    const state = await api.state();
    expect(state.board.sun).toBe(150);
    expect(state.board.seedPackets[0]).toMatchObject({ ready: true, recharge: 1 });
    expect(state.board.plants).toEqual([]);
  });

  it("plants through the game's own clicks: the plant appears, sun is spent, the packet recharges", async () => {
    const { status, body } = await api.act({ type: "placePlant", slot: 0, col: 0, row: 2 });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.plant).toMatchObject({ type: "peashooter", col: 0, row: 2 });

    const state = await api.state();
    expect(state.board.plants).toEqual([expect.objectContaining({ id: body.plant.id, type: "peashooter", col: 0, row: 2 })]);
    expect(state.board.sun).toBe(50);
    expect(state.board.seedPackets[0]).toMatchObject({ ready: false, recharge: 0 });
    expect(state.board.seedPackets[0].plantableTiles).not.toContainEqual({ col: 0, row: 2 });
  });

  it("refuses to plant while the packet recharges", async () => {
    const { status, body } = await api.act({ type: "placePlant", slot: 0, col: 1, row: 2 });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "not_ready", reason: "recharging" });
  });

  it("steps exactly the ticks asked for, then freezes again", async () => {
    const before = await api.state();
    const { status, body } = await api.control({ type: "step", ticks: 100, speed: 10 });
    expect(status).toBe(200);
    expect(body.clock).toMatchObject({ state: "frozen", speed: 10 });

    const after = await api.state();
    expect(after.appTicks - before.appTicks).toBe(100);
    expect(after.board.gameTicks - before.board.gameTicks).toBe(100);
    // A Peashooter takes 750 ticks to recharge.
    expect(after.board.seedPackets[0].recharge).toBeCloseTo(100 / 750, 2);
  });

  it("runs and freezes on request", async () => {
    expect((await api.control({ type: "run", speed: 2 })).status).toBe(200);
    const before = await api.state();
    await sleep(300);
    const running = await api.state();
    expect(running.clock).toMatchObject({ state: "running", speed: 2 });
    expect(running.board.gameTicks).toBeGreaterThan(before.board.gameTicks);

    expect((await api.control({ type: "freeze" })).status).toBe(200);
    const frozen = await api.state();
    await sleep(300);
    expect((await api.state()).board.gameTicks).toBe(frozen.board.gameTicks);
  });

  it("collects a sun: spendable at once, added to the counter when it lands", async () => {
    // The tutorial drops a sun from the sky a few seconds after the first plant.
    const withSun = await api.stepUntil((state) => state.board.suns.some((sun: Json) => !sun.beingCollected), { ticks: 50 });
    const sun = withSun.board.suns.find((s: Json) => !s.beingCollected);

    const { status, body } = await api.act({ type: "collectSun", id: sun.id });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ collected: 1, value: sun.value });

    const collecting = await api.state();
    expect(collecting.board.sun).toBe(withSun.board.sun);
    expect(collecting.board.sunSpendable).toBe(withSun.board.sunSpendable + sun.value);

    const again = await api.act({ type: "collectSun", id: sun.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("no_such_sun");

    const landed = await api.stepUntil((state) => state.board.sun === withSun.board.sun + sun.value, { ticks: 20, maxSteps: 20 });
    expect(landed.board.suns.some((s: Json) => s.id === sun.id)).toBe(false);
  });

  it("wins 1-1 with a plain script: plant when ready, collect sun, collect the award", async () => {
    let sawZombies = false;
    let state: Json = await api.state();
    for (let i = 0; !state.board.award; i++) {
      expect(i, "1-1 should be won within 400 steps").toBeLessThan(400);
      expect(state.board.result).toBe("playing");
      sawZombies ||= state.board.zombies.length > 0;

      if (state.board.suns.some((sun: Json) => !sun.beingCollected)) {
        expect((await api.act({ type: "collectSun" })).status).toBe(200);
      }
      const packet = state.board.seedPackets[0];
      if (packet.ready && packet.plantableTiles.length > 0) {
        const tile = packet.plantableTiles[0];
        const planted = await api.act({ type: "placePlant", slot: 0, col: tile.col, row: tile.row });
        expect(planted.status, JSON.stringify(planted.body)).toBe(200);
      }
      expect((await api.control({ type: "step", ticks: 100, speed: 50 })).status).toBe(200);
      state = await api.state();
    }

    // Zombies only come once the tutorial has finished, so seeing them shows the tutorial ran its course.
    expect(sawZombies).toBe(true);
    expect(state.board.progress.wave).toBe(state.board.progress.totalWaves);
    expect(state.board.result).toBe("won");

    const { status, body } = await api.act({ type: "collectAward" });
    expect(status, JSON.stringify(body)).toBe(200);
    const ending = await api.act({ type: "collectSun" });
    expect(ending.status).toBe(409);
    expect(ending.body.error.code).toBe("level_ending");

    const awardScreen = await api.stepUntil((s) => s.scene === "award", { ticks: 100, maxSteps: 20 });
    expect(awardScreen.board).toBeNull();
    const notPlaying = await api.act({ type: "placePlant", slot: 0, col: 0, row: 2 });
    expect(notPlaying.status).toBe(409);
    expect(notPlaying.body.error.code).toBe("not_playing");
  }, 240_000);

  it("starts the next level from the award screen", async () => {
    // No level given: the profile's current level, which winning 1-1 moved on to 1-2.
    const { status, body } = await api.control({ type: "startLevel" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ level: 2, levelName: "1-2" });

    const state = await api.state();
    expect(state.board).toMatchObject({ levelName: "1-2", sun: 50 });
    expect(state.board.lawn.rows).toEqual(["dirt", "grass", "grass", "grass", "dirt"]);
    expect(state.board.seedPackets.map((packet: Json) => packet.plant)).toEqual(["peashooter", "sunflower"]);
  }, 150_000);

  it("on a level with a seed chooser, lists the choices, then plays with the seeds picked", async () => {
    const refused = await api.control({ type: "startLevel", level: "1-8" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("bad_seeds");
    const { choices, pick } = refused.body.error;
    expect(pick).toBeGreaterThan(0);
    expect(choices).toContain("peashooter");
    expect(choices.length).toBeGreaterThanOrEqual(pick);

    const seeds = choices.slice(choices.length - pick);
    const { status, body } = await api.control({ type: "startLevel", level: "1-8", seeds });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.levelName).toBe("1-8");

    const state = await api.state();
    expect(state.scene).toBe("playing");
    expect(state.board.seedPackets.map((packet: Json) => packet.plant)).toEqual(seeds);
  }, 150_000);

  it("keeps answering while six clients hammer it during play", async () => {
    expect((await api.control({ type: "run", speed: 20 })).status).toBe(200);
    const before = await api.state();

    // Six clients at once, 50 requests each, back to back: state reads mixed with actions.
    const client = async (): Promise<number[]> => {
      const statuses: number[] = [];
      for (let i = 0; i < 50; i++) {
        const response = i % 10 === 0 ? await api.act({ type: "collectSun" }) : await api.get(i % 2 ? "/state" : "/state?view=full");
        statuses.push(response.status);
      }
      return statuses;
    };
    const statuses = (await Promise.all(Array.from({ length: 6 }, client))).flat();
    expect(statuses).toHaveLength(300);
    expect(statuses.filter((status) => status !== 200)).toEqual([]);

    const after = await api.state();
    expect(after.appTicks).toBeGreaterThan(before.appTicks);
    expect((await api.get("/health")).status).toBe(200);
    expect((await api.control({ type: "freeze" })).status).toBe(200);
  }, 60_000);
});
