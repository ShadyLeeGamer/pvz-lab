# agent

Node tools that talk to the pvz-lab local API (see `../docs/api.md`). For now this folder only holds the end-to-end tests for that API.

Needs Node 24+ (it runs TypeScript files directly, so use plain TypeScript: no enums or namespaces) and pnpm.

```
pnpm install
pnpm typecheck      # type-check everything
pnpm test           # unit tests (none yet)
pnpm test:e2e       # launches the game and checks the API
```

The end-to-end tests need a game built with `-DPVZLAB=ON` and your own copy of the game data. Copy `.env.example` to `.env` and fill in the paths. Each run starts its own copy of the game, with a temporary copy of the save folder and its own port, so your saves and any game you have open are left alone.

The tests play real levels: they start 1-1 from the title screen, plant, collect sun, win it at high speed, move on to 1-2, and pick seeds on 1-8. A full run takes about 15 seconds.

The game window opens without taking the keyboard, so you can keep working while the tests run. It may cover other windows. Don't minimize it: game time stops while the window is minimized.
