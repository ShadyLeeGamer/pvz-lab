// The host: plays one Adventure level with a player on each side, from the start to the result.
//   pnpm match <level> --plants human|claude --zombies level|claude [--speed n]
// On the plants' side, "human" is you in the game window. On the zombies' side, "level" is the level's
// own waves; "claude" makes it a versus level. A Claude player is Claude Code, locked down to its side's
// MCP tools (player.ts). pnpm play runs a session file through the same code: Claude on the plants,
// against the level.
// Everything lands in runs/<time>-<name>/: result.json, and for each Claude player a folder named after
// its side, with its session, brief, MCP config, every tool call (moves.jsonl) and Claude Code's output.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { streetLine } from "./board-text.ts";
import { writeBrief } from "./brief.ts";
import { GameClient, type GameState } from "./game-client.ts";
import { launchGame, readGameConfig } from "./game-process.ts";
import { normalizeName, sleep } from "./mcp/shared.ts";
import { findClaude, launchClaudePlayer, type LaunchPlayer, type Player, type PlayerEnd } from "./player.ts";
import { loadSession, MAX_SPEED, Session, SIDES, type LoadedSession, type Side } from "./session.ts";

const serverScript = fileURLToPath(new URL("./mcp/server.ts", import.meta.url));
const promptsDir = new URL("../prompts/", import.meta.url);
// Once the level is decided, each player sees it at its next move and stops. One that hasn't stopped
// after this long is stopped.
const STOP_GRACE_MS = 60_000;

export interface MatchSettings {
  level: number | string;
  plants: "human" | "claude";
  zombies: "level" | "claude";
  speed: number;
  // Matches run in real time (D31). A play session can pause the game while Claude thinks instead.
  clock: "waits" | "realtime";
  // pnpm play's session file: the plants' player gets its tools, seeds, brief and turn limit.
  plantsSession?: LoadedSession;
  name: string; // the run folder's name, after the time
}

const USAGE = "usage: pnpm match <level> --plants human|claude --zombies level|claude [--speed 1-50], e.g. pnpm match 1-9 --plants claude --zombies claude";

export function matchFromFlags(args: string[]): MatchSettings {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { plants: { type: "string" }, zombies: { type: "string" }, speed: { type: "string" } } });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
  const { positionals, values } = parsed;
  const [level] = positionals;
  if (positionals.length !== 1 || !level || !/^[1-5]-([1-9]|10)$/.test(level)) throw new Error(`name one level, from 1-1 to 5-10\n${USAGE}`);
  const { plants, zombies } = values;
  if (plants !== "human" && plants !== "claude") throw new Error(`--plants must be human or claude\n${USAGE}`);
  if (zombies !== "level" && zombies !== "claude") throw new Error(`--zombies must be level or claude\n${USAGE}`);
  const speed = values.speed === undefined ? 1 : Number(values.speed);
  if (!Number.isInteger(speed) || speed < 1 || speed > MAX_SPEED) throw new Error(`--speed must be a whole number from 1 to ${MAX_SPEED}\n${USAGE}`);
  // A person plays at the game's own speed (R34).
  if (plants === "human" && speed !== 1) throw new Error("with --plants human the game runs at normal speed, so leave out --speed");
  return { level, plants, zombies, speed, clock: "realtime", name: `match-${level}` };
}

export function matchFromSession(session: LoadedSession): MatchSettings {
  const { side, level, speed, clock } = session.settings;
  const file = basename(session.path);
  if (side !== "plants") {
    throw new Error(`${file} plays the zombies, and pnpm play plays the plants against the level. For the zombies, use pnpm match <level> --plants claude --zombies claude.`);
  }
  if (level === undefined) {
    throw new Error(`${file} lets the player pick levels with start_level, which is for chat apps (see the README). pnpm play needs a session with a "level".`);
  }
  return { level, plants: "claude", zombies: "level", speed, clock, plantsSession: session, name: basename(session.path, ".json") };
}

// The session the host writes for one side's Claude player in a match. The plants get choose_seeds
// when the level waits at its seed chooser for them.
export function seatSession(settings: MatchSettings, side: Side, chooser: boolean): Session {
  const { level, speed, clock } = settings;
  const brief = (file: string) => fileURLToPath(new URL(file, promptsDir));
  if (side === "zombies") return Session.parse({ side, level, clock: "realtime", speed, tools: ["get_state", "send_zombie", "wait"], brief: brief("zombies.md") });
  const tools = [...(chooser ? ["choose_seeds"] : []), "get_state", "place_plant", "dig_up", "collect_sun", "wait"];
  return Session.parse({ side, level, clock, speed, tools, brief: brief(settings.zombies === "claude" ? "plants-versus.md" : "plants.md") });
}

export interface MatchOptions {
  launchPlayer?: LaunchPlayer; // the end-to-end tests play with scripted players instead of Claude Code
  print?: (line: string) => void;
  runsDir?: string;
  signal?: AbortSignal; // Ctrl+C: stops the players and ends the match
}

export interface PlayerResult {
  toolCalls: number;
  claudeExitCode: number | null;
  finish?: string;
  stoppedBeforeTheEnd: boolean; // it stopped while the level was still being played (D46)
}

export interface MatchResult {
  level: number | string;
  plants: MatchSettings["plants"];
  zombies: MatchSettings["zombies"];
  outcome: string; // the plants' result: won, lost, unfinished, stopped or unknown
  winner: Side | null;
  players: Partial<Record<Side, PlayerResult>>;
  lastGameSecondsSeen: number | null;
  error?: string;
}

function outcomeOf(state: GameState): string {
  if (state.scene === "award" || state.board?.result === "won") return "won";
  if (state.board?.result === "lost") return "lost";
  return "unfinished";
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function resultLine(result: MatchResult): string {
  const { plants, zombies } = result.players;
  // Claude on the plants against the level, as pnpm play has always reported it.
  if (plants && !zombies) return `Result: level ${result.level} ${result.outcome} after ${plural(plants.toolCalls, "tool call")}.`;
  const what = result.winner ? `the ${result.winner} won` : result.outcome;
  const players = SIDES.flatMap((side) => {
    const player = result.players[side];
    if (!player) return [];
    const stopped = player.stoppedBeforeTheEnd ? `, stopped before the end (${player.finish ?? `exit code ${player.claudeExitCode}`})` : "";
    return [`${side === "plants" ? "Plants" : "Zombies"}: ${plural(player.toolCalls, "tool call")}${stopped}.`];
  });
  return [`Result: level ${result.level}: ${what}.`, ...players].join(" ");
}

// Waits for the level's first moment of play, which comes once its seeds are picked (at once for a
// level that doesn't ask). In versus, the zombie side's points come with it. Gives up when giveUp says so.
async function waitForPlay(client: GameClient, versus: boolean, giveUp: () => boolean): Promise<boolean> {
  while (!giveUp()) {
    const state = await client.state().catch(() => undefined);
    if (state?.scene === "playing" && (!versus || state.versus)) return true;
    await sleep(250);
  }
  return false;
}

// The last game time a player was shown, from the summaries in its tool calls (after a win the board
// is gone).
async function lastGameSeconds(movesFile: string): Promise<number | undefined> {
  if (!existsSync(movesFile)) return undefined;
  const times = [...(await readFile(movesFile, "utf8")).matchAll(/Game time ([\d.]+) s/g)].map((match) => Number(match[1]));
  return times.at(-1);
}

export async function runMatch(settings: MatchSettings, options: MatchOptions = {}): Promise<{ runDir: string; result: MatchResult }> {
  const { launchPlayer = launchClaudePlayer, print = (line: string) => console.log(line), signal } = options;
  const { level, speed, clock } = settings;
  const versus = settings.zombies === "claude";
  const claudeSides = SIDES.filter((side) => settings[side] === "claude");
  // Each line is marked with its side when two Claude players share the terminal. While a person
  // plays, the other side's words and moves only go to the run folder (D33).
  const label = (side: Side) => (claudeSides.length === 2 ? `[${side}] ` : "");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(options.runsDir ?? fileURLToPath(new URL("../runs/", import.meta.url)), `${stamp}-${settings.name}`);
  await mkdir(runDir, { recursive: true });
  print(`Run folder: ${runDir}`);

  const game = await launchGame(readGameConfig());
  const players = new Map<Side, Player>();
  const ends = new Map<Side, PlayerEnd>();
  const stoppedEarly = new Set<Side>();
  const settled: Promise<void>[] = []; // each player's end, once it's been recorded
  let decided: string | undefined;
  const stopAll = (): void => {
    for (const player of players.values()) player.stop();
  };
  signal?.addEventListener("abort", stopAll);

  try {
    const client = new GameClient(game.baseUrl);

    const startPlayer = async (side: Side, chooser: boolean, street: string): Promise<void> => {
      const dir = join(runDir, side);
      await mkdir(dir, { recursive: true });
      // pnpm play's player keeps its own session file; a match writes one for each Claude player.
      let session: LoadedSession;
      if (side === "plants" && settings.plantsSession) {
        session = settings.plantsSession;
        await copyFile(session.path, join(dir, "session.json"));
      } else {
        await writeFile(join(dir, "session.json"), `${JSON.stringify(seatSession(settings, side, chooser), null, 2)}\n`);
        session = await loadSession(join(dir, "session.json"));
      }
      const brief = writeBrief(await readFile(session.briefPath, "utf8"), session.settings);
      await writeFile(join(dir, "brief.md"), brief);
      let prompt = "Play the zombies.";
      if (side === "plants") prompt = chooser ? "Choose your seed packets with choose_seeds, then play the level." : "Play the level.";
      if (side === "plants" && street) prompt += ` ${street}`;

      const player = launchPlayer({
        side,
        session,
        brief,
        prompt,
        dir,
        server: {
          command: process.execPath,
          args: [serverScript],
          env: { PVZ_API_URL: game.baseUrl, PVZ_SESSION: session.path, PVZ_LOG: join(dir, "moves.jsonl"), PVZ_NO_INSTRUCTIONS: "1" },
        },
        print: side === "zombies" && settings.plants === "human" ? undefined : (line) => print(`${label(side)}${line}`),
      });
      players.set(side, player);
      const failed = (error: Error): PlayerEnd => {
        console.error(`The ${side}' player failed: ${error.message}`);
        return { exitCode: null, toolCalls: 0 };
      };
      // It stopped early if the level was still being played when it stopped. A player usually stops
      // because a tool told it the level is over, before the host's next look, so the game is asked.
      const ended = async (end: PlayerEnd): Promise<void> => {
        const state = decided === undefined && !signal?.aborted ? await client.state().catch(() => undefined) : undefined;
        if (state && outcomeOf(state) === "unfinished") stoppedEarly.add(side);
        ends.set(side, end);
      };
      settled.push(player.done.catch(failed).then(ended));
    };
    const somebodyPlays = (): boolean => settings.plants === "human" || [...players.keys()].some((side) => !ends.has(side));

    print(`Starting level ${level}${versus ? " in versus" : ""}...`);
    const seeds = settings.plantsSession?.settings.seeds?.map(normalizeName);
    const started = await client.control({ type: "startLevel", level, seeds, then: "freeze", ...(versus ? { versus } : {}) });
    // A level from 1-8 on waits at its seed chooser, for a person or for a player that can choose there.
    const canChoose = settings.plants === "human" || settings.plantsSession === undefined || settings.plantsSession.settings.tools.includes("choose_seeds");
    let chooser = false;
    let street: string;
    if (started.ok) {
      street = streetLine(started.reply.zombies);
      if (seeds) {
        // A level that doesn't let you choose (any before 1-8, and the conveyor-belt ones) ignores seeds.
        const packets = (await client.state()).board?.seedPackets.map((packet) => packet.plant) ?? [];
        if (JSON.stringify(packets) !== JSON.stringify(seeds)) {
          throw new Error(`level ${level} doesn't let you choose seeds (it gives you ${packets.join(", ") || "none"}), so take "seeds" out of the session file`);
        }
      }
    } else if (started.error.code === "bad_seeds" && started.error.choices && !seeds && canChoose) {
      chooser = true;
      street = streetLine(started.error.zombies);
    } else {
      const { message, choices, pick } = started.error;
      const hint = choices ? ` Set "seeds" in the session file to ${pick} of: ${choices.join(", ")}.` : "";
      throw new Error(`couldn't start level ${level}: ${message}.${hint}`);
    }
    // What the level's intro showed on the street, which a player sees before playing.
    if (street) print(street);

    if (settings.plants === "human") {
      const running = await client.control({ type: "run", speed: 1 });
      if (!running.ok) throw new Error(`couldn't start game time: ${running.error.message}`);
      print(chooser ? "Your turn: pick your seed packets in the game window, then play." : "Your turn: play in the game window.");
    } else {
      print(clock === "waits" ? `The game is paused while Claude thinks; each wait plays at ${speed}x.` : `Game time will run at ${speed}x.`);
      await startPlayer("plants", chooser, street);
    }

    const playing = await waitForPlay(client, versus, () => game.exited() || signal?.aborted === true || (settings.plants === "claude" && ends.has("plants")));
    if (playing && settings.zombies === "claude") await startPlayer("zombies", false, street);
    // Game time starts once every Claude player is up, as pnpm play has always done. A person's game
    // runs from the start.
    if (playing && clock === "realtime" && settings.plants === "claude") {
      const ready = await Promise.all([...players.values()].map((player) => player.ready));
      if (ready.some(Boolean)) {
        const running = await client.control({ type: "run", speed });
        if (running.ok) print(`Game time is running at ${speed}x.`);
        else {
          console.error(`Stopping the run: couldn't start game time: ${running.error.message}`);
          stopAll();
        }
      }
    }

    // Plays on until the game decides the level, while anyone still plays. A player that stops early
    // is left as it is (D46).
    let paidWave = 0;
    const told = new Set<Side>();
    while (playing && decided === undefined && somebodyPlays() && !game.exited() && !signal?.aborted) {
      await sleep(1000);
      const state = await client.state().catch(() => undefined); // the game may be closing
      if (!state) continue;
      if (outcomeOf(state) !== "unfinished") decided = outcomeOf(state);
      if (state.versus && state.versus.wave > paidWave) {
        paidWave = state.versus.wave;
        print(`${label("zombies")}Wave ${paidWave} paid the zombie side: ${plural(state.versus.points, "point")} to spend.`);
      }
      for (const side of stoppedEarly) {
        if (told.has(side) || !somebodyPlays()) continue;
        told.add(side);
        const end = ends.get(side);
        print(`The ${side}' player stopped (${end?.finish ?? `exit code ${end?.exitCode}`}); the level plays on without it.`);
      }
    }
    if (decided !== undefined) {
      const grace = new Promise<void>((resolve) => setTimeout(resolve, STOP_GRACE_MS).unref());
      await Promise.race([Promise.all(settled), grace]);
    }
    stopAll();
    await Promise.all(settled);

    // Ctrl+C reaches every program in the terminal, so the game may have closed as well.
    let final: GameState | undefined;
    let readError: string | undefined;
    try {
      final = await client.state();
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    const played = decided ?? (final ? outcomeOf(final) : undefined);
    const outcome = played && played !== "unfinished" ? played : signal?.aborted ? "stopped" : (played ?? "unknown");
    if (outcome === "unknown") console.error(`Couldn't read how the level ended: ${readError}`);
    const seconds = (await Promise.all([...players.keys()].map((side) => lastGameSeconds(join(runDir, side, "moves.jsonl"))))).filter((time) => time !== undefined);
    const result: MatchResult = {
      level,
      plants: settings.plants,
      zombies: settings.zombies,
      outcome,
      winner: outcome === "won" ? "plants" : outcome === "lost" ? "zombies" : null,
      players: Object.fromEntries(
        [...ends].map(([side, end]) => [side, { toolCalls: end.toolCalls, claudeExitCode: end.exitCode, finish: end.finish, stoppedBeforeTheEnd: stoppedEarly.has(side) }]),
      ),
      lastGameSecondsSeen: seconds.length > 0 ? Math.max(...seconds) : null,
      ...(outcome === "unknown" ? { error: readError } : {}),
    };
    await writeFile(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    print(resultLine(result));
    return { runDir, result };
  } finally {
    signal?.removeEventListener("abort", stopAll);
    stopAll();
    await Promise.all(settled);
    await game.stop();
  }
}

// Ctrl+C stops the run but still tidies up: the players and the game close, and result.json says
// "stopped". A second Ctrl+C quits at once.
export async function runFromCommandLine(settings: MatchSettings): Promise<void> {
  if (settings.plants === "claude" || settings.zombies === "claude") findClaude(); // a wrong CLAUDE_BIN fails before the game starts
  const stopping = new AbortController();
  process.on("SIGINT", () => {
    if (stopping.signal.aborted) process.exit(130);
    console.error("Stopping the run (Ctrl+C). Press it again to quit at once.");
    stopping.abort();
  });
  await runMatch(settings, { signal: stopping.signal });
}

if (import.meta.main) {
  let settings: MatchSettings;
  try {
    settings = matchFromFlags(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  await runFromCommandLine(settings);
}
