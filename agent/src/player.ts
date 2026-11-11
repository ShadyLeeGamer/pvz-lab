// Runs Claude Code as one side's player, locked down so its MCP tools are all it can use: no shell,
// files or web, and none of your own settings. pnpm match and pnpm play start their Claude players
// here. The player's folder gets its MCP config and Claude Code's own output (claude.jsonl); its MCP
// server adds every tool call (moves.jsonl).
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeEvent } from "./claude-events.ts";
import { loadEnv } from "./game-process.ts";
import type { LoadedSession, Side } from "./session.ts";

const SERVER_NAME = "pvz";

// The MCP server a player reaches the game through, started as a child process over stdio.
export interface ServerCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PlayerSpec {
  side: Side;
  session: LoadedSession; // its tools and turn limit
  brief: string; // its instructions, handed over as its system prompt (D47)
  prompt: string; // its first message
  model?: string; // the model it plays with, as Claude Code names it (D61); Claude Code's default if none
  server: ServerCommand;
  dir: string; // where its files go
  // Where its lines go as it plays. None while a person plays the other side (D33).
  print?: (line: string) => void;
}

// How a player's run ended.
export interface PlayerEnd {
  exitCode: number | null;
  toolCalls: number;
  finish?: string; // Claude Code's own word for it, such as "success" or "error_max_turns"
}

export interface Player {
  // True once it's up with exactly its session's tools; false if it stopped before that.
  ready: Promise<boolean>;
  done: Promise<PlayerEnd>;
  stop(why?: string): void;
}

export type LaunchPlayer = (spec: PlayerSpec) => Player;

// Which Claude Code plays: CLAUDE_BIN in agent/.env, else the program an npm global install or the
// native installer puts on this machine, else claude.exe on the PATH. (npm's own `claude` on the PATH is
// a .cmd wrapper, which can't be started without a shell, so the program inside it is used instead.)
export function findClaude(): { command: string; prefix: string[] } {
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
// keeps about the project. And it doesn't update Claude Code while it plays: one that did left the
// program it ran from half replaced (11 Nov 2026).
export function playerEnvironment(from: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(from)) {
    if (value === undefined || name === "ANTHROPIC_API_KEY" || name === "ANTHROPIC_AUTH_TOKEN") continue;
    if (name.startsWith("CLAUDE") && name !== "CLAUDE_CONFIG_DIR") continue;
    env[name] = value;
  }
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  env.DISABLE_AUTOUPDATER = "1";
  return env;
}

// Claude Code's arguments for a player, after any the program itself needs (findClaude's prefix): only
// its MCP server's tools, never asking, with its brief as the system prompt.
export function claudeArgs(spec: PlayerSpec, mcpConfig: string): string[] {
  return [
    "-p",
    spec.prompt,
    "--system-prompt",
    spec.brief,
    ...(spec.model ? ["--model", spec.model] : []),
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
    String(spec.session.settings.maxTurns),
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

export function launchClaudePlayer(spec: PlayerSpec): Player {
  let markReady: (ready: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => (markReady = resolve));
  let stopped = false;
  let kill = (): void => {};
  const stop = (why?: string): void => {
    if (why) console.error(`Stopping the ${spec.side}' player: ${why}`);
    stopped = true;
    kill();
  };

  const run = async (): Promise<PlayerEnd> => {
    const claude = findClaude();
    const mcpConfig = join(spec.dir, "mcp.json");
    await writeFile(mcpConfig, `${JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "stdio", ...spec.server } } }, null, 2)}\n`);
    const args = [...claude.prefix, ...claudeArgs(spec, mcpConfig)];
    const expectedTools = spec.session.settings.tools.map((tool) => `mcp__${SERVER_NAME}__${tool}`).sort();

    // The player works in an empty folder of its own, outside this repo, so Claude Code doesn't treat
    // it as part of the project. The run's own files stay in the run folder, out of its reach.
    const playerDir = await mkdtemp(join(tmpdir(), "pvz-lab-player-"));
    const transcript = createWriteStream(join(spec.dir, "claude.jsonl"));
    try {
      if (stopped) return { exitCode: null, toolCalls: 0 };
      const player = spawn(claude.command, args, { cwd: playerDir, env: playerEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
      kill = () => player.kill();
      player.on("error", (error) => {
        console.error(`Couldn't start Claude Code (${claude.command}): ${error.message}. Install it, or set CLAUDE_BIN in agent/.env.`);
      });
      let toolCalls = 0;
      let finish: string | undefined;
      let pending = "";

      // Shows the run as it happens, and stops the player unless it has exactly the session's tools.
      // (Claude Code 2.1.23 listed no MCP tools here and never gave them to the model; 2.1.283 does both.)
      const report = (line: string): void => {
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        for (const text of describeEvent(event, SERVER_NAME)) spec.print?.(text);
        if (event.type === "system" && event.subtype === "init") {
          const available = [...(event.tools as string[])].sort();
          if (JSON.stringify(available) !== JSON.stringify(expectedTools)) {
            stop(
              `it has [${available.join(", ")}] instead of the session's [${expectedTools.join(", ")}]. ` +
                "An old Claude Code may not hand MCP tools to the model: update it, or set CLAUDE_BIN in agent/.env.",
            );
          } else if (event.memory_paths && Object.keys(event.memory_paths).length > 0) {
            stop(`it has Claude Code's memory on (${JSON.stringify(event.memory_paths)}), so it could see notes about this project`);
          } else {
            markReady(true);
          }
        } else if (event.type === "assistant") {
          for (const part of event.message?.content ?? []) {
            if (part.type !== "tool_use") continue;
            toolCalls++;
            if (!expectedTools.includes(part.name)) stop(`it called ${part.name}, which isn't one of the session's tools`);
          }
        } else if (event.type === "result") {
          finish = event.subtype;
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

      const exitCode = await new Promise<number | null>((resolve) => player.on("close", resolve));
      return { exitCode, toolCalls, finish };
    } finally {
      transcript.end();
      await rm(playerDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };

  const done = run().finally(() => markReady(false));
  return { ready, done, stop };
}
