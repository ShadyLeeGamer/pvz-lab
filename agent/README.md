# agent

Node tools around the pvz-lab local API (see `../docs/api.md`):
- an MCP server, so an AI client such as Claude Code can play with a player's moves
- `pnpm match`, which plays one level with a player on each side: you or Claude Code on the plants, the level or Claude Code on the zombies
- `pnpm play`, which runs one play session with Claude Code as the plants' player
- end-to-end tests for the API and the MCP server

Needs Node 24+ (it runs TypeScript files directly, so use plain TypeScript: no enums or namespaces) and pnpm.

```
pnpm install
pnpm typecheck                                  # type-check everything
pnpm test                                       # unit tests, no game needed
pnpm test:e2e                                   # launches the game; checks the API and the MCP server
pnpm play sessions/1-1-single-actions.json      # Claude Code plays level 1-1; the game pauses while it thinks
pnpm play sessions/1-1-realtime.json            # the same, but the game keeps running while it thinks
pnpm match 1-9 --plants claude --zombies claude # Claude Code on each side of 1-9
```

The end-to-end tests, `pnpm match` and `pnpm play` need a game built with `-DPVZLAB=ON` and your own copy of the game data. Copy `.env.example` to `.env` and fill in the paths. Each run starts its own copy of the game, with a temporary copy of the save folder and its own port, so your saves and any game you have open are left alone.

The game window opens without taking the keyboard, so you can keep working while it runs. It may cover other windows. Don't minimize it: game time stops while the window is minimized.

## Matches

`pnpm match <level> --plants human|claude --zombies level|claude [--speed n]` plays one level with a player on each side:

| Command | Who plays |
|---|---|
| `pnpm match 1-9 --plants human --zombies level` | you, against the level's own zombies |
| `pnpm match 1-9 --plants claude --zombies level` | Claude Code, against the level |
| `pnpm match 1-9 --plants claude --zombies claude` | Claude Code against Claude Code, in versus |
| `pnpm match 1-9 --plants human --zombies claude` | you, against Claude Code on the zombies, in versus |

- A Claude player is Claude Code, locked down as in `pnpm play` (below), with only its own side's tools and view.
- `--plants human` is you, in the game window, at normal speed.
- `--zombies level` is the level's own waves. `--zombies claude` makes it a versus level (see `../docs/api.md`), which 1-1 can't be.
- `--speed` sets how fast game time runs, from 1 (normal, the default) to 50. A person always plays at normal speed.

How a match runs:
- The host launches its own copy of the game and starts the level.
- From 1-8 on, the level waits at its seed chooser. Claude on the plants picks with `choose_seeds`, and you pick in the window.
- Claude on the zombies joins once play begins. Game time starts once every Claude player is ready, and runs from the start while you play.
- Each Claude player gets its brief as its system prompt: `prompts/plants-versus.md` (or `prompts/plants.md` against the level) or `prompts/zombies.md`.
- The terminal shows what each Claude player says and does, marked `[plants]` or `[zombies]` when both are Claude, and each wave's pay to the zombie side. While you play, Claude's moves on the zombies only go to the run folder.
- The match ends when the game decides the level. A player that stops early, such as at its turn limit, is left as it is, and the level plays on without it. If nobody is left playing, the match ends there.
- Ctrl+C stops it cleanly, as with `pnpm play`.
- Each match is saved in `runs/<time>-match-<level>/` (not committed): `result.json`, with the winner and each player's tool calls and how it stopped, and for each Claude player a folder named after its side, with its session, brief, every tool call (`moves.jsonl`) and Claude Code's own output (`claude.jsonl`).

## Play sessions

`pnpm play` runs a match set up by a session file: Claude Code on the plants, against the level. A session file in `sessions/` sets the level, the clock and the tools:
- `level`: an Adventure level, such as `"2-7"`. Checked by starting all 50:
  - 1-1 to 1-4, 1-6 and 1-7 start as they are.
  - These start once given `seeds`: 1-8, 1-9, 2-3, 2-4, 2-6 to 2-9, 3-2 to 3-4, 3-6 to 3-9, 4-2 to 4-4, 4-6 to 4-9, 5-2 to 5-4 and 5-6 to 5-9.
  - 1-10, 2-10 and 3-10 start, but their seed packets arrive on a conveyor belt, and no player has tried one yet.
  - Not supported: the levels that open with Crazy Dave talking (1-5, 2-1, 2-2, 2-5, 3-1, 3-5, 4-1, 4-5, 4-10, 5-1, 5-5 and 5-10).
  - Every run starts from the save template, which has 6 seed slots and no shop upgrades. So later levels are harder than in a normal playthrough.
  - In the fog levels (world 4), the plants' view still shows zombies the fog would hide.
- `seeds`: the seed packets to bring, by name, for levels that make you choose. If they're missing or wrong, `pnpm play` lists the choices. On a level that doesn't let you choose, it stops and says so.
- `clock`: `"waits"` pauses the game while the player thinks, so time only passes when it calls `wait` (so a `"waits"` session must offer `wait`). `"realtime"` keeps the game running, and `wait` waits until that much game time has passed by the game's own clock. If game time stands still (the game is frozen or paused), `wait` waits on, for up to 30 s, then says how much time passed.
- `speed`: how fast game time runs whenever it runs, from 1 (normal, the default) to 50.
  - With `"waits"`, it only changes how quickly each wait plays out.
  - With `"realtime"`, it also changes how much thinking time the player gets.
- `tools`: any of `get_state`, `place_plant`, `dig_up`, `collect_sun` and `wait`. The MCP server offers only these.
  - `dig_up` digs a plant up with the shovel. The game has no shovel in 1-1 to 1-4 the first time through Adventure, which every run is, so the sessions for those levels leave it out.
  - `choose_seeds` lets the player pick its own seeds on a level that asks for them, instead of `seeds`.
- `brief`: the instructions the player starts with, usually `prompts/plants.md`.
  - `{level}` and `{rules}` in it are filled in from the session, so the player is only told about its own clock, speed and tools.
  - The tools' own descriptions also match the clock.

`pnpm play` needs a recent Claude Code: version 2.1.23 never gave MCP tools to the model, and 2.1.283 does. Update with `npm install -g @anthropic-ai/claude-code@latest`. It finds an npm or native install by itself, or uses `CLAUDE_BIN` from `.env`. It plays with whichever account that Claude Code is logged into. At startup it checks that the player has exactly the session's tools and no memory, and stops if not.

It launches its own copy of the game and starts the level, frozen. With the `"realtime"` clock, game time starts once Claude Code is ready. Then it runs a fresh Claude Code session, headless and locked down:
- Only the session's MCP tools: no shell, files or web, and none of your other MCP servers, settings or hooks.
- No Claude Code memory or `CLAUDE.md` files. It runs in an empty folder outside the repo, because when started inside it, Claude Code gave it the index of the notes it keeps about this project.
- It plays on your Claude subscription. The API key variables are removed, so it never uses paid API.

Before Claude starts, the terminal shows the zombies waiting on the street in the level's intro, which Claude is told too, as a player would see them. Then it shows what Claude says, each tool call, and the first line of each answer, such as `Planted a peashooter at column 0, row 2.` The game window shows the rest.

Ctrl+C stops a run cleanly. Claude Code and the game close, the temporary folders go, and `result.json` says `stopped`. Press it twice to quit at once.

Each run is saved in `runs/` (not committed): `result.json`, and in `plants/` the session, the brief, every tool call (`moves.jsonl`) and Claude Code's own output (`claude.jsonl`).

The tools answer with a short text summary of the plants' view: a map of the lawn, then lists of seed packets, zombies and sun. Nothing hidden from a player, such as exact health or wave timers, is included.

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

## Playing the zombies in a versus level

A level started with `"versus": true` (see `../docs/api.md`) hands its zombie side to a player. The MCP server plays that side with a session whose `side` is `"zombies"`, such as `sessions/1-9-zombies.json`:
- Its tools are `get_state`, `send_zombie` and `wait`, and they show the zombie side's own view:
  - its points, and the zombies it can send, with their cost, first wave and whether they're ready;
  - the plants' sun and seed packets;
  - the lawn, each row's defence, and the zombies on it, including its own still walking in and any held for a huge wave.
- `send_zombie` takes a zombie, a row and, for a bungee, the column it drops onto. The game refuses what its rules don't allow and says why.
- `wait` ends early when a wave pays the zombie side or the level ends.
- The zombie side plays in real time, so the session's `clock` must be `realtime`. Someone else starts the level and runs the clock, and `PVZ_API_URL` points the server at that game.
- The session's brief reaches the app as the server's instructions, and there's a `play_zombies` prompt. (A player that `pnpm match` starts has its brief as its system prompt instead, and the server doesn't send it again.)

`pnpm match` sets all of this up (see Matches). To play the zombies from another MCP app instead, against yourself on the plants:
1. Start the game, then start 1-9 in versus, pick seeds and run the clock (`../docs/api.md` has the requests).
2. Save this as `zombies-mcp.json`, with your own path:
   ```json
   { "mcpServers": { "pvz-zombies": {
     "command": "node",
     "args": ["C:/path/to/pvz-lab/agent/src/mcp/server.ts"],
     "env": { "PVZ_SESSION": "C:/path/to/pvz-lab/agent/sessions/1-9-zombies.json", "PVZ_API_URL": "http://127.0.0.1:7310" }
   } } }
   ```
3. Run `claude --strict-mcp-config --mcp-config zombies-mcp.json --allowedTools "mcp__pvz-zombies__*"`, so it has only the zombie side's tools and never stops to ask before using them, and ask it to play the zombies (or run the `play_zombies` prompt).

## Tests

- Unit tests check:
  - the summary, against real game states saved in `test/fixtures`
  - the MCP tools, through a real MCP client, against the game's own replies (also in `test/fixtures`; refresh both with `pnpm fixtures:capture`)
  - the zombie side's summary and tools, against the zombie side's real views of versus levels (`pnpm fixtures:capture versus` refreshes just those)
  - the plants' seed choosing and their view of a versus level (`pnpm fixtures:capture match`)
  - how `pnpm match`'s flags and `pnpm play`'s session files become a match, and the session each Claude player gets
  - the session files, the client's handling of a busy game, and the lines `pnpm play` prints (against events from a real run)
- End-to-end tests play real levels.
  - They start 1-1 from the title screen, plant, collect sun, and win it at high speed.
  - Then they move on to 1-2, start each level up to 1-7, and pick seeds on 1-8 on the same seed chooser screen that showed the street's zombies.
  - They dig plants up with the shovel, including a pumpkin, the plant inside it and the flower pot under them on the roof, in the order the game allows.
  - Another drives the MCP server against the game, the way Claude Code does.
  - Another runs the server the way a chat app does: it starts its own game at `start_level`, asks for seeds with their costs, and closes the game when the app closes the server.
  - Others play versus levels: the zombie side's points and sends through the API, and the zombies of 1-2 through the MCP server.
  - Others play matches with scripted players in Claude Code's place, each starting its side's MCP server as Claude Code would: Claude against Claude on 1-9 at speed 50, with the plants picking seeds through `choose_seeds` and the zombies' player stopping early, and a play session on 1-8 with its own seeds.
  - A full run takes about two minutes. Set `PVZ_E2E_MUTE=1` in `.env` to run the games without sound.
