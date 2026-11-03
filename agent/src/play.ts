// Plays one session with Claude Code as the plants' player, against the level's own zombies:
//   pnpm play sessions/1-1-single-actions.json
// It's a match (match.ts) built from the session file: it launches its own copy of the game, starts the
// session's level, then runs Claude Code locked down so the session's MCP tools are all it can use: no
// shell, files or web, and none of your own settings. Everything lands in runs/<time>-<session>/: the
// result, and in plants/ the session, the brief, every tool call (moves.jsonl) and Claude's own output
// (claude.jsonl).
import { matchFromSession, runFromCommandLine, type MatchSettings } from "./match.ts";
import { loadSession } from "./session.ts";

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error("usage: pnpm play <session file>, e.g. pnpm play sessions/1-1-single-actions.json");
  process.exit(1);
}

let settings: MatchSettings;
try {
  settings = matchFromSession(await loadSession(sessionFile));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
await runFromCommandLine(settings);
