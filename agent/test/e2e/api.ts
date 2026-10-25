// Small helpers for calling the game's local API from end-to-end tests.
import { expect } from "vitest";

// Untyped on purpose: these tests check the JSON the game actually sends, field by field.
export type Json = any;

export interface ApiResponse {
  status: number;
  body: Json;
}

export class GameApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async get(path: string): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}${path}`);
    expect(response.headers.get("content-type")).toContain("application/json");
    return { status: response.status, body: await response.json() };
  }

  async post(path: string, body: unknown): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    expect(response.headers.get("content-type")).toContain("application/json");
    return { status: response.status, body: await response.json() };
  }

  async state(view: "player" | "full" = "player"): Promise<Json> {
    const { status, body } = await this.get(`/state?view=${view}`);
    expect(status).toBe(200);
    return body;
  }

  act(action: Json): Promise<ApiResponse> {
    return this.post("/actions", action);
  }

  control(command: Json): Promise<ApiResponse> {
    return this.post("/control", command);
  }

  // Steps game time until `done` holds for the state, failing after `maxSteps` steps.
  async stepUntil(done: (state: Json) => boolean, options: { ticks?: number; speed?: number; maxSteps?: number } = {}): Promise<Json> {
    const { ticks = 100, speed = 50, maxSteps = 300 } = options;
    for (let i = 0; i < maxSteps; i++) {
      const state = await this.state();
      if (done(state)) return state;
      const { status, body } = await this.control({ type: "step", ticks, speed });
      expect(status, JSON.stringify(body)).toBe(200);
    }
    throw new Error(`still waiting after ${maxSteps} steps of ${ticks} ticks`);
  }
}
