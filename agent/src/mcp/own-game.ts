// The game for a chat app: the MCP server starts its own copy the first time a level is started, and
// closes it with the server. (pnpm play starts the game itself and gives the server its address.)
import { GameClient, type Action, type Control, type Game, type GameState, type Result } from "../game-client.ts";
import { launchGame, readGameConfig, type RunningGame } from "../game-process.ts";

// What start_level needs when the server runs its own game.
export interface GameStarter {
  readonly started: boolean;
  start(): Promise<void>;
}

export class OwnGame implements Game, GameStarter {
  private running: RunningGame | undefined;
  private client: GameClient | undefined;
  private starting: Promise<void> | undefined;

  get started(): boolean {
    return this.client !== undefined;
  }

  // Launches the game unless it's running; launches it again if someone closed its window.
  async start(): Promise<void> {
    if (this.running?.exited()) await this.stop();
    if (this.client) return;
    this.starting ??= launchGame(readGameConfig()).then(
      (running) => {
        this.running = running;
        this.client = new GameClient(running.baseUrl);
        console.error(`pvz MCP server: started the game at ${running.baseUrl}`);
      },
      (error: unknown) => {
        this.starting = undefined;
        throw error;
      },
    );
    await this.starting;
  }

  // Closes the game and removes its temporary save folder. (If the server is killed outright instead,
  // Windows still closes the game with it, but the folder stays behind.)
  async stop(): Promise<void> {
    const running = this.running;
    this.running = this.client = this.starting = undefined;
    if (!running) return;
    await running.stop();
    console.error("pvz MCP server: closed the game");
  }

  private get game(): GameClient {
    if (!this.client) throw new Error("no game is running yet");
    return this.client;
  }

  state(): Promise<GameState> {
    return this.game.state();
  }

  act(action: Action): Promise<Result> {
    return this.game.act(action);
  }

  control(command: Control): Promise<Result> {
    return this.game.control(command);
  }
}
