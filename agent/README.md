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
