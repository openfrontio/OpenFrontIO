import Benchmark from "benchmark";
import { PlayerType } from "../../src/core/game/Game";
import { diffPlayerUpdate } from "../../src/core/game/GameUpdateUtils";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "../../src/core/game/GameUpdates";

/**
 * Benchmark for diffPlayerUpdate, which runs once per player per tick on the
 * worker thread.
 *
 * BEFORE compared the array/object fields (outgoingAttacks, incomingAttacks,
 * alliances, outgoingEmojis) with JSON.stringify — two allocations per field,
 * run on every call even when nothing changed. AFTER uses typed structural
 * comparisons that early-exit and allocate nothing.
 */

function makeAttacks(n: number): AttackUpdate[] {
  return Array.from({ length: n }, (_, i) => ({
    attackerID: 1,
    targetID: 2 + i,
    troops: 1000 + i,
    id: `attack-${i}`,
    retreating: false,
  }));
}

function makeAlliances(n: number): AllianceView[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    other: `player-${i}`,
    createdAt: 100 + i,
    expiresAt: 1000 + i,
    hasExtensionRequest: false,
  }));
}

function makeRealisticUpdate(
  overrides: Partial<PlayerUpdate> = {},
): PlayerUpdate {
  return {
    type: GameUpdateType.Player,
    clientID: "client-a",
    name: "Alice",
    displayName: "Alice",
    id: "player-a",
    smallID: 1,
    playerType: PlayerType.Human,
    isAlive: true,
    isDisconnected: false,
    tilesOwned: 5000,
    gold: 123456n,
    troops: 50000,
    allies: [2, 3, 4, 5, 6],
    embargoes: new Set(["7", "8", "9"]),
    isTraitor: false,
    traitorRemainingTicks: 0,
    targets: [10, 11],
    outgoingEmojis: [],
    outgoingAttacks: makeAttacks(4),
    incomingAttacks: makeAttacks(3),
    outgoingAllianceRequests: ["12", "13"],
    alliances: makeAlliances(5),
    hasSpawned: true,
    spawnTile: 999,
    betrayals: 0,
    lastDeleteUnitTick: 0,
    isLobbyCreator: false,
    ...overrides,
  };
}

// ── BEFORE: the JSON.stringify-based diff ──

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function numberArrayEqual(a?: number[], b?: number[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function stringArrayEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function stringSetEqual(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function diffPlayerUpdateBefore(
  prev: PlayerUpdate,
  next: PlayerUpdate,
): PlayerUpdate | null {
  const diff: PlayerUpdate = { type: GameUpdateType.Player, id: next.id };
  let changed = false;

  const setIfDifferent = <K extends keyof PlayerUpdate>(
    key: K,
    equal: boolean,
  ) => {
    if (!equal) {
      (diff[key] as PlayerUpdate[K]) = next[key] as PlayerUpdate[K];
      changed = true;
    }
  };

  setIfDifferent("clientID", prev.clientID === next.clientID);
  setIfDifferent("name", prev.name === next.name);
  setIfDifferent("displayName", prev.displayName === next.displayName);
  setIfDifferent("team", prev.team === next.team);
  setIfDifferent("smallID", prev.smallID === next.smallID);
  setIfDifferent("playerType", prev.playerType === next.playerType);
  setIfDifferent("isAlive", prev.isAlive === next.isAlive);
  setIfDifferent("isDisconnected", prev.isDisconnected === next.isDisconnected);
  setIfDifferent("tilesOwned", prev.tilesOwned === next.tilesOwned);
  setIfDifferent("gold", prev.gold === next.gold);
  setIfDifferent("troops", prev.troops === next.troops);
  setIfDifferent("isTraitor", prev.isTraitor === next.isTraitor);
  setIfDifferent(
    "traitorRemainingTicks",
    prev.traitorRemainingTicks === next.traitorRemainingTicks,
  );
  setIfDifferent("hasSpawned", prev.hasSpawned === next.hasSpawned);
  setIfDifferent("spawnTile", prev.spawnTile === next.spawnTile);
  setIfDifferent("betrayals", prev.betrayals === next.betrayals);
  setIfDifferent(
    "lastDeleteUnitTick",
    prev.lastDeleteUnitTick === next.lastDeleteUnitTick,
  );
  setIfDifferent("isLobbyCreator", prev.isLobbyCreator === next.isLobbyCreator);
  setIfDifferent("allies", numberArrayEqual(prev.allies, next.allies));
  setIfDifferent("targets", numberArrayEqual(prev.targets, next.targets));
  setIfDifferent(
    "outgoingAllianceRequests",
    stringArrayEqual(
      prev.outgoingAllianceRequests,
      next.outgoingAllianceRequests,
    ),
  );
  setIfDifferent("embargoes", stringSetEqual(prev.embargoes, next.embargoes));
  setIfDifferent(
    "outgoingEmojis",
    jsonEqual(prev.outgoingEmojis, next.outgoingEmojis),
  );
  setIfDifferent(
    "outgoingAttacks",
    jsonEqual(prev.outgoingAttacks, next.outgoingAttacks),
  );
  setIfDifferent(
    "incomingAttacks",
    jsonEqual(prev.incomingAttacks, next.incomingAttacks),
  );
  setIfDifferent("alliances", jsonEqual(prev.alliances, next.alliances));

  return changed ? diff : null;
}

// ── Benchmark cases ──

const unchangedPrev = makeRealisticUpdate();
const unchangedNext = makeRealisticUpdate();

const primPrev = makeRealisticUpdate();
const primNext = makeRealisticUpdate({ gold: 200000n });

const arrPrev = makeRealisticUpdate();
const arrNext = makeRealisticUpdate({ outgoingAttacks: makeAttacks(5) });

const results: string[] = [];

const suite = new Benchmark.Suite()
  .add("BEFORE unchanged (JSON.stringify)", () =>
    diffPlayerUpdateBefore(unchangedPrev, unchangedNext),
  )
  .add("AFTER  unchanged (typed compare)", () =>
    diffPlayerUpdate(unchangedPrev, unchangedNext),
  )
  .add("BEFORE primitive changed (JSON.stringify)", () =>
    diffPlayerUpdateBefore(primPrev, primNext),
  )
  .add("AFTER  primitive changed (typed compare)", () =>
    diffPlayerUpdate(primPrev, primNext),
  )
  .add("BEFORE array changed (JSON.stringify)", () =>
    diffPlayerUpdateBefore(arrPrev, arrNext),
  )
  .add("AFTER  array changed (typed compare)", () =>
    diffPlayerUpdate(arrPrev, arrNext),
  )
  .on("cycle", (event: Benchmark.Event) => {
    results.push(String(event.target));
  })
  .on("complete", function (this: Benchmark.Suite) {
    console.log("\n=== diffPlayerUpdate Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
    const fastest = this.filter("fastest").map("name");
    console.log(`\nFastest: ${fastest.join(", ")}`);
  });

suite.run({ async: false });
