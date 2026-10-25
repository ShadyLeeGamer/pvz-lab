# pvz-lab local API

pvz-lab can build a small HTTP API into the game, so external tools can read the game state. It is optional, off by default, and only listens on your own machine.

Status: read-only (version 1). Actions and time control come later.

## Turning it on

Build with the `PVZLAB` option and the vcpkg feature that brings its libraries:

```
cmake -B build -DPVZLAB=ON -DVCPKG_MANIFEST_FEATURES=pvzlab ...
```

The API starts with the game, on `http://127.0.0.1:7310`. Change the port with `-apiport=<n>`. Use the `=` form, because the game treats a separate value as an unknown parameter. If the port is taken, the game logs it and runs without the API.

## Conventions

- **Format:** JSON. Every response has `Cache-Control: no-store`.
- **Version:** responses carry `apiVersion` (currently `1`). It changes only when a field is removed or changes meaning; new fields can appear at any time.
- **Errors:** an error status plus `{ "error": { "code": "...", "message": "..." } }`.
- **Time:** the game runs 100 ticks a second. `appTicks` counts from start-up; `gameTicks` only advances while a level is being played.
- **Positions:** `x` and `y` are pixels on the 800×600 board.
- **Grid:** `col` 0–8 from the left; `row` from the top, 0–4 (or 0–5 on pool and fog levels).
- **IDs:** an object keeps the same `id` for as long as it exists.
- **Names:** plant and zombie names are the game's own internal names, lowercased (e.g. `peashooter`, `cherry_bomb`, `conehead_zombie`). The basic zombie is `zombie`. `typeId` is the game's own number for the type.

## GET /health

Answers as soon as the game has started, even before the first tick.

```json
{ "apiVersion": 1, "ok": true,
  "build": { "commit": "d3052a7", "builtAt": "25 Oct 2026 01:40", "gameVersion": "0.2.5-3-g3838ec219d1a" },
  "scene": "loading", "appTicks": 412 }
```

`scene` is `null` until the first tick.

## GET /state

A copy of the game state, taken at the end of the latest tick (at most 10 ms old).

| Query | Meaning |
|---|---|
| `view=player` (default) | Only what a player could see on screen. |
| `view=full` | Everything below, including hidden information. For debugging and overlays. |

Errors: `400 bad_view` for any other `view`; `503 not_ready` before the first tick.

### Top level

| Field | Type | Notes |
|---|---|---|
| `apiVersion` | number | |
| `view` | `"player"` \| `"full"` | |
| `appTicks` | number | Ticks since the game started. |
| `scene` | string | `loading` (title screen), `menu`, `level_intro`, `playing`, `zombies_won`, `award`, `challenge_menu`, `credits`. |
| `mode` | string | `adventure` or `other`. |
| `modeId` | number | The game's own mode number. |
| `board` | object \| null | The level in progress; `null` outside a level. |

### `board`

| Field | Type | Notes |
|---|---|---|
| `level`, `levelName` | number, string | Adventure only, e.g. `1` and `"1-1"`; otherwise `0` and `""`. |
| `stage` | string | `day`, `night`, `pool`, `fog`, `roof`, `boss`, `other`. |
| `paused` | boolean | The game's own pause (menus and dialogs). |
| `gameTicks` | number | Game time; stops while paused or outside play. |
| `boardTicks` | number | Ticks since the level was created. |
| `result` | string | `playing`, `won`, `lost`. |
| `sun` | number | The number shown on screen. |
| `sunSpendable` | number | Includes sun that was clicked and is still flying to the counter; the game lets you spend it. |
| `seedPackets` | array | See below. |
| `lawn` | object | See below. |
| `plants`, `zombies`, `suns` | arrays | See below. |
| `award` | object \| null | The level-end award once it has dropped: `{ id, x, y }`. The level only finishes once it is collected. |
| `mowers` | array | `{ row, kind, state }`. `kind`: `lawn_mower`, `pool_cleaner`, `roof_cleaner`, `super_mower`. `state`: `rolling_in`, `ready`, `triggered`, `squished`. A row without an entry has no mower left. |
| `progress` | object | See below. |

### `seedPackets[]`

| Field | Notes |
|---|---|
| `slot` | Position in the seed bank, from 0. |
| `plant`, `plantId` | The plant this packet grows. |
| `imitates` | Only on Imitater packets: the plant it copies. |
| `cost` | Current sun cost. |
| `ready` | The game's own check: recharged, affordable and its requirements met. `false` while the game is paused. |
| `held` | Picked up and waiting to be planted. |
| `recharge` | 0–1; `1` means fully recharged. |

### `lawn`

| Field | Notes |
|---|---|
| `rows` | One entry per row: `grass`, `dirt` (nothing can be planted) or `water`. |
| `items` | `{ type, col, row }` with `type` `grave`, `crater`, `ladder`, `rake` or `vase`. |
| `ice` | `{ col, row }` tiles covered by a Zomboni's ice trail (nothing can be planted there). |

### `plants[]`

| Field | Notes |
|---|---|
| `id`, `type`, `typeId`, `col`, `row` | |
| `imitates` | Only on an Imitater that hasn't changed yet: what it will become. |
| `layer` | `under` (Lily Pad, Flower Pot), `normal`, `pumpkin`, `flying` (Coffee Bean), or `none` while being carried off. |
| `asleep` | Mushrooms sleep during the day. |
| `state` | Only states you can see: `armed` / `arming` (Potato Mine), `chewing` (Chomper), `loaded` / `reloading` (Cob Cannon), `small` / `growing` / `big` (Sun-shroom), `hiding` (Scaredy-shroom), `recharging` (Magnet-shroom). Absent otherwise. |
| `damage` | Only for plants whose art shows damage (Wall-nut, Tall-nut, Pumpkin, Garlic): `none`, `damaged` (below 2/3 health), `badly_damaged` (below 1/3). |
| `health` | Full view only: `{ current, max }`. |

### `zombies[]`

Zombies that are dying, or not part of the level (menus, cutscenes), are left out. The player view also leaves out zombies that haven't walked on screen yet.

| Field | Notes |
|---|---|
| `id`, `type`, `typeId`, `row`, `x`, `y` | |
| `onScreen` | `false` until the zombie can be hit (always `true` in the player view). |
| `eating`, `slowed`, `frozen`, `buttered`, `hypnotized`, `inPool`, `flying`, `underground` | Visible statuses. `flying`: still on its balloon. `underground`: a digging Digger. |
| `hasArm`, `hasHead` | The game drops the arm below 2/3 body health and the head below 1/3. |
| `helm`, `shield` | `null`, or `{ type, damage }` (plus `health` in the full view). Helms: `cone`, `bucket`, `football_helmet`, `miner_hat`, `bobsled_helmet`, ... Shields: `screen_door`, `newspaper`, `ladder`. `damage` works like the plants' field. |
| `health` | Full view only: the body's `{ current, max }`. |

### `suns[]`

`{ id, value, x, y, beingCollected }`. `value` is 25, 15 (from a small Sun-shroom) or 50.

### `progress`

| Field | Notes |
|---|---|
| `wave`, `totalWaves` | Waves sent so far, out of the total. |
| `meter` | The progress bar, 0–1. |
| `hugeWaveIncoming` | The "a huge wave of zombies is approaching" warning is up. |
| `nextWaveIn` | Full view only: ticks until the next wave. |
| `upcomingWaves` | Full view only: zombie types in the next (up to) three waves. |

### What the player view leaves out

- Exact health of plants, zombies and their armour. The `damage` stages and `hasArm`/`hasHead` show what the art shows.
- `nextWaveIn` and `upcomingWaves`.
- Zombies that haven't walked on screen yet.

Not handled yet: zombies hidden by fog (Adventure levels 31–40) and by Stormy Night's darkness still appear in the player view.
