# agent

Node tools around the pvz-lab local API (see `../docs/api.md`):
- an MCP server, so an AI client such as Claude Code can play with a player's moves
- `pnpm play`, which runs one play session with Claude Code as the player
- end-to-end tests for the API and the MCP server

Needs Node 24+ (it runs TypeScript files directly, so use plain TypeScript: no enums or namespaces) and pnpm.

```
pnpm install
pnpm typecheck                                  # type-check everything
pnpm test                                       # unit tests, no game needed
pnpm test:e2e                                   # launches the game; checks the API and the MCP server
pnpm play sessions/1-1-single-actions.json      # Claude Code plays level 1-1; the game pauses while it thinks
pnpm play sessions/1-1-realtime.json            # the same, but the game keeps running while it thinks
```

The end-to-end tests and `pnpm play` need a game built with `-DPVZLAB=ON` and your own copy of the game data. Copy `.env.example` to `.env` and fill in the paths. Each run starts its own copy of the game, with a temporary copy of the save folder and its own port, so your saves and any game you have open are left alone.

The game window opens without taking the keyboard, so you can keep working while it runs. It may cover other windows. Don't minimize it: game time stops while the window is minimized.

## Play sessions

A session file in `sessions/` sets the level, the clock and the tools:
- `level`: an Adventure level, such as `"2-7"`. Checked by starting all 50:
  - 1-1 to 1-4, 1-6 and 1-7 start as they are.
  - These start once given `seeds`: 1-8, 1-9, 2-3, 2-4, 2-6 to 2-9, 3-2 to 3-4, 3-6 to 3-9, 4-2 to 4-4, 4-6 to 4-9, 5-2 to 5-4 and 5-6 to 5-9.
  - 1-10, 2-10 and 3-10 start, but their seed packets arrive on a conveyor belt, and no player has tried one yet.
  - Not supported: the levels that open with Crazy Dave talking (1-5, 2-1, 2-2, 2-5, 3-1, 3-5, 4-1, 4-5, 4-10, 5-1, 5-5 and 5-10).
  - Every run starts from the save template, which has 6 seed slots and no shop upgrades. So later levels are harder than in a normal playthrough.
  - In the fog levels (world 4), the player view still shows zombies the fog would hide.
- `seeds`: the seed packets to bring, by name, for levels that make you choose. If they're missing or wrong, `pnpm play` lists the choices. On a level that doesn't let you choose, it stops and says so.
- `clock`: `"waits"` pauses the game while the player thinks, so time only passes when it calls `wait` (so a `"waits"` session must offer `wait`). `"realtime"` keeps the game running.
- `speed`: how fast game time runs whenever it runs, from 1 (normal, the default) to 50.
  - With `"waits"`, it only changes how quickly each wait plays out.
  - With `"realtime"`, it also changes how much thinking time the player gets.
- `tools`: any of `get_state`, `place_plant`, `collect_sun` and `wait`. The MCP server offers only these.
- `brief`: the instructions the player starts with, usually `prompts/play.md`.
  - `{level}` and `{rules}` in it are filled in from the session, so the player is only told about its own clock, speed and tools.
  - The tools' own descriptions also match the clock.

`pnpm play` needs a recent Claude Code: version 2.1.23 never gave MCP tools to the model, and 2.1.283 does. Update with `npm install -g @anthropic-ai/claude-code@latest`. It finds an npm or native install by itself, or uses `CLAUDE_BIN` from `.env`. It plays with whichever account that Claude Code is logged into. At startup it checks that the player has exactly the session's tools and no memory, and stops if not.

It launches its own copy of the game and starts the level, frozen. With the `"realtime"` clock, game time starts once Claude Code is ready. Then it runs a fresh Claude Code session, headless and locked down:
- Only the session's MCP tools: no shell, files or web, and none of your other MCP servers, settings or hooks.
- No Claude Code memory or `CLAUDE.md` files. It runs in an empty folder outside the repo, because when started inside it, Claude Code gave it the index of the notes it keeps about this project.
- It plays on your Claude subscription. The API key variables are removed, so it never uses paid API.

The terminal shows what Claude says, each tool call, and the first line of each answer, such as `Planted a peashooter at column 0, row 2.` The game window shows the rest.

Ctrl+C stops a run cleanly. Claude Code and the game close, the temporary folders go, and `result.json` says `stopped`. Press it twice to quit at once.

Each run is saved in `runs/` (not committed): the session, the brief, every tool call (`moves.jsonl`), Claude Code's own output (`claude.jsonl`) and `result.json`.

The tools answer with a short text summary of the player view: a map of the lawn, then lists of seed packets, zombies and sun. Nothing hidden from a player, such as exact health or wave timers, is included.

## Tests

- Unit tests check:
  - the summary, against real game states saved in `test/fixtures`
  - the MCP tools, through a real MCP client, against the game's own replies (also in `test/fixtures`; refresh both with `pnpm fixtures:capture`)
  - the session files, the client's handling of a busy game, and the lines `pnpm play` prints (against events from a real run)
- End-to-end tests play real levels.
  - They start 1-1 from the title screen, plant, collect sun, and win it at high speed.
  - Then they move on to 1-2, start each level up to 1-7, and pick seeds on 1-8.
  - Another drives the MCP server against the game, the way Claude Code does.
  - A full run takes about 20 seconds.
