# Game snapshots

`snapshotGame(game)` serializes the whole core simulation at a tick boundary.
`restoreGame(bytes, deps)` rebuilds it in a fresh game that keeps ticking with
the same results as the original. Uses: pause and resume, fork, custom
scenarios, and replay seeking.

## API

- `GameRunner.snapshot()` / `snapshotGame(game)`: uncompressed bytes, taken
  between ticks.
- `createGameRunnerFromSnapshot(gameStart, bytes, ...)` /
  `restoreGame(bytes, deps)`: resume. Don't call `GameRunner.init()`; the
  first turn added afterwards is the turn for the snapshot's tick.
- Worker: `WorkerClient.snapshot()`, and `new WorkerClient(start, clientID,
snapshot)` to start from one.
- `compressSnapshot` / `decompressSnapshot`: gzip via CompressionStream.
- `readSnapshotHeader(bytes)`: tick, game id, writer's commit, and config,
  without restoring.

A late-game World snapshot (400 bots, 650k owned tiles, about 1,000 units
and executions) is about 2.7 MB raw and 1.2 MB gzipped. It takes about
90 ms to write and 150 ms to restore in Node.

## Compatibility

Snapshots must stay readable by later builds. Each stored object is a
versioned record, `{ v, d }`, and the encoding
([SnapshotCodec.ts](SnapshotCodec.ts)) is self-describing. It carries field
names and types, so an old record decodes to plain data and is then migrated.
zbin is not used here: it is positional, so an old layout cannot be decoded
at all.

A newer build runs different simulation code, so a restored game continues
_sensibly_ on it but not hash-identically. Exact continuation is only
guaranteed on the build that wrote the snapshot, which is what the tests check.

**Changing what a class stores** means:

1. Bump `version` on its snapshot type.
2. Add `migrations[oldVersion]`, a function from the old record data to the
   new one (for example, fill a new field with the value an old game would
   effectively have had).
3. Update the schema, `snapshot()` and `restoreSnapshot()`.

`snapshotType()` refuses to build a type that is missing a migration.
Record type names (`name`) are stored in snapshots, so never rename or reuse
one. To retire an execution class, keep a registry entry that restores its
old records as whatever replaced it.

The map file itself is not stored. A snapshot records a hash of the map's
terrain, and a restore onto a different map file fails.

## Layout

The root ([GameSnapshot.ts](GameSnapshot.ts)) holds the game config, the game
state, both maps, and one table per shared object kind: players, units,
attacks, alliances, alliance requests, train stations, railroads, clusters
and executions.

Nothing holds an object pointer. Players are their small id (0 = terra
nullius), tiles are TileRefs, and every other shared object is an index into
its table ([SnapshotContext.ts](SnapshotContext.ts)). `SnapshotWriter`
assigns indexes in first-reference order and keeps draining the tables until
no new rows turn up, so dead units, deleted attacks and removed stations that
something still references get stored like live ones.

Restore runs in two passes. Pass 1 creates an empty shell per row with
`Object.create(Class.prototype)`, so no constructor or field initializer runs:
many have side effects such as spawning units, recording stats, or seeding a
PRNG from the current tick. Pass 2 calls `restoreSnapshot` on each shell.

## Writing `snapshot()` / `restoreSnapshot()`

Every `Execution` implements `snapshot(w: SnapshotWriter): ExecRecord` and
`restoreSnapshot(state, r: SnapshotReader)`. It exports
`<ClassName>Snapshot = execSnapshotType({ name, version, schema, cls })`,
which is listed in [ExecutionRegistry.ts](ExecutionRegistry.ts). Put the zod
schema in its own const so the state type does not circle back through the
class:

```ts
export class FooExecution implements Execution {
  private active = true;
  private mg: Game;
  private target: Player;
  private random: PseudoRandom;
  // ...

  snapshot(w: SnapshotWriter): ExecRecord {
    return FooExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      target: w.player(this.target),
      random: w.random(this.random),
    });
  }

  restoreSnapshot(s: FooState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.target = r.player(s.target);
    this.random = r.random(s.random);
  }
}

const FooStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  target: zPlayerRef(),
  random: zRandom(),
});
type FooState = z.infer<typeof FooStateSchema>;

export const FooExecutionSnapshot = execSnapshotType({
  name: "Foo",
  version: 1,
  schema: FooStateSchema,
  cls: () => FooExecution,
});
```

Rules:

- **Restore every field, exactly.** A shell starts with no fields at all.
  Anything the class declares must be assigned unless it was `undefined` in
  the live object. Preserve `undefined` versus `null`: an execution that was
  never `init`ed has no `mg`, and some classes test for that.
- **Only assign in `restoreSnapshot`.** Other objects may still be empty
  shells, so don't call methods on anything you get from the reader. If you
  need a player's id string, use `r.playerID(smallID)`, not
  `r.player(n).id()`.
- **Order is state.** Any Map, Set or array that is iterated during a tick is
  stored as an ordered list and rebuilt in that order.
- **Identity is state.** If two fields point at one object (a PRNG shared
  between a nation and its behaviors, a PlayerInfo shared with a player),
  restore must give both the same object. The tests check aliasing.
- **Caches are not state** if they are rebuilt on demand and never change a
  result. Leave them empty on restore and add the field name to
  `DERIVED_FIELDS` in `tests/util/Snapshot.ts`. Anything read while stale (a
  TTL cache, a cached path) is state.
- **Derived references** (`mg`, `mg.config()`, `game.railNetwork()`) come from
  `r.game`. Stored references go through the writer: `w.player`, `w.owner`
  (may be terra nullius), `w.unit`, `w.attack`, `w.alliance`,
  `w.allianceRequest`, `w.exec`, `w.station`, `w.railroad`, `w.cluster`.
- **PRNGs** are four state words: `w.random(r)` / `r.random(state)`.
- **Pathfinders** hold traversal state that is saved, not recomputed. See
  [PathfinderSnapshots.ts](PathfinderSnapshots.ts).
- **Floats** that may be non-finite use `zNum()`. Integers use `zInt()`.
- **Nested helper objects** (nation behaviors, for example) get their own
  `snapshot()` / `restoreSnapshot()` and their own schema, embedded in the
  owner's record.

## Tests

`tests/util/Snapshot.ts` has `expectSnapshotRoundTrip(game, mapName, ticks)`.
It checks that a restore reproduces the live object graph (`diffGraphs`,
including aliasing and collection order), that snapshotting is idempotent,
and that the original and restored games stay byte-identical tick by tick.
`tests/core/snapshot/` holds per-feature scenarios and a full-game test.

## Known gaps

- For up to 20 ticks after a water nuke, the live game routes ships on a
  stale water graph (`WaterManager` rebuilds it on a throttle). A restore
  rebuilds the graph from the current water, so a ship that asks for a new
  route inside that window can take a different one. The same applies to a
  ship still counting down its rebuild stagger (`WaterPathFinder.fromState`).
- Client-side state (GameView, renderer) is not stored. The client rebuilds
  from the restored game's first full update.
