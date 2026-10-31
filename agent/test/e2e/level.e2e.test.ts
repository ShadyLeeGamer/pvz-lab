// Plays real levels through the local API: starts 1-1 from the title screen, plants, steps time,
// collects sun, wins with a plain script, moves on to the next level, picks seeds on 1-8, and starts
// a level in each later world. The tests run in order and share one game.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchGame, readGameConfig, type RunningGame } from "../../src/game-process.ts";
import { GameApi, type Json } from "./api.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("playing levels through the API (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;
  let api: GameApi;

  beforeAll(async () => {
    game = await launchGame(readGameConfig());
    api = new GameApi(game.baseUrl);
  });

  afterAll(async () => {
    await game?.stop();
  });

  it("starts 1-1 from the title screen and freezes at the first moment of play", async () => {
    const { status, body } = await api.control({ type: "startLevel", level: "1-1" });
    expect(status, JSON.stringify(body)).toBe(200);
    // The intro's street shows 1-1's only zombie type.
    expect(body).toMatchObject({ ok: true, level: 1, levelName: "1-1", clock: { state: "frozen" }, zombies: ["zombie"] });

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
    expect(body.error).toMatchObject({
      code: "cant_plant_here",
      reason: "not_here",
      message: "peashooter can't go at column 3, row 0: that tile is dirt, where nothing grows",
    });

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
    expect(body.error).toMatchObject({ code: "not_ready", reason: "recharging", message: "peashooter isn't ready: it's still recharging (0% done)" });
  });

  it("has no shovel in 1-1 the first time through Adventure, so digging up is refused", async () => {
    const before = await api.state();
    expect(before.board.shovel).toBe(false);
    const { status, body } = await api.act({ type: "digUp", col: 0, row: 2 });
    expect(status).toBe(409);
    expect(body.error).toEqual({ code: "no_shovel", message: "there's no shovel in this level" });
    expect((await api.state()).board.plants).toEqual(before.board.plants);
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
    const types = new Set<string>();
    let state: Json = await api.state();
    for (let i = 0; !state.board.award; i++) {
      expect(i, "1-1 should be won within 400 steps").toBeLessThan(400);
      expect(state.board.result).toBe("playing");
      sawZombies ||= state.board.zombies.length > 0;
      for (const zombie of state.board.zombies) types.add(zombie.type);

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
    // Only what the street showed came, plus the flag zombie leading the last wave, which the street never shows.
    for (const type of types) expect(["zombie", "flag_zombie"]).toContain(type);
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

  it("starts each later level up to 1-7 without asking for seeds (1-5 is a mini-game that opens with Crazy Dave)", async () => {
    for (const levelName of ["1-3", "1-4", "1-6", "1-7"]) {
      const { status, body } = await api.control({ type: "startLevel", level: levelName });
      expect(status, `${levelName}: ${JSON.stringify(body)}`).toBe(200);
      const state = await api.state();
      expect(state.scene).toBe("playing");
      expect(state.board.levelName).toBe(levelName);
      expect(state.board.seedPackets.length).toBeGreaterThan(0);
    }
    const bowling = await api.control({ type: "startLevel", level: "1-5" });
    expect(bowling.status).toBe(409);
    expect(bowling.body.error.code).toBe("needs_input");
  }, 240_000);

  it("from 1-6 on, digs up a plant with the shovel: the plant goes and no sun comes back", async () => {
    const started = await api.control({ type: "startLevel", level: "1-6" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const state = await api.state();
    expect(state.board.shovel).toBe(true);
    const sunflower = state.board.seedPackets.find((packet: Json) => packet.plant === "sunflower");
    const tile = sunflower.plantableTiles[0];
    const planted = await api.act({ type: "placePlant", slot: sunflower.slot, col: tile.col, row: tile.row });
    expect(planted.status, JSON.stringify(planted.body)).toBe(200);
    const sunLeft = (await api.state()).board.sun;

    const { status, body } = await api.act({ type: "digUp", col: tile.col, row: tile.row });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.plant).toEqual({ id: planted.body.plant.id, type: "sunflower", col: tile.col, row: tile.row });
    const after = await api.state();
    expect(after.board.plants).toEqual([]);
    expect(after.board.sun).toBe(sunLeft);

    const nothing = await api.act({ type: "digUp", col: tile.col, row: tile.row });
    expect(nothing.status).toBe(409);
    expect(nothing.body.error).toEqual({ code: "cant_dig_up", message: `there's nothing to dig up at column ${tile.col}, row ${tile.row}` });
    const offLawn = await api.act({ type: "digUp", col: 0, row: 5 });
    expect(offLawn.body.error).toEqual({ code: "cant_dig_up", message: "the lawn only has rows 0 to 4" });
  }, 150_000);

  it("on a level with a seed chooser, lists the choices, then plays with the seeds picked", async () => {
    const before = (await api.state()).appTicks;
    const refused = await api.control({ type: "startLevel", level: "1-8" });
    const atChooser = (await api.state()).appTicks;
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("bad_seeds");
    const { choices, pick, zombies } = refused.body.error;
    expect(pick).toBeGreaterThan(0);
    expect(choices).toContain("peashooter");
    expect(choices.length).toBeGreaterThanOrEqual(pick);
    // The street next to the seed chooser: more than 1-1's plain zombies by now.
    expect(zombies).toContain("zombie");
    expect(zombies.length).toBeGreaterThan(1);

    const seeds = choices.slice(choices.length - pick);
    const { status, body } = await api.control({ type: "startLevel", level: "1-8", seeds });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.levelName).toBe("1-8");
    expect(body.zombies).toEqual(zombies);
    // The seeds were picked on the chooser already open, as a player does, so the level played is the one whose
    // street was shown. Starting it again would pick new waves, and replay the intro up to the chooser first
    // (about as long again: 450 + 462 ticks instead of 462).
    expect(body.appTicks - atChooser).toBeLessThan((atChooser - before) * 1.5);

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

  it("starts a level in each later world once given seeds, and refuses levels that open with Crazy Dave", async () => {
    for (const [levelName, stage] of [["2-7", "night"], ["3-2", "pool"], ["4-2", "fog"], ["5-2", "roof"]]) {
      const asked = await api.control({ type: "startLevel", level: levelName });
      expect(asked.body.error?.code, `${levelName}: ${JSON.stringify(asked.body)}`).toBe("bad_seeds");
      const seeds = asked.body.error.choices.slice(0, asked.body.error.pick);
      const { status, body } = await api.control({ type: "startLevel", level: levelName, seeds });
      expect(status, `${levelName}: ${JSON.stringify(body)}`).toBe(200);
      expect(body.zombies, levelName).toEqual(asked.body.error.zombies);
      // The game always shows a ducky tube zombie on the street of a pool level.
      if (stage === "pool") expect(body.zombies).toContain("ducky_tube_zombie");
      const state = await api.state();
      expect(state.board).toMatchObject({ levelName, stage });
      expect(state.board.seedPackets.map((packet: Json) => packet.plant)).toEqual(seeds);
    }
    const dave = await api.control({ type: "startLevel", level: "2-1" });
    expect(dave.status).toBe(409);
    expect(dave.body.error.code).toBe("needs_input");
  }, 300_000);

  it("digs up stacked plants the way a player's clicks do: the plant, a pumpkin by its rim, the pot last", async () => {
    // Roof levels start with flower pots in the first three columns, so a tile there can hold a pot,
    // a plant and a pumpkin.
    const asked = await api.control({ type: "startLevel", level: "5-2" });
    const { choices, pick } = asked.body.error;
    const wanted = ["puff_shroom", "pumpkin"];
    expect(choices).toEqual(expect.arrayContaining(wanted));
    const seeds = [...wanted, ...choices.filter((choice: string) => !wanted.includes(choice))].slice(0, pick);
    const started = await api.control({ type: "startLevel", level: "5-2", seeds });
    expect(started.status, JSON.stringify(started.body)).toBe(200);

    const [puff, pumpkin] = [0, 1];
    const [col, row] = [0, 2]; // next to the house, where zombies take longest to reach
    const plant = async (slot: number) => {
      const planted = await api.act({ type: "placePlant", slot, col, row });
      expect(planted.status, JSON.stringify(planted.body)).toBe(200);
    };
    const dig = (name?: string) => api.act({ type: "digUp", col, row, ...(name ? { plant: name } : {}) });
    const onTile = async () =>
      (await api.state()).board.plants
        .filter((p: Json) => p.col === col && p.row === row)
        .map((p: Json) => p.type)
        .sort();

    expect(await onTile()).toEqual(["flower_pot"]);
    await plant(puff);
    expect((await dig("flower_pot")).body.error).toEqual({ code: "cant_dig_up", message: "the puff_shroom on that flower_pot has to be dug up first" });

    // The pumpkin costs 125 sun: collect what falls until it's ready.
    let state = await api.state();
    for (let i = 0; !state.board.seedPackets[pumpkin].ready; i++) {
      expect(i, "the pumpkin should be ready within 300 steps").toBeLessThan(300);
      if (state.board.suns.some((sun: Json) => !sun.beingCollected)) expect((await api.act({ type: "collectSun" })).status).toBe(200);
      expect((await api.control({ type: "step", ticks: 50, speed: 50 })).status).toBe(200);
      state = await api.state();
    }
    await plant(pumpkin);
    expect(await onTile()).toEqual(["flower_pot", "puff_shroom", "pumpkin"]);

    // No plant named: what a click on the middle of the tile digs up, the plant inside the pumpkin.
    const middle = await dig();
    expect(middle.body.plant, JSON.stringify(middle.body)).toMatchObject({ type: "puff_shroom", col, row });
    expect(await onTile()).toEqual(["flower_pot", "pumpkin"]);
    expect((await dig("flower_pot")).body.error.message).toBe("the pumpkin on that flower_pot has to be dug up first");

    // The pumpkin by name, with a plant inside it again: the game digs it up when its rim is clicked.
    await api.stepUntil((s) => s.board.seedPackets[puff].ready);
    await plant(puff);
    const rim = await dig("pumpkin");
    expect(rim.body.plant, JSON.stringify(rim.body)).toMatchObject({ type: "pumpkin", col, row });
    expect(await onTile()).toEqual(["flower_pot", "puff_shroom"]);
    expect((await dig("pumpkin")).body.error.message).toBe(`there's no pumpkin at column ${col}, row ${row}, only a flower_pot and a puff_shroom`);
  }, 150_000);

  it("explains refusals: the game's own hint where it has one, what a packet costs, and what's on a taken tile", async () => {
    const seeds = ["puff_shroom", "grave_buster", "sun_shroom", "fume_shroom", "wall_nut", "cherry_bomb"];
    const { status, body } = await api.control({ type: "startLevel", level: "2-7", seeds });
    expect(status, JSON.stringify(body)).toBe(200);
    const state = await api.state();
    const packets: Json[] = state.board.seedPackets;
    const puff = packets.findIndex((packet) => packet.plant === "puff_shroom");

    // Not ready: the numbers, since the game only darkens the packet or flashes the sun counter.
    const pricey = packets.find((packet) => packet.recharge === 1 && packet.cost > state.board.sunSpendable);
    expect(pricey, "a recharged packet that costs more than the starting sun").toBeDefined();
    const unaffordable = await api.act({ type: "placePlant", slot: pricey.slot, col: 4, row: 2 });
    expect(unaffordable.body.error).toMatchObject({
      reason: "not_enough_sun",
      message: `${pricey.plant} isn't ready: it costs ${pricey.cost} sun and you have ${state.board.sunSpendable}`,
    });
    const charging = packets.find((packet) => packet.recharge < 1);
    expect(charging, "a packet that starts the level recharging").toBeDefined();
    const early = await api.act({ type: "placePlant", slot: charging.slot, col: 4, row: 2 });
    expect(early.body.error).toMatchObject({
      reason: "recharging",
      message: `${charging.plant} isn't ready: it's still recharging (${Math.floor(charging.recharge * 100)}% done)`,
    });

    // A rule the game explains to players: its own hint, in the game's words.
    const grave = state.board.lawn.items.find((item: Json) => item.type === "grave");
    expect(grave, "2-7 starts with gravestones").toBeDefined();
    const onGrave = await api.act({ type: "placePlant", slot: puff, col: grave.col, row: grave.row });
    expect(onGrave.body.error.reason).toBe("not_on_grave");
    // The game's own words from its string table (English game data), not the key or a sentence of ours.
    expect(onGrave.body.error.message).toBe(`puff_shroom can't go at column ${grave.col}, row ${grave.row}: You can't plant on graves`);

    // A taken tile: the game shows nothing, so the reply says what's there.
    const tile = packets[puff].plantableTiles[0];
    expect((await api.act({ type: "placePlant", slot: puff, col: tile.col, row: tile.row })).status).toBe(200);
    await api.stepUntil((s) => s.board.seedPackets[puff].ready);
    const taken = await api.act({ type: "placePlant", slot: puff, col: tile.col, row: tile.row });
    expect(taken.body.error).toMatchObject({
      reason: "not_here",
      message: `puff_shroom can't go at column ${tile.col}, row ${tile.row}: there's already a puff_shroom there`,
    });
  }, 150_000);
});
