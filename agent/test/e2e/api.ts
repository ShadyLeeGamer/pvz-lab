// Small helpers for calling the game's local API from end-to-end tests.
import { Agent, request } from "node:http";
import { expect } from "vitest";

// One pool of reused connections. fetch closes every connection itself (it reads the server's 1 s
// keep-alive hint as "close now"), and each closed connection holds a port for a minute or two, so a
// test making thousands of calls could run out of ports.
const agent = new Agent({ keepAlive: true });

function call(url: string, method: "GET" | "POST", body?: string): Promise<{ status: number; contentType: string; text: string }> {
  return new Promise((resolve, reject) => {
    const headers = body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
    const req = request(url, { method, agent, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, contentType: String(res.headers["content-type"] ?? ""), text }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

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
    const response = await call(`${this.baseUrl}${path}`, "GET");
    expect(response.contentType).toContain("application/json");
    return { status: response.status, body: JSON.parse(response.text) };
  }

  async post(path: string, body: unknown): Promise<ApiResponse> {
    const response = await call(`${this.baseUrl}${path}`, "POST", typeof body === "string" ? body : JSON.stringify(body));
    expect(response.contentType).toContain("application/json");
    return { status: response.status, body: JSON.parse(response.text) };
  }

  async state(view: "player" | "zombies" | "full" = "player"): Promise<Json> {
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
