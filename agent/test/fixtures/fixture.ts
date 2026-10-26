// Loads game states and replies saved by capture.ts, checked the same way the real client checks them.
import { readFileSync } from "node:fs";
import { GameState, parseReply, type Result } from "../../src/game-client.ts";

export type FixtureName = "1-1-start" | "1-1-zombie" | "1-1-won" | "award-screen" | "1-2-start" | "1-8-start" | "1-8-midgame";
export type ReplyName =
  | "level-started"
  | "seeds-asked"
  | "crazy-dave"
  | "placed"
  | "cant-plant-here"
  | "game-hint"
  | "suns-collected"
  | "award-collected"
  | "stepped"
  | "ran";

export interface SavedReply {
  status: number;
  body: unknown;
}

function load(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
}

export function fixture(name: FixtureName): GameState {
  return GameState.parse(load(name));
}

// The game's answer to one of the requests capture.ts made, as it came over HTTP.
export function savedReply(name: ReplyName): SavedReply {
  const saved = (load("replies") as Record<string, SavedReply | undefined>)[name];
  if (!saved) throw new Error(`replies.json has no "${name}" reply; run pnpm fixtures:capture`);
  return saved;
}

// The same answer, as the client hands it to the rest of the program.
export function reply(name: ReplyName): Result {
  const { status, body } = savedReply(name);
  return parseReply(status, body);
}
