# agent

Node tools around the pvz-lab local API (see `../docs/api.md`):
- an MCP server, so an AI client such as Claude Code can play with a player's moves
- `pnpm match`, which plays one level with a player on each side: you, Claude Code or another app on the plants, and the level, Claude Code or another app on the zombies
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

`pnpm match <level> --plants human|claude|agy|url --zombies level|claude|agy|url [--windows] [--plants-model <name>] [--zombies-model <name>] [--speed n]` plays one level with a player on each side:

| Command | Who plays |
|---|---|
| `pnpm match 1-9 --plants human --zombies level` | you, against the level's own zombies |
| `pnpm match 1-9 --plants claude --zombies level` | Claude Code, against the level |
| `pnpm match 1-9 --plants claude --zombies claude` | Claude Code against Claude Code, in versus |
| `pnpm match 1-9 --plants human --zombies claude` | you, against Claude Code on the zombies, in versus |
| `pnpm match 1-9 --plants url --zombies url` | any two MCP apps on this PC, each joining by its seat's link, in versus |
| `pnpm match 1-9 --plants claude --zombies agy --windows` | Claude Code against Antigravity CLI, each in a chat window of its own, in versus |

- A Claude player is Claude Code, locked down as in `pnpm play` (below), with only its own side's tools and view. It plays at a seat on the host's own MCP server, over HTTP, as an app at a URL seat does.
- `--plants human` is you, in the game window, at normal speed.
- `url` is a seat any MCP app on this PC can take by its link (below), on either side.
- `agy` is Antigravity CLI (Gemini, free with a personal Google account). It plays in a chat window of its own, so it needs `--windows`.
- `--windows` opens each `claude` or `agy` player in a chat window of its own, at a URL seat (below), so you can watch it and type to it, while the terminal shows its moves. Without it, a Claude player plays in the terminal. The windows stay open after the match, for you to read and close.
- `--plants-model` and `--zombies-model` pick a `claude` or `agy` player's model, as its app names it: `opus`, `sonnet` or `fable` for Claude Code, or one that `agy models` lists, such as `gemini-3.8-flash-high` or `gpt-oss-120b-medium`. Without them, each app uses its default.
- `--zombies level` is the level's own waves. A player on the zombies makes it a versus level (see `../docs/api.md`), which 1-1 can't be.
- `--speed` sets how fast game time runs, from 1 (normal, the default) to 50. A person always plays at normal speed.

URL seats (`url`):
- The host serves each URL seat's MCP tools over HTTP at `http://127.0.0.1:<port>/mcp/<side>/<token>` and prints the link. The port and the tokens are new every match.
- Each seat also has a folder of its own, outside this repo, that apps play from: `<PVZ_SEATS_DIR>\plants` and `<PVZ_SEATS_DIR>\zombies` (set in `.env`), or a temporary folder. Every match writes its link into that folder's configs for Antigravity (`.agents\mcp_config.json`), VS Code (`.vscode\mcp.json`) and Cursor (`.cursor\mcp.json`), so an app opened there finds this match's seat, and the seat's brief and each of its tools with their arguments as `AGENTS.md`, which apps such as Antigravity add to their model's instructions themselves. (Antigravity doesn't pass the server's brief or the tools' arguments to its model: it saves them to files, which its player can't read.)
- For Claude Code it writes `claude.cmd` in the seat's run folder (`--windows` opens it for you): run it in a new terminal, and it opens a chat in the seat's folder that's locked down like the players the host launches, with only that seat's tools (no files, shell or web), no memory or CLAUDE.md files, none of your settings, no API key, and no updates of Claude Code while it plays. It starts with none of the Claude Code variables of the session it's opened from. Each message waits 2 s before it's sent (a hook in `claude-settings.json`, beside `claude.cmd`), because a chat sends its first message before connecting to the seat, which then has no game tools; the seat connects within half a second. The first time, Claude Code asks you to trust the folder, and if your own CLAUDE.md imports other files, whether to allow those imports: say no (a player loads no CLAUDE.md files either way). You can watch the chat as it plays.
- For Antigravity CLI it writes `agy.cmd` (`--windows` opens it for you): it opens `agy` in the seat's folder with the seat's tools allowed without asking, its own tools for commands, files and fetching pages refused, and the folder trusted, for that session only. Its first message hands the game to the seat's player agent (`.agents\agents\pvz-<side>.md`, written each match): a helper agent with only the seat's tools and the brief as its instructions. Antigravity's chat itself never had the seat's tools at the start, even when it waited, but a helper it starts has them from its first turn, and has no shell, files, web search or helpers of its own. Its web search can't be turned off: a deny rule for it is ignored. Sign in once by running `agy` yourself, in an empty folder.
- Other apps, such as VS Code or Cursor opened in the seat's folder, keep their own tools, so they can read files (including the run folders) unless you set them up not to.
- The seat's brief comes from the server, as the app's instructions. An app that connects again gets a new session for the same seat.
- Only this PC can connect: the server listens on 127.0.0.1, refuses any `Host` but this PC's names and any web page's `Origin` but its own, and each seat has its own random token, so one side's link can't reach the other seat.
- The host waits for each URL seat's player with no time limit, saying so every 30 s; Ctrl+C stops the match. Apps that connect from the cloud (claude.ai, Claude Desktop's and the mobile apps' URL connectors) can't reach this PC.

How a match runs:
- The host launches its own copy of the game and starts the level.
- From 1-8 on, the level waits at its seed chooser. Claude on the plants picks with `choose_seeds`, and you pick in the window.
- With a player on each side, the match starts on a ready check, as a game lobby does. Every player's seat opens and every Claude player starts at once. Each looks at the game, the plants choose their seed packets if the level asks, and each calls `ready`. Until the match starts, moves are refused, and `ready` and `wait` wait for the start, up to 30 s at a time. Game time starts once every player is ready. With you on the plants, your game runs once the other player is ready, and you pick your seeds in the window. A player that stops before it's ready doesn't hold up the start, and a zombies' player that joins while the plants choose their seeds is told the level hasn't started.
- Alone against the level, there's no ready check: game time starts once a Claude player is up, or once a URL seat's player has made a move since play began.
- Each Claude player gets its brief as its system prompt: `prompts/plants-versus.md` (or `prompts/plants.md` against the level) or `prompts/zombies.md`.
- The terminal shows what each Claude player says and does, and each URL seat's moves, marked `[plants]` or `[zombies]` when both sides have a player, and each wave's pay to the zombie side. While you play, the zombie player's moves only go to the run folder.
- The match ends when the game decides the level. A player that stops early, such as at its turn limit, is left as it is, and the level plays on without it. If nobody is left playing, the match ends there.
- Ctrl+C stops it cleanly, as with `pnpm play`.
- Each match is saved in `runs/<time>-match-<level>/` (not committed): `result.json`, with the winner, any models picked, and each player's tool calls and how it stopped, and for each player a folder named after its side, with its session, brief, MCP config and every tool call (`moves.jsonl`), plus Claude Code's own output (`claude.jsonl`) for a Claude player, or the commands that open Claude Code or Antigravity CLI at a URL seat (`claude.cmd`, `agy.cmd`).

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
- It doesn't update Claude Code while it plays (`DISABLE_AUTOUPDATER`). A player started under `pnpm` once updated it into this folder's `node_modules` instead of where Claude Code lives, leaving the `claude` command without its program.

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
- `wait` ends early when a wave pays the zombie side or the level ends, and when play begins if the zombie side joins while the plants choose their seeds.
- The zombie side plays in real time, so the session's `clock` must be `realtime`. Someone else starts the level and runs the clock, and `PVZ_API_URL` points the server at that game.
- The session's brief reaches the app as the server's instructions, and there's a `play_zombies` prompt. (A Claude player that `pnpm match` starts has its brief as its system prompt instead, and its seat doesn't send it again.)

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
  - how `pnpm match`'s flags and `pnpm play`'s session files become a match, and the session each player gets
  - a match's ready check: each side's moves refused before the start, `ready` and `wait` waiting for it, and what each side's brief and replies say
  - the command line a Claude player starts with, with or without a model, and the MCP config that points it at its seat
  - URL seats over real HTTP on this PC: each seat's own link, tools and brief, the requests it turns away (a wrong token, the other seat's token, a foreign `Host` or `Origin`), how moves are counted, an app connecting again, the setup lines the host prints, the commands that open Claude Code and Antigravity CLI (with or without a model), and the command that opens one in a window of its own
  - the session files, the client's handling of a busy game, and the lines `pnpm play` prints (against events from a real run)
- End-to-end tests play real levels.
  - They start 1-1 from the title screen, plant, collect sun, and win it at high speed.
  - Then they move on to 1-2, start each level up to 1-7, and pick seeds on 1-8 on the same seed chooser screen that showed the street's zombies.
  - They dig plants up with the shovel, including a pumpkin, the plant inside it and the flower pot under them on the roof, in the order the game allows.
  - Another drives the MCP server against the game, the way Claude Code does.
  - Another runs the server the way a chat app does: it starts its own game at `start_level`, asks for seeds with their costs, and closes the game when the app closes the server.
  - Others play versus levels: the zombie side's points and sends through the API, and the zombies of 1-2 through the MCP server.
  - Others play matches with scripted players in Claude Code's place, each joining its side's seat over HTTP as Claude Code does: Claude against Claude on 1-9 at speed 50, with the plants picking seeds through `choose_seeds`, a move before they're ready refused, a model picked for the zombies, and the zombies' player stopping early, and a play session on 1-8 with its own seeds. Another plays 1-9 with the plants at a URL seat and the zombies' `agy` player in a window (`--windows`), whose window is swapped for a scripted player joining by its seat's link, as any MCP app would. It checks that only the zombies' window opens, with their model, that the zombies, joining first, are told the level hasn't started, and that nobody moves and game time stands still until both players have called `ready`.
  - A full run takes about two minutes. Set `PVZ_E2E_MUTE=1` in `.env` to run the games without sound.
