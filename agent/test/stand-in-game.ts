// A stand-in for the game in the MCP tools' tests. It hands out the given states in order (the last one
// repeats), answers with the game's own recorded replies, and records what it's asked: actions,
// control commands and which view each state was read from.
import type { Action, Control, Game, GameState, Result, View } from "../src/game-client.ts";
import { reply } from "./fixtures/fixture.ts";

export class StandInGame implements Game {
  readonly actions: Action[] = [];
  readonly controls: Control[] = [];
  readonly views: View[] = [];
  readonly replies: Partial<Record<Action["type"], Result>> = {
    placePlant: reply("placed"),
    digUp: reply("dug-up"),
    collectSun: reply("suns-collected"),
    collectAward: reply("award-collected"),
    sendZombie: reply("zombie-sent"),
  };
  readonly controlReplies: Partial<Record<Control["type"], Result>> = {
    step: reply("stepped"),
    run: reply("ran"),
    startLevel: reply("level-started"),
  };
  private readonly states: GameState[];

  constructor(...states: GameState[]) {
    this.states = states;
  }

  async state(view: View = "plants"): Promise<GameState> {
    this.views.push(view);
    return this.states.length > 1 ? this.states.shift()! : this.states[0]!;
  }

  async act(action: Action): Promise<Result> {
    this.actions.push(action);
    const answer = this.replies[action.type];
    if (!answer) throw new Error(`the stand-in has no recorded reply to ${action.type}`);
    return answer;
  }

  async control(command: Control): Promise<Result> {
    this.controls.push(command);
    const answer = this.controlReplies[command.type];
    if (!answer) throw new Error(`the stand-in has no recorded reply to ${command.type}`);
    return answer;
  }
}
