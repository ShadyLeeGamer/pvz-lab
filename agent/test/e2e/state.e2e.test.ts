// Checks the local API against the real game, sitting at the title screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchGame, readGameConfig, type RunningGame } from "./game.ts";

const config = readGameConfig();

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url);
  expect(response.headers.get("content-type")).toContain("application/json");
  return { status: response.status, body: await response.json() };
}

describe.skipIf(!config)("local API (launches the game; needs agent/.env)", () => {
  let game: RunningGame | undefined;

  beforeAll(async () => {
    game = await launchGame(config!);
  });

  afterAll(async () => {
    await game?.stop();
  });

  it("reports health and the build", async () => {
    const { status, body } = await getJson(`${game!.baseUrl}/health`);
    expect(status).toBe(200);
    expect(body.apiVersion).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.build.commit).toMatch(/^[0-9a-f]{7,}/);
  });

  it("returns the player view by default, with no board outside a level", async () => {
    // The first snapshot arrives with the first game tick.
    await expect.poll(async () => (await getJson(`${game!.baseUrl}/state`)).status, { timeout: 10_000 }).toBe(200);
    const { body } = await getJson(`${game!.baseUrl}/state`);
    expect(body.view).toBe("player");
    expect(["loading", "menu"]).toContain(body.scene);
    expect(body.board).toBeNull();
  });

  it("returns the full view when asked", async () => {
    const { status, body } = await getJson(`${game!.baseUrl}/state?view=full`);
    expect(status).toBe(200);
    expect(body.view).toBe("full");
  });

  it("rejects an unknown view", async () => {
    const { status, body } = await getJson(`${game!.baseUrl}/state?view=everything`);
    expect(status).toBe(400);
    expect(body.error.code).toBe("bad_view");
  });

  it("answers unknown routes with a JSON 404", async () => {
    const { status, body } = await getJson(`${game!.baseUrl}/nope`);
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("keeps time moving", async () => {
    const before = (await getJson(`${game!.baseUrl}/state`)).body.appTicks;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = (await getJson(`${game!.baseUrl}/state`)).body.appTicks;
    expect(after).toBeGreaterThan(before);
  });
});
