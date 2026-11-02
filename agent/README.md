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
- `tools`: any of `get_state`, `place_plant`, `dig_up`, `collect_sun` and `wait`. The MCP server offers only these.
  - `dig_up` digs a plant up with the shovel. The game has no shovel in 1-1 to 1-4 the first time through Adventure, which every run is, so the sessions for those levels leave it out.
- `brief`: the instructions the player starts with, usually `prompts/play.md`.
  - `{level}` and `{rules}` in it are filled in from the session, so the player is only told about its own clock, speed and tools.
  - The tools' own descriptions also match the clock.

`pnpm play` needs a recent Claude Code: version 2.1.23 never gave MCP tools to the model, and 2.1.283 does. Update with `npm install -g @anthropic-ai/claude-code@latest`. It finds an npm or native install by itself, or uses `CLAUDE_BIN` from `.env`. It plays with whichever account that Claude Code is logged into. At startup it checks that the player has exactly the session's tools and no memory, and stops if not.

It launches its own copy of the game and starts the level, frozen. With the `"realtime"` clock, game time starts once Claude Code is ready. Then it runs a fresh Claude Code session, headless and locked down:
- Only the session's MCP tools: no shell, files or web, and none of your other MCP servers, settings or hooks.
- No Claude Code memory or `CLAUDE.md` files. It runs in an empty folder outside the repo, because when started inside it, Claude Code gave it the index of the notes it keeps about this project.
- It plays on your Claude subscription. The API key variables are removed, so it never uses paid API.

Before Claude starts, the terminal shows the zombies waiting on the street in the level's intro, which Claude is told too, as a player would see them. Then it shows what Claude says, each tool call, and the first line of each answer, such as `Planted a peashooter at column 0, row 2.` The game window shows the rest.

Ctrl+C stops a run cleanly. Claude Code and the game close, the temporary folders go, and `result.json` says `stopped`. Press it twice to quit at once.

Each run is saved in `runs/` (not committed): the session, the brief, every tool call (`moves.jsonl`), Claude Code's own output (`claude.jsonl`) and `result.json`.

The tools answer with a short text summary of the player view: a map of the lawn, then lists of seed packets, zombies and sun. Nothing hidden from a player, such as exact health or wave timers, is included.

## Playing in a chat app

The MCP server also works in apps that run MCP servers on your computer, such as Claude Desktop, Claude Code's own chat, VS Code or Cursor. Give it a session that offers `start_level` instead of setting a `level` (such as `sessions/chat.json`), and no `PVZ_API_URL`:
- The server starts its own copy of the game at the first `start_level`, and closes it when the app closes the server.
- `start_level` takes a level such as `2-7`. From 1-8 on, the game first asks for seeds: called without them, `start_level` lists the choices, what each costs and the zombies waiting on the street, as the seed chooser screen shows them. Called again with seeds, it picks them on that same screen, so the level played is the one shown. The reply to a start names the street's zombies too.
- The session's clock, speed and tools apply. Its instructions reach the app as the server's instructions, and there's a `play_level` prompt.
- Unlike `pnpm play`, the app isn't locked down: your other tools, memory and settings come along.
- `node` on your PATH must be Node 24 or later.

Claude Desktop: Settings → Developer → Edit Config, with your own paths:
```json
{ "mcpServers": { "pvz": {
  "command": "node",
  "args": ["C:/path/to/pvz-lab/agent/src/mcp/server.ts"],
  "env": { "PVZ_SESSION": "C:/path/to/pvz-lab/agent/sessions/chat.json" }
} } }
```

Claude Code, for all your projects (leave out `-s user` for just the current one):
```
claude mcp add pvz -s user -e PVZ_SESSION=C:/path/to/pvz-lab/agent/sessions/chat.json -- node C:/path/to/pvz-lab/agent/src/mcp/server.ts
```

Then ask, say, "play level 2-7". The game window opens at the first level. If the app is force-closed, the game still closes, but its temporary save folder stays in your temp folder.

## Tests

- Unit tests check:
  - the summary, against real game states saved in `test/fixtures`
  - the MCP tools, through a real MCP client, against the game's own replies (also in `test/fixtures`; refresh both with `pnpm fixtures:capture`)
  - the session files, the client's handling of a busy game, and the lines `pnpm play` prints (against events from a real run)
- End-to-end tests play real levels.
  - They start 1-1 from the title screen, plant, collect sun, and win it at high speed.
  - Then they move on to 1-2, start each level up to 1-7, and pick seeds on 1-8 on the same seed chooser screen that showed the street's zombies.
  - They dig plants up with the shovel, including a pumpkin, the plant inside it and the flower pot under them on the roof, in the order the game allows.
  - Another drives the MCP server against the game, the way Claude Code does.
  - Another runs the server the way a chat app does: it starts its own game at `start_level`, asks for seeds with their costs, and closes the game when the app closes the server.
  - A full run takes about 40 seconds. Set `PVZ_E2E_MUTE=1` in `.env` to run the games without sound.
