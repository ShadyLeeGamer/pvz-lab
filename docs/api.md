# pvz-lab local API

pvz-lab can build a small HTTP API into the game, so external tools can read the game state and play: plant, collect sun, control game time and start levels. It is optional, off by default, and only listens on your own machine.

Status: version 1. Adventure mode, tested on the day levels.

## Turning it on

Build with the `PVZLAB` option and the vcpkg feature that brings its libraries:

```
cmake -B build -DPVZLAB=ON -DVCPKG_MANIFEST_FEATURES=pvzlab ...
```

The API starts with the game, on `http://127.0.0.1:7310`. Change the port with `-apiport=<n>`. Use the `=` form, because the game treats a separate value as an unknown parameter. If the port is taken, the game logs it and runs without the API.

## Conventions

- **Format:** JSON. Every response has `Cache-Control: no-store`. Requests send a JSON body.
- **Version:** responses carry `apiVersion` (currently `1`). It changes only when a field is removed or changes meaning; new fields can appear at any time.
- **Errors:** an error status plus `{ "error": { "code": "...", "message": "..." } }`, sometimes with more detail (see [Errors](#errors)).
- **Time:** the game runs 100 ticks a second at normal speed. `appTicks` counts from start-up; `gameTicks` only advances while a level is being played.
- **Positions:** `x` and `y` are pixels on the 800×600 board.
- **Grid:** `col` 0–8 from the left; `row` from the top, 0–4 (or 0–5 on pool and fog levels).
- **IDs:** an object keeps the same `id` for as long as it exists.
- **Names:** plant and zombie names are the game's own internal names, lowercased (e.g. `peashooter`, `cherry_bomb`, `conehead_zombie`). The basic zombie is `zombie`. `typeId` is the game's own number for the type.

## GET /health

Answers as soon as the game has started, even before the first tick.

```json
{ "apiVersion": 1, "ok": true,
  "build": { "commit": "e0e9144", "builtAt": "25 Oct 2026 01:40", "gameVersion": "0.2.5-3-g3838ec219d1a" },
  "scene": "loading", "appTicks": 412, "loaded": false }
```

`scene` is `null` until the first tick. `loaded` turns `true` once the game has finished loading. Until then its loop can stall for a second or more, so a request can be withdrawn as `503 busy`: wait for `loaded` before sending requests.

## GET /state

A copy of the game state, taken at the end of the latest tick, and again right after any request changes something.

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
| `clock` | object | The time dial: `{ state, speed }`, plus `ticksLeft` while stepping. See [POST /control](#post-control). |
| `dialogOpen` | boolean | A game dialog is open (options, game over, ...). Actions are refused while one is. |
| `minimized` | boolean | Game time stands still while the window is minimized. |
| `board` | object \| null | The level in progress; `null` outside a level. |

### `board`

| Field | Type | Notes |
|---|---|---|
| `level`, `levelName` | number, string | Adventure only, e.g. `1` and `"1-1"`; otherwise `0` and `""`. |
| `stage` | string | `day`, `night`, `pool`, `fog`, `roof`, `boss`, `other`. |
| `paused` | boolean | The game's own pause (menus and dialogs). Separate from the clock. |
| `gameTicks` | number | Game time; stops while paused, frozen or outside play. |
| `boardTicks` | number | Ticks since the level was created. |
| `result` | string | `playing`, `won`, `lost`. |
| `sun` | number | The number shown on screen. |
| `sunSpendable` | number | Includes sun that was clicked and is still flying to the counter; the game lets you spend it. |
| `shovel` | boolean | The shovel is on screen, so plants can be dug up. The game leaves it out of some levels, such as 1-1 to 1-4 the first time through Adventure. |
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
| `held` | Picked up by the player and waiting to be planted. |
| `recharge` | 0–1; `1` means fully recharged. |
| `plantableTiles` | `{ col, row }` tiles where the game's placement rules let this plant go right now. Empty outside play. |

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

## How requests are carried out

- The game carries out requests between ticks, on its own thread, through the same functions a mouse click reaches. The game's rules, costs, recharge times, sounds and tutorial all apply as they do for a player.
- A reply is sent once the change is made, and `/state` already shows it by then.
- A request the game hasn't picked up within 2 seconds is withdrawn, so it never happens late (`503 busy`). That happens while a dialog such as the Almanac runs its own loop, and can happen while the game is still loading (see `loaded` in `GET /health`).
- The player's mouse still works. Actions are refused while the player is holding a seed or a tool.

## POST /actions

One action per request, as `{ "type": ..., ...fields }`.

| Action | Fields | What it does |
|---|---|---|
| `placePlant` | `slot`, `col`, `row` | Picks up the seed packet in `slot` and plants it on the tile: the two clicks a player makes. |
| `digUp` | `col`, `row`, `plant` (optional) | Picks up the shovel and clicks a plant on the tile: the two clicks a player makes. No sun comes back. Without `plant`, it digs up what a click on the middle of the tile does: the plant itself, before a pumpkin around it or a lily pad or flower pot under it. `plant` names another plant on the tile, such as `"pumpkin"`. |
| `collectSun` | `id` (optional) | Clicks the sun with that `id`, or every sun on screen when there's no `id`. |
| `collectAward` | none | Clicks the level-end award, which finishes the level. |

Replies (`200`):

```json
{ "ok": true, "appTicks": 2731, "plant": { "id": 65536, "type": "peashooter", "col": 0, "row": 2 } }
{ "ok": true, "appTicks": 2950, "collected": 2, "value": 50 }
{ "ok": true, "appTicks": 9120 }
```

`digUp` answers like `placePlant`, with the plant it dug up in `plant`. A collected sun counts in `sunSpendable` straight away and reaches `sun` when it lands, about a second of game time later.

`placePlant` checks the tile with the game's own placement rules before anything is clicked, so a refused plant changes nothing. The refusal says why:

```json
{ "error": { "code": "cant_plant_here", "reason": "not_here",
  "message": "sunflower can't go at column 2, row 0: there's already a sunflower there" } }
```

`digUp` checks first too. The game only lets a lily pad or flower pot be dug up once nothing sits on it, and never a grave buster:

```json
{ "error": { "code": "cant_dig_up", "message": "the puff_shroom on that flower_pot has to be dug up first" } }
```

## POST /control

Controls game time and starts levels, as `{ "type": ..., ...fields }`.

| Command | Fields | What it does |
|---|---|---|
| `freeze` | none | Stops game time. The window keeps drawing and the game still takes clicks. |
| `run` | `speed` (optional) | Runs game time continuously. |
| `step` | `ticks` (1–360000), `speed` (optional) | Runs exactly `ticks` ticks, then freezes. Replies once they have run. |
| `startLevel` | `level` (optional), `seeds` (optional), `then` (optional) | Starts an Adventure level from wherever the game is, skips the intro, and freezes at the first moment of play. |

**Speed** is how many ticks run per frame: `1` is normal speed and `50` is the most. It's a dial: it stays where it was last set, and `step` and `run` use it unless they set it themselves.

**`startLevel`:**
- `level`: `1`–`50`, or a name from `"1-1"` to `"5-10"`. Without it, the profile's current Adventure level, which is the next one after a win.
- `seeds`: the plants to pick, by name, for levels that make you choose. If they're missing or wrong, the reply lists what can be picked, with each one's sun cost (`costs`), as the seed chooser shows it, and the zombie types waiting on the street next to it (`zombies`):
  ```json
  { "error": { "code": "bad_seeds", "message": "this level makes you choose 6 seeds; \"seeds\" has 0",
    "choices": ["peashooter", "sunflower", "cherry_bomb", "wall_nut", "potato_mine", "snow_pea", "chomper"],
    "costs": [100, 50, 150, 50, 25, 175, 150], "pick": 6,
    "zombies": ["zombie", "conehead_zombie", "buckethead_zombie"] } }
  ```
  The level then waits at its seed chooser. A `startLevel` for the same `level` picks the seeds there, so the level played is the one whose street was shown. Starting it any other way picks new waves.
- The street shows one or more of each zombie type in the level's waves. The game leaves out the flag zombie that leads a big wave, and always adds a ducky tube zombie on pool levels.
- `then`: `"freeze"` (default) or `"run"` once play has started.
- It waits for the game to finish loading, closes a "game over" or "continue?" dialog, and leaves the title screen, menus or award screen the way the game's own buttons do.
- Like the game's own level select, it sets the profile's Adventure level and drops any saved game for that mode. Use a separate save folder (`-savedir`) for experiments.
- Not supported yet: levels that start with Crazy Dave talking or the shovel tutorial (`409 needs_input`), and picking the Imitater.

Every control command takes over the clock, so one still running (a step, or a level start) is answered `409 interrupted`. Replies carry the clock afterwards. A level start also says which zombie types its intro showed on the street:

```json
{ "ok": true, "appTicks": 4180, "level": 1, "levelName": "1-1", "zombies": ["zombie"], "clock": { "state": "frozen", "speed": 1 } }
```

`clock.state` is `running`, `frozen`, `stepping` or `fast_forward` (while a level starts).

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | The request is malformed; the message says which field. |
| 404 | `not_found` | No such route. |
| 409 | `not_playing`, `paused`, `dialog_open`, `level_ending` | No level can be acted on right now. |
| 409 | `cursor_busy` | The player is holding a seed or a tool. |
| 409 | `no_such_slot`, `no_such_sun`, `no_award` | Nothing there to use. |
| 409 | `not_ready` | The seed packet can't be picked up; `reason` is `recharging`, `not_enough_sun` or `no_base_plant`. The message gives the numbers, e.g. `it costs 175 sun and you have 125` or `it's still recharging (80% done)`. |
| 409 | `cant_plant_here` | The game's placement rules say no; `reason` is the game's own reason (`PlantingReason`). The message is the hint the game shows a player for that rule, in the game's own words, or, where the game shows none, what's on the tile (another plant, dirt, ice or a vase). |
| 409 | `no_shovel` | The level has no shovel (see `shovel` in `/state`). |
| 409 | `cant_dig_up` | There's nothing to dig up on the tile, the plant named isn't there, or the game won't let it be dug up yet; the message says which. |
| 409 | `no_profile`, `needs_input`, `bad_seeds` | A level can't be started (see `startLevel`). |
| 409 | `interrupted` | A newer control command replaced this one. |
| 500 | `internal` | Something unexpected; the message says what. |
| 503 | `not_ready`, `busy`, `shutting_down` | The game isn't ready, didn't pick the request up, or is closing. |
| 504 | `timeout` | Still running when the server stopped waiting; check `/state`. |
