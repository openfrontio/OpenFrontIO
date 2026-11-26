# Scenario editor

Status: design, 2026-11-19. The engine's editor mode, the document model
(with undo and local drafts), the editor page, the terrain, territory and
units tools, the nations panel, the settings panel, bundle export and
loading and test play are built. PNG import is not.

## What it is

A scenario is a custom map plus a starting position: terrain, nations, who
owns which land, structures, warships, troops, gold and game settings. A player with
the editor builds one, publishes it, and anyone it is shared with can play
it, alone or in a private lobby where the host decides which human plays
which nation.

The editor is part of this repo and open source like the rest of the client.
What a purchase buys is the service around it: storing and publishing
scenarios on the API, and with that, playing them on the official servers.
The API enforces this (see "Entitlement"). Someone who builds the client
themselves can run the editor locally, but cannot publish.

## v1 scope

In:

- Custom terrain: paint it, import a heightmap PNG, or start from a stock map.
- Nations: add, remove, name, flag, starting troops and gold.
- Territory painting and structure placement.
- Starting warships: a nation's warship on a water tile, patrolling there.
- Game settings (the existing `GameConfig` options).
- Test play from the editor.
- Save drafts and publish to the API. Play published scenarios in
  singleplayer and in private multiplayer lobbies with host nation assignment.
- Creating or publishing needs the entitlement, which for now is granted
  only by owning the game on Steam.

Out, for now:

- Mobile units other than warships (trade ships, transports in flight,
  missiles).
- Team games. Scenarios are free-for-all.
- Compact map size. Scenarios always run at normal size.
- Triggers, scripted events, victory conditions other than the normal one.
- Public matchmaking, ranked, XP and achievements for scenario games.
- Steam Workshop listing and a web purchase (see "Later").

## Where the code lives

| Piece                                                               | Where                  |
| ------------------------------------------------------------------- | ---------------------- |
| Editor UI, tools, document model, PNG import, export, upload        | `src/client/scenario/` |
| Engine editor mode: commands, terrain editing, flush without a tick | `packages/engine`      |
| Custom map support, bundle loading, scenario game start             | engine and client      |
| Lobby support: pick a scenario, assign nations                      | client and server      |
| Scenario storage, entitlement, moderation                           | the API and R2         |

The editor is a lazily loaded chunk, so players who never open it do not
download it. It uses `MapRenderer`, `GameView`, `WorkerClient` and the HUD
layers directly.

## The three artifacts

### 1. Scenario document (the editable source)

The editor's own format and the only thing the editor edits. It does not
depend on engine internals, so a document written today opens in a later
build.

```
ScenarioDocument
  format            version of this schema
  meta              name, description
  terrain
    width, height   multiples of 4
    tiles           one byte per tile, authored values only:
                    water, land with elevation 0-30, or impassable
  nations[]         id (stable), name, flag, troops, gold, playable
  ownership         nation index per tile, run-length encoded
  structures[]      type, tile, nation, level
  alliances[]       pairs of nation ids allied at the start (optional)
  warships[]        nation, tile (optional)
  config            GameConfig fields the author chose
```

`playable` marks nations a human may be assigned to. Nations nobody takes
are run by the nation AI.

The stored form is JSON (`src/client/scenario/ScenarioDocument.ts`):

- `format` is 1.
- `terrain.tiles` is the bytes in base64: 0 is water, `0x80` plus 0-30 is
  land, `0x9f` is impassable.
- A nation's `id` is the engine's nation id, the one `add_nation` takes.
- `ownership` is flat `[owner, count]` pairs that cover every tile in order.
  Owner 0 is nobody and owner `i` is `nations[i - 1]`. Only land can be
  owned.
- `structures` is kept in tile order, one per tile. A structure stands on its
  nation's land, a port on a shore, and none is a type the config disables.
- `alliances` is optional: `[a, b]` pairs of nation ids, the lesser id first
  (plain string order), kept in order of the pairs, each pair once and never
  a nation with itself. It is left out when there are none, and a document
  without it has none. Parsing puts pairs and the list in order, and
  rejects an id no nation has and alliances when `customAllianceDuration`
  is 0 (alliances off). Removing a nation removes its pairs.
- `warships` is optional: `{ nation, tile }` objects, kept in tile order, at
  most one per tile and at most 1000 (`MAX_WARSHIPS`: each runs a warship's
  execution every tick of the game). It is left out when there are none,
  and a document without it has none. A warship's tile is any water, ocean
  or lake: in play a warship may sail on any water its port reaches, and
  the document has no ocean (the engine derives it, see "Terrain"). Parsing
  rejects an id no nation has, a tile that isn't water, and any warship
  when `disabledUnits` has Warship. Removing a nation removes its warships,
  and a tile that stops being water loses its warship.
- `config` is `difficulty`, `donateGold`, `donateTroops`, `infiniteGold`,
  `infiniteTroops`, `instantBuild`, and optionally `disabledUnits`,
  `maxTimerValue`, `goldMultiplier`, `customAllianceDuration`, `waterNukes`,
  `doomsdayClock` and `overtime`. The rest of `GameConfig` is fixed for a
  scenario (free-for-all, normal size, its own map and nations, no bots) or
  set per nation.

Parsing checks all of this and gives the editor its working form, with the
terrain and owners as typed arrays.

`alliances` and `warships` came after the first documents and did not
change `format`: they are optional, so every format 1 document still
parses, unchanged. A new `format` is for a change an older document or
build would read wrongly. The cost is that a build from before alliances
or warships drops them, as zod drops a key it doesn't know, if it saves a
document that has them.

The document stores only what the author decided. Shoreline flags, ocean
versus lake, water depth and the downscaled maps are all derived by the
engine (see "Terrain").

### 2. Map files (derived)

The same `MapFiles` the engine already takes in its init message: a manifest
plus `map.bin`, `map4x.bin` and `map16x.bin`, in the existing byte layout
(land bit, shoreline bit, ocean bit, 5-bit magnitude). The engine's terrain
arrays are already in that layout, so export writes them out as they are. The
engine never fetches maps itself, so a custom map needs no engine loader
changes, only a map identity (see "Custom map identity").

### 3. Snapshot (derived, the playable start)

An ordinary game snapshot from `GameRunner.snapshot()`, taken after the
document has been applied to a fresh engine and finalised. A snapshot does
not contain its map. It records a hash of the map files it was taken on, plus
a diff of every terrain byte changed since, and refuses to restore onto
different files. So a published scenario is always a **bundle**:

```
ScenarioBundle
  header     format, scenario id and version, engine commit, nations
             (id, name, flag, playable), content hash
  manifest   MapManifest
  map.bin, map4x.bin, map16x.bin
  snapshot
  thumbnail  webp, rendered from the terrain
```

The bundle is gzipped as a whole. For scale: a late-game World snapshot is
about 2.7 MB raw, and terrain is one byte per tile and compresses well.

Before gzip, each section is a frame: a little-endian u32 length, then the
bytes (`ScenarioBundle.ts`). The header and the manifest are JSON. The header
comes first in every format, so any build can read its `format` and refuse
one it doesn't know. The thumbnail is drawn from the 4x map as the map
generator draws a stock map's; Safari can't encode webp, so it can't export.
The hash is SHA-256 over every frame after the header, so the header can
carry it. The header's nations are only for showing before play; the
snapshot's own nations are what play. zbin is not used: it has no version and
is tied to the build.

The map files in the bundle are the finished terrain, so the snapshot's
terrain diff is empty. Shipping a blank map and letting the diff carry the
terrain would also work, but the diff costs about 6 bytes per changed tile
against 1 byte per tile in a map file.

### Why the document and the snapshot are separate

- A snapshot holds engine internals (executions, PRNG state). Later builds
  can read it through migrations, but it is not something to edit.
- The playable snapshot is finalised: AI attached, spawn phase over. The
  editor needs the state before that.
- Rebuilding from the document is the one code path for opening a draft,
  resizing the map, test play and publishing.

Both are uploaded. The document is private to its author. The bundle is what
players download.

## Editor runtime

`<scenario-editor>` owns a canvas with a `MapRenderer`, the tool and panel
UI, the document, and the editing engine's worker. It follows the
`<replay-viewer>` precedent: a full-page element that drives the renderer
itself and borrows HUD layers by setting their properties, calling `init()`
and calling `tick()` by hand.

Until the menu entry exists it is opened by URL: `#scenario-editor` shows
its start screen (the local drafts, a new blank scenario, or one started
from a stock map), and `#scenario-editor=<draftID>` opens a draft. Main
loads the element with `import()`.

### One engine, never ticking

Opening a scenario builds an engine from the document:

1. Start a `WorkerClient` in editor mode on a blank all-water map of the
   document's width and height.
2. Replay the document (`replayDocument`): write the terrain and end the
   stroke, then add each nation with its troops, gold and land, then place
   the structures, then the warships, then make the alliances.

Replay takes a function that sends one command, so the same code drives a
worker or, in tests, a `GameRunner`. For export's second engine it skips
the terrain, which the map files already hold.

The engine then holds the whole scenario, terrain included. Every edit goes
two places: into the document, and to the worker as an editor command. The
worker applies it and flushes the resulting updates to `GameView` without
advancing a tick, so the renderer and borrowed HUD layers show it the normal
way. Terrain edits arrive as ordinary tile updates, which already carry the
terrain byte; this is how water-nuke craters reach the screen today.

Terrain, territory and units (structures and warships) are tools in the
same view. There is no separate terrain mode and no engine to throw away
when switching.

The units tool places a unit of the picked type, a structure or a warship;
a click on or near a unit of any type removes the nearest, and a drag pans.
A structure goes, at the picked level, to the nation that owns the clicked
tile. It keeps the document's rules (one per tile, on its nation's
land, a port on a shore, no type the config disables, a defense post at
level 1) and nothing more: the in-game spacing between structures
(`structureMinDist`) is a build rule for players, not a scenario rule, so an
author may place structures closer than a player could build them.

A warship goes on the clicked water tile, for the nation picked in the
nations panel. With no nation picked, on land, with warships disabled or at
`MAX_WARSHIPS` it places nothing and says why. Warships
render as in game, from the engine's unit updates.

The nations panel lists, under the picked nation, every other nation with a
checkbox for an alliance between the two at the start; each change is one
undo step. The list is hidden when the settings turn alliances off.

The Settings button in the bar opens a panel with the document's game
settings: difficulty, instant build, infinite gold and troops, donating
gold and troops, water nukes, the doomsday clock and its speed, the max
timer, the gold multiplier, the alliance duration (0 turns alliances off),
overtime and the disabled units. Each change is one `set_config` edit and
one undo step. The editing engine keeps its own settings, which disable
nothing, so the settings only reach a game through export. A change that
disables something the scenario uses removes it in the same edit:
structures of a disabled type, every warship if warships are disabled, and
every alliance if alliances are turned off. The panel then says how many
structures, warships and alliances went.

Changing the map's width or height is the one edit the engine cannot take
live. It rebuilds the engine from the document.

### Undo

Undo works on the document (`DocumentEditor`). Each edit records its
inverse; undoing applies the inverse to the document and sends the matching
command to the engine.

- An undo step is every edit since the last commit. A stroke commits once,
  at its end, so it undoes as one step, and a step with terrain in it ends
  with one `end_terrain_edit`.
- A new edit clears redo.
- An edit is checked before it changes anything, so a bad one changes
  neither the document nor the engine.
- The document makes the engine's side effects itself and records them in
  the inverse. A tile that changes between water, land and impassable loses
  its owner, its structure and its warship. A port that loses its shore
  goes. Land given
  to another nation loses the old owner's structure.
- Undoing `add_nation` is `remove_nation`. Undoing `remove_nation` adds the
  nation back at its place in the list and gives back its land, structures,
  warships and alliances. The engine keeps a removed nation's player, so adding the
  id again brings back that player, with its small id, as a new nation
  starts. `set_nation` then restores its troops, gold and playable.
- Undoing `add_alliance` is `remove_alliance`, and the other way round,
  and the same for `place_warship` and `remove_warship`.
- Undoing `set_config` restores the old settings first, then puts back the
  structures, warships and alliances the change removed.

Undo history is not saved with a draft.

## Terrain

Terrain is edited in the engine. The author's brush decides three things per
tile: water, land at an elevation, or impassable. Everything else in the
terrain byte, and the downscaled map, is derived by the engine.

The engine already does most of this for water nukes.
`WaterManager.finalizeWaterChanges` takes a set of tiles that just became
water and repairs the shoreline bits, water depth, ocean bit and 2x minimap
around them, then marks the water graph for a rebuild. The shoreline and
depth passes recompute from the current terrain, so they are correct for any
edit. Three parts assume land only ever becomes water and need generalising:

- the ocean bit is only ever added,
- the minimap only ever turns land into water,
- water components only grow and merge, never split.

Terrain edits therefore run in two steps:

1. **During a stroke**, each batch of tiles is written and the local repair
   runs on its surroundings: shoreline, depth, and the minimap tiles under
   it. This is enough for the screen.
2. **When the stroke ends**, one full pass redoes what cannot be patched
   locally: it downscales the minimap from the full map again, then runs
   the ocean flood fill and sets the depth of water with no coast. The
   water component labels and the water graph wait for test play (below).

The full pass also runs before export, so the ocean bit, the depths and
the minimap in the exported files never depend on the order of the strokes
that made them.

The full pass was to stay at stroke end if it cost about as much as game
load, and otherwise the graph rebuild would move to "before test play and
export". Measured with `tests/perf/TerrainEditFullPassPerf.ts` on World
10000 (10000x5000): loading takes 0.5 s, the terrain pass 0.65-1.25 s and
the graph rebuild 0.45-0.55 s. So the graph rebuild moved. `end_terrain_edit`
runs the terrain pass: the ocean bit, and the depth of water with no coast.
`Game.rebuildWaterGraph()` relabels the water components and rebuilds the
graph, and runs before test play. Export doesn't need it: the map files
hold no water graph, and the engine that loads them builds its own. On a
2212x2212 map the terrain pass takes about 0.1 s.

Two rules:

- The minimap rule must be the generator's (`createMiniMap`), not the
  simpler one the nuke path uses. A scenario started from a stock map would
  otherwise drift from its own minimap as it is edited. The generator also
  removed tiny islands and lakes from most stock minimaps, which needs the
  whole map; until that is a tool, the first stroke on a stock map brings
  them back.
- A terrain edit under existing content clears it first. Painting water over
  owned land removes the ownership and any structure there, and the document
  is updated to match.

Starting from a stock map loads that map's files instead of a blank one and
copies its authored bytes into the document (`stockMapStart`). The files
are relabelled as a `Custom` map with no nations, so the engine
starts on them as it would on a blank map. Only the terrain is taken. A
draft started this way reopens like any other, from a blank map.

The start screen lists the stock maps and reads the picked one's manifest
for its size; a map over the limits below is shown as too large and cannot
be started from.

PNG import is editor code and is small: decode the image, apply the
generator's pixel rules (blue channel for elevation, black for impassable,
transparent for water; `imageTerrain` in `engine-lib/mapgen`), and start a
new draft with that terrain, from the start screen as a stock map is. The
generator's optional removal of tiny islands and lakes is a later tool, not
part of import. The image is cropped from the top left to the limits below,
as the generator crops it, and the draft takes the cropped size; an image
with a side under 100 is refused.

Limits: width and height are multiples of 4, each from 100 to 5000, so a
map is at most 25 million tiles. The engine, renderer and snapshot all
scale with area, and the largest stock maps in play are 8-11 million
tiles. The generator's lower bound of 2 million tiles does not hold, as a
scenario may be a small duel. A side of 100 still gives a 16x map 25 tiles
across. Stock maps with a side over 5000 cannot be a scenario's starting
map.

## Engine changes

### Custom map identity

`GameConfig.gameMap` is an enum generated from the stock maps, and both the
runner and the snapshot header check the passed files against it. Add one
value, `Custom`, that means "the files came with the game start". The
snapshot's terrain hash still guarantees the files match.

The client's `GameMapLoader` gets a way to answer for `Custom` from a loaded
bundle instead of from `resources/maps`: `FetchGameMapLoader.setCustomMap`,
which `useScenarioMap` calls with the bundle's files and its thumbnail.

### Editor mode in the worker

Editor edits are not intents. Intents are the multiplayer wire format,
validated per player and executed on a turn; an editor edit is none of
those. Instead:

- `InitMessage` gains an `editor` flag. A worker started without it rejects
  every editor message, so a normal game cannot be edited through this path.
- A new `editor_command` message carries one command.
- `GameRunner` gains a method that applies a command and then sends the
  pending updates. The payload-building half of `executeNextTick`
  (everything after `game.executeNextTick()` returns) is extracted so both
  paths share it, and `Game` gains a way to hand over pending updates
  without advancing the tick.

Commands:

| Command                               | Effect                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| `add_nation`, `remove_nation`         | Create or delete a nation player                                   |
| `set_nation`                          | Name, flag, troops, gold, playable                                 |
| `set_terrain`                         | Write authored terrain for a batch of tiles and repair around them |
| `end_terrain_edit`                    | Run the full terrain pass (see "Terrain")                          |
| `set_owner`                           | Give a batch of tiles to a nation, or to nobody                    |
| `place_structure`, `remove_structure` | Structure of a type and level at a tile                            |
| `place_warship`, `remove_warship`     | A nation's warship at a water tile                                 |
| `add_alliance`, `remove_alliance`     | Two nations allied from the start, or not                          |
| `export_terrain`                      | Run the full terrain pass and write out the map files (below)      |
| `finalize`                            | Prepare for export (below)                                         |

`add_alliance` makes the alliance an accepted request makes
(`Game.createAlliance`, which `acceptAllianceRequest` also uses), at tick
0, with the pair's first nation as the requestor. So in play it is an
ordinary alliance: it lasts the config's alliance duration from the start,
and can be renewed or broken. `remove_alliance` takes one back with no
update or stat, as if it had never been made; only the editor needs it.
`remove_nation` ends the nation's alliances the same way.

`place_warship` builds the warship a player's port would, free (the
nation's gold is left as it was, as for structures) and on its tile rather
than at a port, with that tile as its patrol tile. It refuses a tile that
isn't water, a tile with a warship, and warships the config disables.
`remove_warship` deletes it with no message, and not as a loss. A `set_terrain` that
turns a warship's water into land or impassable deletes it, and
`remove_nation` deletes the nation's warships with its structures.

### Finalising for export

Export does not snapshot the engine being edited, because finalising cannot
be undone. Instead:

1. Copy the document and, in the same step, send the editing worker one
   `export_terrain` message. It runs the full terrain pass and writes the
   terrain out as the map files. The worker handles each message to the end
   before it starts the next, and in the order sent. So the write sees
   exactly the edits sent before it, which are the edits in the copy, and
   any edit sent after it waits until the files are written. Writing only
   reads the terrain, so editing carries on afterwards and goes only into
   the live document. The 16x map is downscaled from the 4x one with the
   same minimap rule and derived as the generator derives it, which removes
   no small islands at that size. So it is exact wherever the 4x map is:
   from a stock map's shipped 4x map it gives that map's shipped 16x map,
   on every stock map. The files come back in the command's result, as a
   `Custom` map whose manifest is the one the engine started on with the
   three sizes' tile counts redone.
2. Start a second engine on those map files, replay everything except
   terrain from the copy, send `finalize`, snapshot, and discard it. In the
   browser that engine is a second worker (`exportScenario`). It starts on
   the editor's start info with the document's settings, which the snapshot
   keeps, and the snapshot records the build's commit, as the header does.

The second engine is what makes the snapshot's terrain diff empty.

Because the map files come from the editing engine, they are whatever the
stroke-by-stroke repairs left behind. The repairs must therefore be exact:
the same authored bytes give the same files whatever order they were painted
in. The terrain test checks this (see "Order of work").
`finalize`:

- gives every nation a nation AI execution, whatever the config's nations
  setting (a nation with no land is dead and stops on its first tick),
- gives every nation with land what spawning gives it: a spawn tile (its
  lowest tile) and its player execution (troop and gold growth, structure
  capture, death), and ends the alliances and deletes the warships of a
  nation with none, as death does in play (an author who wants a landless
  nation's fleet must give it land),
- gives every structure the execution it would have had if built in play,
  and every warship its warship execution, patrolling around its tile,
- adds what `GameRunner.init()` adds for a running game (win check, rail
  clusters, doomsday clock if enabled),
- ends the spawn phase.

The result is a game where every nation is AI-run and play is ready to
start. That is the same shape `extractSnapshot` already produces before it
hands a player to a human.

### Starting a game from a bundle

`GameStartInfo` gains an optional scenario block:

```
scenario: { id, version, hash, assignments: [{ clientID, nationID }] }
```

`createGameRunnerFromSnapshot` restores the snapshot, then calls the
existing `takeoverPlayer` once per assignment, in list order. `takeoverPlayer`
already removes the nation's AI execution and rebinds the player to a client.
Because the start state is "snapshot plus assignments" and both are in the
start info, every client and every replay reaches the same state.

`playable` is a field on the nation player, set by `set_nation`, so the
snapshot stores it with the rest of the player. Before any takeover, the
restore checks every assignment against the restored game and the start
info: the nation exists, is playable, and is assigned only once, and the
client is one of the start info's players. If any check fails, the restore
fails. Every client runs the same restore, so a bad start fails the
same way everywhere.

Singleplayer is the same path with one assignment, through the existing
`LobbyConfig.snapshot` route that saved games use.

Every human must be assigned a nation. The spawn phase is over, so there is
nowhere for an unassigned player to spawn.

## Playing

### Singleplayer

Pick a scenario, pick a playable nation, download the bundle, check its
hash, start. As with saved games today, a game started from a snapshot is
not archived and awards nothing.

### Test play from the editor

Export in memory, start a singleplayer game from the bundle, and return to
the editor when it ends. No upload.

### Multiplayer

- The host picks a scenario in a private lobby. The lobby's capacity is the
  number of playable nations, which the host's client sends with the
  scenario.
- The lobby shows the playable nations. The host assigns each joined player
  to one. The game cannot start until every player has a nation. A player
  who leaves the lobby loses their assignment, and their nation is free
  again.
- The server never fetches the bundle and does not simulate. It checks only
  what it can see: every player has exactly one nation, no nation is
  assigned twice, and every assignment is for a player still in the lobby.
  If any check fails, it refuses the start. It then puts the scenario block in the start info and runs
  the game as usual, so starting a scenario game adds no API dependency to
  the game servers.
- Each client downloads the bundle by id and version, verifies the hash from
  the start info, and checks the assignments against the playable nations
  in the snapshot itself, not the header's copy of that list (the restore
  check in "Starting a game from a bundle"). A client that finds a mismatch
  refuses to start. The host's client makes the same checks
  in the lobby, so only a modified host can send a bad start, and it breaks
  only that host's own private game.
- Each client then restores the snapshot and applies the assignments.
- Rejoining works unchanged: the server replays turns from the start, and the
  start state is reproducible.
- Published versions are immutable, so a game record that names
  `{id, version, hash}` stays replayable.

## Storage and API

The API is the source of truth. Bytes live in R2. Steam is only how the
entitlement is granted.

```
POST   /scenarios                          create a draft        (entitled)
PUT    /scenarios/:id/document             save the document     (owner)
GET    /scenarios/:id/document             load it               (owner)
POST   /scenarios/:id/versions             publish a bundle      (owner, entitled)
GET    /scenarios/:id                      metadata and versions
GET    /scenarios/:id/versions/:v/bundle   download
GET    /scenarios?mine | ?public           list
DELETE /scenarios/:id                      unpublish             (owner, moderator)
```

- Publishing creates a new immutable version. It never overwrites one.
- The API cannot run the engine, so it validates only the envelope: size
  caps, header schema, manifest schema, bin lengths against the manifest.
- Names and descriptions go through the existing name filter. There is a
  report and takedown path. Thumbnails are rendered from terrain, so terrain
  itself can be offensive; moderation has to cover that.

### Entitlement

One account-level flag, `scenario_editor`.

- Granted when the API verifies Steam ownership for a linked account.
- Checked by the API on create and publish. This is the real gate.
- Because it is on the account, a player who bought on Steam and logs in on
  web already has it, and a later web purchase is just another way to set
  the same flag.

The client shows the editor's menu entry only when the API reports the flag.
That is a convenience, not a gate: the client is open source, so anyone can
open the editor in their own build. What they cannot do is create or publish
on the API.

The editor has no way to export a scenario to a file or load one from a
file. Drafts and published versions go through the API, so the entitlement
covers every way of saving or sharing one.

### Untrusted bundles

A bundle is another player's upload that the client decodes and restores.
Clients cap its inflated size (as `SavedGamesApi` does for shared saves),
validate every section against its schema, and verify the hash. The cap is
21/16 bytes a tile for the map files plus 5 for the snapshot, about 166 MB on
a 25M-tile map; export refuses a bundle over it. Measured on exported maps, a
snapshot's tile lists take one byte a tile owned in one block and four with
every tile a random one of 400 nations'. Snapshot restore already validates
each record with zod; that path gets a hostile input review before scenarios
are shareable.

## Order of work

1. **Engine editor mode**: `Custom` map, editor commands
   including terrain, flush without a tick, `finalize`. Testable without any
   UI: build a document in a test, export, restore, tick. Terrain has its own
   test: replay a stock map's authored bytes onto a blank map and compare the
   result with that map's shipped files, both as one edit and as many
   overlapping strokes in shuffled order.
2. **Editor core**: document model, tools, PNG import, test play. Until the
   API exists, the draft is kept in browser storage: IndexedDB, as the
   stored form the API will take (`ScenarioDrafts`). localStorage is too
   small, as a 25M-tile document is about 33 MB of base64.
3. **Scenario start**: bundle loading, scenario block in the
   start info, singleplayer play.
4. **API**: storage, entitlement, publish, list. Then the editor's save and
   publish, the menu entry, and a scenario picker in the client.
5. **Multiplayer** (client and server): scenario lobbies and nation
   assignment.

## Later

- **Steam Workshop** as an index. A Workshop item holds only a scenario id;
  subscribing makes the client fetch the bundle from the API as usual.
- **Web purchase**: another way to set the same account flag. The editor is
  already in every build.
- Units, team scenarios, triggers.

## Open questions

1. Does every player in a scenario lobby need the entitlement, or only the
   host? This doc assumes only the host.
2. When a human takes a nation, do other players see the human's name or the
   nation's?
3. Do web players get a scenario browser in v1, or only join by invite?
4. A snapshot restored on a newer build continues sensibly but runs that
   build's rules. Is that acceptable for old scenarios after a balance
   change, or should authors be prompted to re-publish from the document?
5. Should a published scenario's document be downloadable by others so they
   can remix it?
