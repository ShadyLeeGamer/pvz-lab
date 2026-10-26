// Launches the real game for end-to-end tests and play sessions, with a throwaway copy of a save folder.
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GameConfig {
  exe: string;
  resDir: string;
  saveTemplate: string;
}

export interface RunningGame {
  baseUrl: string;
  exited(): boolean; // closed by itself or by someone, rather than by stop()
  stop(): Promise<void>;
}

// Reads agent/.env (not committed; see .env.example) into the environment, once.
export function loadEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    // No .env file: use whatever is already in the environment.
  }
}

// The game's paths. Missing ones are an error, never a reason to skip: a test run that tested
// nothing must not look like a pass.
export function readGameConfig(): GameConfig {
  loadEnv();
  const { PVZ_EXE, PVZ_RESDIR, PVZ_SAVE_TEMPLATE } = process.env;
  if (!PVZ_EXE || !PVZ_RESDIR || !PVZ_SAVE_TEMPLATE) {
    const missing = Object.entries({ PVZ_EXE, PVZ_RESDIR, PVZ_SAVE_TEMPLATE }).filter(([, value]) => !value).map(([name]) => name);
    throw new Error(`agent/.env doesn't set ${missing.join(", ")}; copy .env.example to .env and fill in the paths`);
  }
  return { exe: PVZ_EXE, resDir: PVZ_RESDIR, saveTemplate: PVZ_SAVE_TEMPLATE };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

// The API answers as soon as the game starts, but while the game loads, its loop can stall for over a
// second, and a request it doesn't pick up within 2 s is withdrawn as "busy". So wait for "loaded".
async function waitUntilLoaded(baseUrl: string, startFailure: () => Error | undefined, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = startFailure();
    if (failure) throw failure;
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok && (await response.json()).loaded === true) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the game at ${baseUrl} didn't finish loading within ${timeoutMs} ms`);
}

export async function launchGame(config: GameConfig): Promise<RunningGame> {
  const saveDir = await mkdtemp(join(tmpdir(), "pvz-lab-save-"));
  await cp(config.saveTemplate, saveDir, { recursive: true });
  const port = await findFreePort();
  const game: ChildProcess = spawn(config.exe, ["-resdir", config.resDir, "-savedir", saveDir, `-apiport=${port}`], {
    stdio: "ignore",
    // No console window for console builds. The game window still opens.
    windowsHide: true,
    // SDL then shows the game window without activating it, so tests never take the keyboard
    // from whatever you're working in. Don't minimize the window: game time stops while minimized.
    env: { ...process.env, SDL_WINDOW_NO_ACTIVATION_WHEN_SHOWN: "1" },
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  // A bad PVZ_EXE path arrives as an "error" event rather than an exception.
  let launchError: Error | undefined;
  game.once("error", (error) => {
    launchError = new Error(`couldn't start the game at ${config.exe}: ${error.message}`);
  });
  const startFailure = (): Error | undefined => {
    if (launchError) return launchError;
    if (game.exitCode !== null) {
      return new Error(`the game exited early (code ${game.exitCode}); check PVZ_RESDIR and PVZ_SAVE_TEMPLATE`);
    }
    return undefined;
  };

  const stop = async (): Promise<void> => {
    const running = game.pid !== undefined && game.exitCode === null && game.signalCode === null;
    if (running) {
      const exited = new Promise((resolve) => game.once("exit", resolve));
      game.kill();
      await exited;
    }
    await rm(saveDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  try {
    await waitUntilLoaded(baseUrl, startFailure, 60_000);
  } catch (error) {
    await stop();
    throw error;
  }
  return { baseUrl, exited: () => game.exitCode !== null || game.signalCode !== null, stop };
}
