// Calls the game's local API (../../docs/api.md) and checks every reply against the fields this
// program relies on, so a change on the game side fails loudly here instead of confusing Claude.
import { z } from "zod";

const Tile = z.object({ col: z.number().int(), row: z.number().int() });
const Damage = z.enum(["none", "damaged", "badly_damaged"]);
const Armor = z.object({ type: z.string(), damage: Damage });

const SeedPacket = z.object({
  slot: z.number().int(),
  plant: z.string(),
  imitates: z.string().optional(),
  cost: z.number().int(),
  ready: z.boolean(),
  recharge: z.number(),
  plantableTiles: z.array(Tile),
});

const Plant = z.object({
  id: z.number().int(),
  type: z.string(),
  col: z.number().int(),
  row: z.number().int(),
  layer: z.string(),
  asleep: z.boolean(),
  state: z.string().optional(),
  damage: Damage.optional(),
});

const Zombie = z.object({
  id: z.number().int(),
  type: z.string(),
  row: z.number().int(),
  x: z.number(),
  eating: z.boolean(),
  slowed: z.boolean(),
  frozen: z.boolean(),
  buttered: z.boolean(),
  hypnotized: z.boolean(),
  flying: z.boolean(),
  underground: z.boolean(),
  hasArm: z.boolean(),
  hasHead: z.boolean(),
  helm: Armor.nullable(),
  shield: Armor.nullable(),
});

const Board = z.object({
  level: z.number().int(),
  levelName: z.string(),
  stage: z.string(),
  paused: z.boolean(),
  gameTicks: z.number().int(),
  result: z.enum(["playing", "won", "lost"]),
  sun: z.number().int(),
  sunSpendable: z.number().int(),
  shovel: z.boolean(),
  seedPackets: z.array(SeedPacket),
  lawn: z.object({
    rows: z.array(z.enum(["grass", "dirt", "water", "high_ground"])),
    items: z.array(z.object({ type: z.string(), col: z.number().int(), row: z.number().int() })),
    ice: z.array(Tile),
  }),
  plants: z.array(Plant),
  zombies: z.array(Zombie),
  suns: z.array(z.object({ id: z.number().int(), value: z.number().int(), beingCollected: z.boolean() })),
  award: z.object({ id: z.number().int() }).nullable(),
  mowers: z.array(z.object({ row: z.number().int(), kind: z.string(), state: z.string() })),
  progress: z.object({
    wave: z.number().int(),
    totalWaves: z.number().int(),
    meter: z.number(),
    hugeWaveIncoming: z.boolean(),
  }),
});

// In a versus level, the zombie side's points and what it may send; the zombie seat's view adds the
// zombies it's holding and any held zombie's points given back.
const Versus = z.object({
  points: z.number().int(),
  wave: z.number().int(),
  types: z.array(z.object({ zombie: z.string(), cost: z.number().int(), firstWave: z.number().int(), ready: z.boolean() })),
  held: z.array(z.object({ zombie: z.string(), row: z.number().int(), col: z.number().int().optional() })).optional(),
  refunds: z.array(z.object({ zombie: z.string(), row: z.number().int(), reason: z.string() })).optional(),
});

// A seat's view only, the player's or the zombie seat's: this program never asks for the full view.
export const GameState = z.object({
  view: z.enum(["player", "zombies"]),
  appTicks: z.number().int(),
  scene: z.string(),
  clock: z.object({ state: z.string(), speed: z.number().int() }),
  dialogOpen: z.boolean(),
  minimized: z.boolean(),
  board: Board.nullable(),
  versus: Versus.optional(),
});
export type GameState = z.infer<typeof GameState>;
export type BoardState = NonNullable<GameState["board"]>;
export type VersusState = NonNullable<GameState["versus"]>;
export type View = GameState["view"];

const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  reason: z.string().optional(),
  choices: z.array(z.string()).optional(),
  costs: z.array(z.number().int()).optional(),
  pick: z.number().int().optional(),
  zombies: z.array(z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

const Success = z.object({
  ok: z.literal(true),
  appTicks: z.number().int(),
  plant: z.object({ id: z.number().int(), type: z.string(), col: z.number().int(), row: z.number().int() }).optional(),
  collected: z.number().int().optional(),
  value: z.number().int().optional(),
  level: z.number().int().optional(),
  levelName: z.string().optional(),
  zombies: z.array(z.string()).optional(),
  // sendZombie: the zombie that walked on (none while it's held), and the points left.
  zombie: z.object({ id: z.number().int(), type: z.string(), row: z.number().int() }).optional(),
  held: z.literal(true).optional(),
  points: z.number().int().optional(),
});
export type Success = z.infer<typeof Success>;

export type Result = { ok: true; reply: Success } | { ok: false; status: number; error: ApiError };

// Checks the game's answer to an action or control request: a success, or the error it explains.
export function parseReply(status: number, json: unknown): Result {
  if (status >= 200 && status < 300) return { ok: true, reply: Success.parse(json) };
  return { ok: false, status, error: z.object({ error: ApiError }).parse(json).error };
}

export type Action =
  | { type: "placePlant"; slot: number; col: number; row: number }
  | { type: "digUp"; col: number; row: number; plant?: string }
  | { type: "collectSun"; id?: number }
  | { type: "collectAward" }
  | { type: "sendZombie"; zombie: string; row: number; col?: number };

export type Control =
  | { type: "freeze" }
  | { type: "run"; speed?: number }
  | { type: "step"; ticks: number; speed?: number }
  | { type: "startLevel"; level?: number | string; seeds?: string[]; then?: "freeze" | "run" };

// How many times a request is sent while the game answers "busy". Busy means the game didn't pick the
// request up within 2 s and withdrew it, so nothing happened and sending it again is safe. The game's
// loop stalls that long now and then, even after loading.
export const BUSY_ATTEMPTS = 3;

// What the rest of the program needs from the game. GameClient is the real one.
export interface Game {
  state(view?: View): Promise<GameState>; // the player's view unless the zombie seat's is asked for
  act(action: Action): Promise<Result>;
  control(command: Control): Promise<Result>;
}

export class GameClient implements Game {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async state(view: View = "player"): Promise<GameState> {
    const response = await this.request(`/state?view=${view}`);
    if (!response.ok) throw new Error(`GET /state answered ${response.status}: ${await response.text()}`);
    return GameState.parse(await response.json());
  }

  act(action: Action): Promise<Result> {
    return this.send("/actions", action);
  }

  control(command: Control): Promise<Result> {
    return this.send("/control", command);
  }

  private async send(path: string, body: Action | Control): Promise<Result> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = parseReply(response.status, await response.json());
      if (result.ok || result.error.code !== "busy" || attempt === BUSY_ATTEMPTS) return result;
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw new Error(`the game isn't answering at ${this.baseUrl}; is it running with the pvz-lab API?`, { cause });
    }
  }
}
