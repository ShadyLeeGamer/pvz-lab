// Plays one session with Claude Code as the player:
//   pnpm play sessions/1-1-single-actions.json
// It launches its own copy of the game and starts the session's level, then runs Claude Code locked
// down so the session's MCP tools are all it can use: no shell, files or web, and none of your own
// settings. Everything lands in runs/<time>-<session>/: the session, the brief, every tool call
// (moves.jsonl), Claude's own output (claude.jsonl) and the result.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { streetLine } from "./board-text.ts";
import { writeBrief } from "./brief.ts";
import { describeEvent } from "./claude-events.ts";
import { GameClient, type GameState } from "./game-client.ts";
import { launchGame, loadEnv, readGameConfig } from "./game-process.ts";
import { normalizeName } from "./mcp/shared.ts";
import { loadSession } from "./session.ts";

const SERVER_NAME = "pvz";
const serverScript = fileURLToPath(new URL("./mcp/server.ts", import.meta.url));

// Which Claude Code plays: CLAUDE_BIN in agent/.env, else the program an npm global install or the
// native installer puts on this machine, else claude.exe on the PATH. (npm's own `claude` on the PATH is
// a .cmd wrapper, which can't be started without a shell, so the program inside it is used instead.)
function findClaude(): { command: string; prefix: string[] } {
  loadEnv();
  const configured = process.env.CLAUDE_BIN;
  if (configured) {
    if (!existsSync(configured)) throw new Error(`CLAUDE_BIN in agent/.env points to ${configured}, which doesn't exist`);
    return configured.endsWith(".js") ? { command: process.execPath, prefix: [configured] } : { command: configured, prefix: [] };
  }
  const installed = [
    join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    join(process.env.USERPROFILE ?? "", ".local", "bin", "claude.exe"),
  ].find((path) => existsSync(path));
  return { command: installed ?? "claude.exe", prefix: [] };
}

// The player's environment: none of this session's Claude Code variables (a player is its own
// session, not a child of this one), except CLAUDE_CONFIG_DIR, which picks your account's profile.
// No API key either, so it plays on the subscription, never on paid API. Claude Code's memory and
// CLAUDE.md files are off too: a player started inside this repo was given the notes Claude Code
// keeps about the project.
function playerEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name === "ANTHROPIC_API_KEY" || name === "ANTHROPIC_AUTH_TOKEN") continue;
    if (name.startsWith("CLAUDE") && name !== "CLAUDE_CONFIG_DIR") continue;
    env[name] = value;
  }
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  return env;
}

function outcomeOf(state: GameState): string {
  if (state.scene === "award" || state.board?.result === "won") return "won";
  if (state.board?.result === "lost") return "lost";
  return "unfinished";
}

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error("usage: pnpm play <session file>, e.g. pnpm play sessions/1-1-single-actions.json");
  process.exit(1);
}

const session = await loadSession(sessionFile);
const { level, seeds, clock, speed, maxTurns, tools } = session.settings;
if (level === undefined) {
  console.error(`${sessionFile} lets the player pick levels with start_level, which is for chat apps (see the README). pnpm play needs a session with a "level".`);
  process.exit(1);
}
const claude = findClaude();
const gameConfig = readGameConfig();

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = fileURLToPath(new URL(`../runs/${stamp}-${basename(session.path, ".json")}/`, import.meta.url));
await mkdir(runDir, { recursive: true });
const brief = writeBrief(await readFile(session.briefPath, "utf8"), session.settings);
await copyFile(session.path, join(runDir, "session.json"));
await writeFile(join(runDir, "brief.md"), brief);
console.log(`Run folder: ${runDir}`);

// Ctrl+C stops the run but still tidies up: Claude Code and the game close, the temporary folders
// go, and result.json says "stopped". A second Ctrl+C quits at once.
let interrupted = false;
let stopPlayer: (() => void) | undefined;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.error("Stopping the run (Ctrl+C). Press it again to quit at once.");
  stopPlayer?.();
});

const game = await launchGame(gameConfig);
let playerDir: string | undefined;
try {
  const client = new GameClient(game.baseUrl);
  console.log(`Starting level ${level}...`);
  // Frozen at first either way: with the realtime clock, game time starts once Claude Code is ready.
  const seedNames = seeds?.map(normalizeName);
  const started = await client.control({ type: "startLevel", level, seeds: seedNames, then: "freeze" });
  if (!started.ok) {
    const { message, choices, pick } = started.error;
    const hint = choices ? ` Set "seeds" in the session file to ${pick} of: ${choices.join(", ")}.` : "";
    throw new Error(`couldn't start level ${level}: ${message}.${hint}`);
  }
  if (seedNames) {
    // A level that doesn't let you choose (any before 1-8, and the conveyor-belt ones) ignores seeds.
    const packets = (await client.state()).board?.seedPackets.map((packet) => packet.plant) ?? [];
    if (JSON.stringify(packets) !== JSON.stringify(seedNames)) {
      throw new Error(`level ${level} doesn't let you choose seeds (it gives you ${packets.join(", ") || "none"}), so take "seeds" out of the session file`);
    }
  }
  // What the level's intro showed on the street, which a player sees before playing.
  const street = streetLine(started.reply.zombies);
  if (street) console.log(street);
  console.log(clock === "waits" ? `The game is paused while Claude thinks; each wait plays at ${speed}x.` : `Game time will run at ${speed}x.`);

  const mcpConfig = join(runDir, "mcp.json");
  await writeFile(
    mcpConfig,
    JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: {
            type: "stdio",
            command: process.execPath,
            args: [serverScript],
            env: { PVZ_API_URL: game.baseUrl, PVZ_SESSION: session.path, PVZ_LOG: join(runDir, "moves.jsonl") },
          },
        },
      },
      null,
      2,
    ),
  );

  const args = [
    ...claude.prefix,
    "-p",
    street ? `Play the level. ${street}` : "Play the level.",
    "--system-prompt",
    brief,
    "--tools",
    "", // no built-in tools at all
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config", // only our server
    "--allowedTools",
    `mcp__${SERVER_NAME}__*`,
    "--permission-mode",
    "dontAsk", // anything else is refused, never asked about
    "--setting-sources",
    "project", // the project is an empty folder outside this repo, so none of your settings or hooks load
    "--max-turns",
    String(maxTurns),
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  if (interrupted) throw new Error("stopped before Claude Code started");
  const expectedTools = tools.map((tool) => `mcp__${SERVER_NAME}__${tool}`).sort();
  const transcript = createWriteStream(join(runDir, "claude.jsonl"));
  // The player works in an empty folder of its own, outside this repo, so Claude Code doesn't treat
  // it as part of the project. The run's own files stay in runDir, out of its reach.
  playerDir = await mkdtemp(join(tmpdir(), "pvz-lab-player-"));
  const player = spawn(claude.command, args, { cwd: playerDir, env: playerEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  player.on("error", (error) => {
    console.error(`Couldn't start Claude Code (${claude.command}): ${error.message}. Install it, or set CLAUDE_BIN in agent/.env.`);
  });
  let toolCalls = 0;
  let pending = "";

  stopPlayer = () => player.kill();
  const stop = (why: string): void => {
    console.error(`Stopping the run: ${why}`);
    player.kill();
  };

  const startClock = (): void => {
    client.control({ type: "run", speed }).then(
      (result) => (result.ok ? console.log(`Game time is running at ${speed}x.`) : stop(`couldn't start game time: ${result.error.message}`)),
      (error: Error) => stop(`couldn't start game time: ${error.message}`),
    );
  };

  // Shows the run as it happens, and stops it unless the player has exactly the session's tools.
  // (Claude Code 2.1.23 listed no MCP tools here and never gave them to the model; 2.1.283 does both.)
  const report = (line: string): void => {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    for (const text of describeEvent(event, SERVER_NAME)) console.log(text);
    if (event.type === "system" && event.subtype === "init") {
      const available = [...(event.tools as string[])].sort();
      if (JSON.stringify(available) !== JSON.stringify(expectedTools)) {
        stop(
          `the player has [${available.join(", ")}] instead of the session's [${expectedTools.join(", ")}]. ` +
            "An old Claude Code may not hand MCP tools to the model: update it, or set CLAUDE_BIN in agent/.env.",
        );
      } else if (event.memory_paths && Object.keys(event.memory_paths).length > 0) {
        stop(`the player has Claude Code's memory on (${JSON.stringify(event.memory_paths)}), so it could see notes about this project`);
      } else if (clock === "realtime") {
        startClock();
      }
    } else if (event.type === "assistant") {
      for (const part of event.message?.content ?? []) {
        if (part.type !== "tool_use") continue;
        toolCalls++;
        if (!expectedTools.includes(part.name)) stop(`the player called ${part.name}, which isn't one of the session's tools`);
      }
    }
  };

  player.stdout.setEncoding("utf8");
  player.stdout.on("data", (chunk: string) => {
    transcript.write(chunk);
    pending += chunk;
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      report(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
  });
  player.stderr.on("data", (chunk) => process.stderr.write(chunk));

  // The result is taken the moment the game shows it: by the end of the run the game may have moved
  // on (a click on Next Level starts the next level) or closed.
  let shown: string | undefined;
  const watcher = setInterval(() => {
    client.state().then(
      (state) => {
        if (!shown && outcomeOf(state) !== "unfinished") shown = outcomeOf(state);
      },
      () => {}, // the game may be closing; the final read below says so
    );
  }, 1000);

  const exitCode = await new Promise<number | null>((resolve) => player.on("close", resolve));
  clearInterval(watcher);
  transcript.end();

  // Ctrl+C reaches every program in the terminal, so the game may have closed as well.
  let final: GameState | undefined;
  let readError: string | undefined;
  try {
    final = await client.state();
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
  }
  const played = shown ?? (final ? outcomeOf(final) : undefined);
  const outcome = played && played !== "unfinished" ? played : interrupted ? "stopped" : (played ?? "unknown");
  if (outcome === "unknown") console.error(`Couldn't read how the level ended: ${readError}`);
  // After a win the board is gone, so the game time comes from the last summary the player was shown.
  const moves = existsSync(join(runDir, "moves.jsonl")) ? await readFile(join(runDir, "moves.jsonl"), "utf8") : "";
  const gameTimes = [...moves.matchAll(/Game time ([\d.]+) s/g)].map((match) => Number(match[1]));
  const result = {
    level,
    outcome,
    toolCalls,
    claudeExitCode: exitCode,
    lastGameSecondsSeen: gameTimes.at(-1) ?? null,
    ...(outcome === "unknown" ? { error: readError } : {}),
  };
  await writeFile(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Result: level ${level} ${outcome} after ${toolCalls} tool calls.`);
} finally {
  await game.stop();
  if (playerDir) await rm(playerDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
