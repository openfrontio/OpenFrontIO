# Scenario editor

Status: design, 2026-11-18. Nothing here is built yet.

## What it is

A scenario is a custom map plus a starting position: terrain, nations, who
owns which land, structures, troops, gold and game settings. A player with
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
- Game settings (the existing `GameConfig` options).
- Test play from the editor.
- Save drafts and publish to the API. Play published scenarios in
  singleplayer and in private multiplayer lobbies with host nation assignment.
- Creating or publishing needs the entitlement, which for now is granted
  only by owning the game on Steam.

Out, for now:

- Mobile units (warships, trade ships, transports in flight). Structures only.
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
  config            GameConfig fields the author chose
```

`playable` marks nations a human may be assigned to. Nations nobody takes
are run by the nation AI.

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
UI, the document, and at most one engine worker. It follows the
`<replay-viewer>` precedent: a full-page element that drives the renderer
itself and borrows HUD layers by setting their properties, calling `init()`
and calling `tick()` by hand.

### One engine, never ticking

Opening a scenario builds an engine from the document:

1. Start a `WorkerClient` in editor mode on a blank all-water map of the
   document's width and height.
2. Replay the document: write the terrain, add nations, set ownership, place
   structures, set troops and gold.

The engine then holds the whole scenario, terrain included. Every edit goes
two places: into the document, and to the worker as an editor command. The
worker applies it and flushes the resulting updates to `GameView` without
advancing a tick, so the renderer and borrowed HUD layers show it the normal
way. Terrain edits arrive as ordinary tile updates, which already carry the
terrain byte; this is how water-nuke craters reach the screen today.

Terrain, territory and structures are tools in the same view. There is no
separate terrain mode and no engine to throw away when switching.

Changing the map's width or height is the one edit the engine cannot take
live. It rebuilds the engine from the document.

### Undo

Undo works on the document. Each edit records its inverse; undoing applies
the inverse to the document and sends the matching command to the engine.

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
   locally: the ocean flood fill, the water component labels and the water
   graph. Building a fresh `WaterManager` does the last two, the same work
   every game does at load.

The full pass also runs before any snapshot, so exported terrain never
depends on the order of the strokes that made it.

The cost of the full pass on a large map is not yet measured. It is fine at
stroke end if it is in the range of game load; if not, the graph rebuild
moves to "before test play and export" and only the ocean fill stays at
stroke end.

Two rules:

- The minimap rule must be the generator's (`createMiniMap`), not the
  simpler one the nuke path uses. A scenario started from a stock map would
  otherwise drift from its own minimap as it is edited.
- A terrain edit under existing content clears it first. Painting water over
  owned land removes the ownership and any structure there, and the document
  is updated to match.

Starting from a stock map loads that map's files instead of a blank one and
copies its authored bytes into the document.

PNG import is editor code and is small: decode the image, apply the
generator's pixel rules (blue channel for elevation, black for impassable,
transparent for water), and send the result as one terrain edit. The
generator's optional removal of tiny islands and lakes is a later tool, not
part of import.

Limits: width and height are multiples of 4, with a minimum and maximum area
to be set from the generator's existing recommended range.

## Engine changes

### Custom map identity

`GameConfig.gameMap` is an enum generated from the stock maps, and both the
runner and the snapshot header check the passed files against it. Add one
value, `Custom`, that means "the files came with the game start". The
snapshot's terrain hash still guarantees the files match.

The client's `GameMapLoader` gets a way to answer for `Custom` from a loaded
bundle instead of from `resources/maps`.

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
| `set_nation`                          | Name, flag, troops, gold                                           |
| `set_terrain`                         | Write authored terrain for a batch of tiles and repair around them |
| `end_terrain_edit`                    | Run the full terrain pass (see "Terrain")                          |
| `set_owner`                           | Give a batch of tiles to a nation, or to nobody                    |
| `place_structure`, `remove_structure` | Structure of a type and level at a tile                            |
| `finalize`                            | Prepare for export (below)                                         |

### Finalising for export

Export does not snapshot the engine being edited, because finalising cannot
be undone. It runs in two engines:

1. Replay the document into a fresh editor engine on a blank map, run the
   full terrain pass, and write out its terrain as the map files. The 16x map
   is downscaled from the 4x one with the same minimap rule.
2. Start a second engine on those map files, replay everything except
   terrain, send `finalize`, snapshot, and discard both.

The second engine is what makes the snapshot's terrain diff empty.
`finalize`:

- gives every nation a nation AI execution,
- gives every structure the execution it would have had if built in play,
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
  to one. The game cannot start until every player has a nation.
- The server never fetches the bundle and does not simulate. It checks only
  what it can see: every player has exactly one nation and no nation is
  assigned twice. It then puts the scenario block in the start info and runs
  the game as usual, so starting a scenario game adds no API dependency to
  the game servers.
- Each client downloads the bundle by id and version, verifies the hash from
  the start info, and checks the assignments against the playable nations
  in the snapshot itself, not the header's copy of that list. A client that
  finds a mismatch refuses to start. The host's client makes the same checks
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
validate every section against its schema, and verify the hash. Snapshot
restore already validates each record with zod; that path gets a hostile
input review before scenarios are shareable.

## Order of work

1. **Engine editor mode**: `Custom` map, editor commands
   including terrain, flush without a tick, `finalize`. Testable without any
   UI: build a document in a test, export, restore, tick. Terrain has its own
   test: replay a stock map's authored bytes onto a blank map and compare the
   result with that map's shipped files.
2. **Editor core**: document model, tools, PNG import, test play. Until the
   API exists, the draft is kept in browser storage.
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
- **Map generator in TypeScript.** With terrain derivation in the engine, the
  Go generator and the engine are two implementations of the same rules.
  Rewriting the generator on top of the engine's code would leave one. It is
  not needed for the editor. The constraint is that CI regenerates every
  stock map and fails on any byte difference, so the rewrite has to reproduce
  the current files exactly, thumbnails included, or regenerate all of them
  in one change.

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
