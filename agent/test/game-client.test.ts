// The client against a small local server standing in for the game, to check what it does with
// "busy". The ok and refused answers are the game's own (fixtures/replies.json). The busy answer has
// the shape docs/api.md gives it: the real game can't be made busy on demand.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { BUSY_ATTEMPTS, GameClient } from "../src/game-client.ts";
import { savedReply, type SavedReply } from "./fixtures/fixture.ts";

const busy: SavedReply = {
  status: 503,
  body: { error: { code: "busy", message: "the game didn't pick the request up within 2 seconds" } },
};

// Answers each request with the next answer in the list (the last one repeats) and counts them.
async function standInGame(answers: SavedReply[]): Promise<{ client: GameClient; requests: () => number; close: () => void }> {
  let count = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const answer = answers[Math.min(count, answers.length - 1)]!;
      count++;
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    client: new GameClient(`http://127.0.0.1:${port}`),
    requests: () => count,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

describe("GameClient", () => {
  it("sends a request again while the game is busy, and returns the answer once the game picks it up", async () => {
    const game = await standInGame([busy, busy, savedReply("placed")]);
    const result = await game.client.act({ type: "placePlant", slot: 0, col: 0, row: 2 });
    game.close();
    expect(result.ok).toBe(true);
    expect(game.requests()).toBe(3);
  });

  it("gives up after a few busy answers and returns the busy error", async () => {
    const game = await standInGame([busy]);
    const result = await game.client.control({ type: "startLevel", level: "1-1" });
    game.close();
    expect(result).toMatchObject({ ok: false, status: 503, error: { code: "busy" } });
    expect(game.requests()).toBe(BUSY_ATTEMPTS);
  });

  it("never resends a request the game refused", async () => {
    const game = await standInGame([savedReply("cant-plant-here"), savedReply("placed")]);
    const result = await game.client.act({ type: "placePlant", slot: 0, col: 0, row: 0 });
    game.close();
    expect(result).toMatchObject({ ok: false, status: 409, error: { code: "cant_plant_here" } });
    expect(game.requests()).toBe(1);
  });
});
