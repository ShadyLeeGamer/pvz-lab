// Loads game states and replies saved by capture.ts, checked the same way the real client checks them.
import { readFileSync } from "node:fs";
import { GameState, parseReply, type Result } from "../../src/game-client.ts";

export type FixtureName =
  | "1-1-start"
  | "1-1-zombie"
  | "1-1-won"
  | "award-screen"
  | "1-2-start"
  | "1-8-start"
  | "1-8-midgame"
  // The zombie seat's view (view=zombies) of versus levels.
  | "1-9-versus-start"
  | "1-9-versus-midgame"
  | "1-9-versus-warning"
  | "1-2-versus-lost"
  // The plants' view of a versus level: waiting at its seed chooser, at the first moment of play, and
  // once the first wave has paid.
  | "1-9-versus-chooser"
  | "1-9-versus-plants-start"
  | "1-9-versus-plants";
export type ReplyName =
  | "seeds-asked-at-chooser"
  | "seeds-refused-at-chooser"
  | "seeds-chosen"
  | "not-at-seed-chooser"
  | "zombie-sent"
  | "zombie-held"
  | "zombie-refused"
  | "not-versus"
  | "level-started"
  | "seeds-asked"
  | "crazy-dave"
  | "placed"
  | "cant-plant-here"
  | "game-hint"
  | "no-shovel"
  | "dug-up"
  | "nothing-to-dig"
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

// The same state at another game time, for waits that go by the game's clock.
export function fixtureAt(name: FixtureName, gameTicks: number): GameState {
  const state = fixture(name);
  return { ...state, board: { ...state.board!, gameTicks } };
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
