// Versus levels through the real game: refusals, the versus start waiting at the seed chooser, the
// game's own waves emptied but for their flag zombies, paydays as each wave arrives (and at each flag
// wave's warning), waves kept on their timer, and a normal level afterwards. The tests run in order
// and share one game.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchGame, readGameConfig, type RunningGame } from "../../src/game-process.ts";
import { GameApi, type Json } from "./api.ts";

// What each wave should pay: the costs of the game's own zombies in it, less the flag zombie, which
// still walks on. Costs come from the level's zombie types; the flag zombie isn't one of them.
function expectedPay(wavesAtStart: string[][], types: Json[]): number[] {
  const cost = new Map<string, number>(types.map((type: Json) => [type.zombie, type.cost]));
  return wavesAtStart.map((wave) =>
    wave.filter((zombie) => zombie !== "flag_zombie").reduce((sum, zombie) => {
      expect(cost.has(zombie), `${zombie} should be one of the level's types`).toBe(true);
      return sum + (cost.get(zombie) ?? 0);
    }, 0),
  );
}

describe("versus levels (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;
  let api: GameApi;

  beforeAll(async () => {
    game = await launchGame(readGameConfig());
    api = new GameApi(game.baseUrl);
  });

  afterAll(async () => {
    await game?.stop();
  });

  it("won't make 1-1 a versus level", async () => {
    const { status, body } = await api.control({ type: "startLevel", level: "1-1", versus: true });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "not_a_versus_level", message: "1-1 can't be played in versus; pick another level" });
    const state = await api.state("full");
    expect(state.versus).toBeUndefined();
    expect(state.versusPending).toBeUndefined();
  }, 150_000);

  it("won't pick seeds when no seed chooser is open, and starts nothing", async () => {
    const before = await api.state();
    const { status, body } = await api.control({ type: "chooseSeeds", seeds: ["peashooter"] });
    expect(status).toBe(409);
    expect(body.error.code).toBe("not_at_seed_chooser");
    const after = await api.state();
    expect(after.scene).toBe(before.scene);
    expect(after.board).toBe(before.board);
  });

  it("drops the versus mark when a versus start is refused for anything but its seeds", async () => {
    // 1-5 opens with Crazy Dave talking, which the API can't click through.
    const { status, body } = await api.control({ type: "startLevel", level: "1-5", versus: true });
    expect(status).toBe(409);
    expect(body.error.code).toBe("needs_input");
    expect((await api.state("full")).versusPending).toBeUndefined();
  }, 150_000);

  let seeds: string[] = [];

  it("starts 1-9 in versus: it waits at the seed chooser, marked but not yet in play", async () => {
    const { status, body } = await api.control({ type: "startLevel", level: "1-9", versus: true });
    expect(status).toBe(409);
    expect(body.error.code).toBe("bad_seeds");
    seeds = body.error.choices.slice(0, body.error.pick);

    const state = await api.state("full");
    expect(state.scene).toBe("level_intro");
    expect(state.versusPending).toBe(true);
    expect(state.versus).toBeUndefined();
  }, 150_000);

  it("stays a versus level when the seeds are picked without repeating it, and empties the waves but for flag zombies", async () => {
    const { status, body } = await api.control({ type: "chooseSeeds", seeds });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, levelName: "1-9", clock: { state: "frozen" } });

    const state = await api.state("full");
    expect(state.versusPending).toBeUndefined();
    const { versus } = state;
    expect(versus).toMatchObject({ points: 0, wave: 0, waveHealthTarget: -1 });
    expect(versus.types.map((type: Json) => type.zombie)).toEqual(["zombie", "conehead_zombie", "pole_vaulting_zombie", "buckethead_zombie"]);

    // Every wave, not just the next three: only the flag waves (the 10th and 20th) keep their flag zombie.
    expect(versus.wavesAtStart).toHaveLength(20);
    expect(versus.wavesNow).toEqual(versus.wavesAtStart.map((_: string[], index: number) => (index === 9 || index === 19 ? ["flag_zombie"] : [])));
    expect(versus.wavesAtStart[9]).toContain("flag_zombie");
    expect(versus.wavesAtStart[19]).toContain("flag_zombie");
    expect(versus.payTable).toEqual(expectedPay(versus.wavesAtStart, versus.types));

    // Both seats see the points and types, but not the full view's extras; the zombie seat also sees
    // the zombies it's holding and the points it got back.
    const player = await api.state("player");
    expect(player.view).toBe("player");
    expect(player.versus).toEqual({ points: 0, wave: 0, types: versus.types });
    const zombies = await api.state("zombies");
    expect(zombies.view).toBe("zombies");
    expect(zombies.versus).toEqual({ ...player.versus, held: [], refunds: [] });
  });

  it("pays each normal wave as it arrives and each flag wave at its warning, keeps waves on their timer, and sends only flag zombies", async () => {
    const payTable: number[] = (await api.state("full")).versus.payTable;
    const arrivedAt: number[] = [];
    let wave = 0;
    let paidAtWarning = false;
    for (let step = 0; step < 2000 && wave < 11; step++) {
      const { status, body } = await api.control({ type: "step", ticks: 50, speed: 50 });
      expect(status, JSON.stringify(body)).toBe(200);
      const state = await api.state("full");
      const { progress } = state.board;

      // Nothing is sent, so only the game's own flag zombies ever walk on.
      for (const zombie of state.board.zombies) expect(zombie.type).toBe("flag_zombie");

      if (progress.hugeWaveIncoming && progress.wave === 9 && !paidAtWarning) {
        // Wave 10 is a flag wave: it pays at its warning, before it arrives.
        expect(state.versus).toMatchObject({ wave: 10, points: payTable[9] });
        paidAtWarning = true;
      }
      if (progress.wave > wave) {
        wave = progress.wave;
        arrivedAt[wave] = state.board.gameTicks;
        // Each payday replaces what was left: nothing carries over from one wave to the next.
        expect(state.versus).toMatchObject({ wave, points: payTable[wave - 1] });
      }
    }
    expect(wave).toBeGreaterThanOrEqual(11);
    expect(paidAtWarning).toBe(true);

    // Normal waves come 2,500 to 3,100 ticks apart on their timer. Without "timer only", the game's
    // kill-fast shortcut would bring an emptied wave's successor about 600 ticks later.
    for (const next of [2, 3, 4, 5, 6, 7, 8, 9, 11]) {
      const [before, after] = [arrivedAt[next - 1], arrivedAt[next]];
      if (before === undefined || after === undefined) throw new Error(`wave ${next - 1} or ${next} never arrived`);
      expect(after - before, `gap before wave ${next}`).toBeGreaterThanOrEqual(2400);
    }
  }, 300_000);

  it("leaves a normal level started afterwards with the game's own waves", async () => {
    const first = await api.control({ type: "startLevel", level: "1-9" });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("bad_seeds");
    const { choices, pick } = first.body.error;
    const { status, body } = await api.control({ type: "chooseSeeds", seeds: choices.slice(0, pick) });
    expect(status, JSON.stringify(body)).toBe(200);

    const state = await api.state("full");
    expect(state.versus).toBeUndefined();
    expect(state.versusPending).toBeUndefined();
    expect(state.board.progress.upcomingWaves[0].length).toBeGreaterThan(0);
  }, 150_000);
});
