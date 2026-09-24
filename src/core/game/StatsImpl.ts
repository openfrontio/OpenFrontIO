import { z } from "zod";
import { AllPlayersStats, ClientID } from "../Schemas";
import { snapshotType } from "../snapshot/SnapshotType";
import {
  ALLIANCE_INDEX_BROKEN_BY_OTHER,
  ALLIANCE_INDEX_EXPIRED,
  ALLIANCE_INDEX_FORMED,
  ALLIANCE_INDEX_HELD_TO_END,
  ALLIANCE_INDEX_LONGEST_HELD,
  ALLIANCE_INDEX_PEAK_CONCURRENT,
  ATTACK_INDEX_CANCEL,
  ATTACK_INDEX_MAX_RECV,
  ATTACK_INDEX_RECV,
  ATTACK_INDEX_SENT,
  BOAT_INDEX_ARRIVE,
  BOAT_INDEX_CAPTURE,
  BOAT_INDEX_DESTROY,
  BOAT_INDEX_LOST,
  BOAT_INDEX_SENT,
  BoatUnit,
  BoatUnitType,
  BOMB_INDEX_INTERCEPT,
  BOMB_INDEX_LAND,
  BOMB_INDEX_LAUNCH,
  DONATION_BROKE_GOLD_THRESHOLD,
  DONATION_INDEX_GOLD_RECV,
  DONATION_INDEX_GOLD_RECV_BROKE,
  GOLD_INDEX_DONATE_RECV,
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
  NukeType,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_CAPTURE,
  OTHER_INDEX_DESTROY,
  OTHER_INDEX_LOST,
  OTHER_INDEX_UPGRADE,
  OtherUnitType,
  PLAYER_INDEX_BOT,
  PLAYER_INDEX_HUMAN,
  PLAYER_INDEX_NATION,
  PlayerStats,
  TILE_INDEX_DRAWDOWN_PEAK,
  TILE_INDEX_DRAWDOWN_TROUGH,
  TILE_INDEX_PEAK,
  unitTypeToBoatUnit,
  unitTypeToBombUnit,
  unitTypeToOtherUnit,
} from "../StatsSchemas";
import { Player, PlayerType, TerraNullius } from "./Game";
import { Stats } from "./Stats";

type BigIntLike = bigint | number;
function _bigint(value: BigIntLike): bigint {
  switch (typeof value) {
    case "bigint":
      return value;
    case "number":
      return BigInt(Math.floor(value));
  }
}

const conquest_by_type: Record<PlayerType, number> = {
  [PlayerType.Human]: PLAYER_INDEX_HUMAN,
  [PlayerType.Nation]: PLAYER_INDEX_NATION,
  [PlayerType.Bot]: PLAYER_INDEX_BOT,
};

export class StatsImpl implements Stats {
  private data: AllPlayersStats = {};

  snapshot(): StatsState {
    return { data: this.data };
  }

  /** Fills a prototype-only shell; see RestorableExecution.restoreSnapshot. */
  restoreSnapshot(s: StatsState): void {
    this.data = s.data as AllPlayersStats;
  }

  getPlayerStats(player: Player): PlayerStats {
    const clientID = player.clientID();
    if (clientID === null) return undefined;
    return this.data[clientID];
  }

  stats() {
    return this.data;
  }

  private _makePlayerStats(player: Player): PlayerStats {
    const clientID = player.clientID();
    if (clientID === null) return undefined;
    if (clientID in this.data) {
      return this.data[clientID];
    }
    const data = {} satisfies PlayerStats;
    this.data[clientID] = data;
    return data;
  }

  private _addAttack(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.attacks ??= [0n];
    while (p.attacks.length <= index) p.attacks.push(0n);
    p.attacks[index] += _bigint(value);
  }

  private _maxAttack(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.attacks ??= [0n];
    while (p.attacks.length <= index) p.attacks.push(0n);
    const v = _bigint(value);
    if (v > p.attacks[index]) p.attacks[index] = v;
  }

  private _addBetrayal(player: Player, value: BigIntLike) {
    const data = this._makePlayerStats(player);
    if (data === undefined) return;
    data.betrayals ??= 0n;
    data.betrayals += _bigint(value);
  }

  private _addBoat(
    player: Player,
    type: BoatUnit,
    index: number,
    value: BigIntLike,
  ) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.boats ??= { [type]: [0n] };
    p.boats[type] ??= [0n];
    while (p.boats[type].length <= index) p.boats[type].push(0n);
    p.boats[type][index] += _bigint(value);
  }

  private _addBomb(
    player: Player,
    nukeType: NukeType,
    index: number,
    value: BigIntLike,
  ): void {
    const type = unitTypeToBombUnit[nukeType];
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.bombs ??= { [type]: [0n] };
    p.bombs[type] ??= [0n];
    while (p.bombs[type].length <= index) p.bombs[type].push(0n);
    p.bombs[type][index] += _bigint(value);
  }

  private _addGold(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.gold ??= [0n];
    while (p.gold.length <= index) p.gold.push(0n);
    p.gold[index] += _bigint(value);
  }

  private _addDonation(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.donations ??= [0n];
    while (p.donations.length <= index) p.donations.push(0n);
    p.donations[index] += _bigint(value);
  }

  private _addOtherUnit(
    player: Player,
    otherUnitType: OtherUnitType,
    index: number,
    value: BigIntLike,
  ) {
    const type = unitTypeToOtherUnit[otherUnitType];
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.units ??= { [type]: [0n] };
    p.units[type] ??= [0n];
    while (p.units[type].length <= index) p.units[type].push(0n);
    p.units[type][index] += _bigint(value);
  }

  private _addConquest(player: Player, index: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.conquests ??= [0n];
    while (p.conquests.length <= index) p.conquests.push(0n);
    p.conquests[index] += _bigint(1);
  }

  private _addPlayerKilled(player: Player, tick: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.killedAt = _bigint(tick);
  }

  private _allianceArray(p: NonNullable<PlayerStats>, index: number) {
    p.alliances ??= [0n];
    while (p.alliances.length <= index) p.alliances.push(0n);
    return p.alliances;
  }

  private _maxAlliance(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const arr = this._allianceArray(p, index);
    const v = _bigint(value);
    if (v > arr[index]) arr[index] = v;
  }

  private _addAlliance(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const arr = this._allianceArray(p, index);
    arr[index] += _bigint(value);
  }

  /** For slots holding a snapshot of end-of-game state rather than a running
   * total, so that writing one twice cannot silently double it. */
  private _setAlliance(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    const arr = this._allianceArray(p, index);
    arr[index] = _bigint(value);
  }

  attack(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_SENT, troops);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, troops);
    }
  }

  attackMaxIncoming(target: Player | TerraNullius, troops: BigIntLike): void {
    if (!target.isPlayer()) return;
    // A running maximum, deliberately not reversed by attackCancel: the attack
    // was bearing down at this size, and "the biggest attack I faced" is about
    // what was sent at you, not what survived being called off.
    this._maxAttack(target, ATTACK_INDEX_MAX_RECV, troops);
  }

  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_CANCEL, troops);
    this._addAttack(player, ATTACK_INDEX_SENT, -troops);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, -troops);
    }
  }

  betray(player: Player): void {
    this._addBetrayal(player, 1);
  }

  allianceFormed(player: Player): void {
    this._addAlliance(player, ALLIANCE_INDEX_FORMED, 1);
  }

  allianceEnded(
    player: Player,
    durationTicks: BigIntLike,
    counter: "brokenByOther" | "expired" | null,
  ): void {
    if (counter === "brokenByOther") {
      this._addAlliance(player, ALLIANCE_INDEX_BROKEN_BY_OTHER, 1);
    } else if (counter === "expired") {
      this._addAlliance(player, ALLIANCE_INDEX_EXPIRED, 1);
    }
    this._maxAlliance(player, ALLIANCE_INDEX_LONGEST_HELD, durationTicks);
  }

  boatSendTrade(player: Player, target: Player): void {
    this._addBoat(player, "trade", BOAT_INDEX_SENT, 1);
  }

  boatArriveTrade(player: Player, target: Player, gold: BigIntLike): void {
    this._addBoat(player, "trade", BOAT_INDEX_ARRIVE, 1);
    this._addGold(player, GOLD_INDEX_TRADE, gold);
    this._addGold(target, GOLD_INDEX_TRADE, gold);
  }

  boatCapturedTrade(player: Player, target: Player, gold: BigIntLike): void {
    this._addBoat(player, "trade", BOAT_INDEX_CAPTURE, 1);
    this._addGold(player, GOLD_INDEX_STEAL, gold);
  }

  boatDestroyTrade(player: Player, target: Player): void {
    this._addBoat(player, "trade", BOAT_INDEX_DESTROY, 1);
  }

  boatSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addBoat(player, "trans", BOAT_INDEX_SENT, 1);
  }

  boatArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addBoat(player, "trans", BOAT_INDEX_ARRIVE, 1);
  }

  boatDestroyTroops(player: Player, target: Player, troops: BigIntLike): void {
    this._addBoat(player, "trans", BOAT_INDEX_DESTROY, 1);
  }

  boatCapturedTroops(player: Player, target: Player): void {
    this._addBoat(player, "trans", BOAT_INDEX_CAPTURE, 1);
  }

  boatLose(player: Player, type: BoatUnitType): void {
    this._addBoat(player, unitTypeToBoatUnit[type], BOAT_INDEX_LOST, 1);
  }

  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    this._addBomb(player, type, BOMB_INDEX_LAUNCH, 1);
  }

  bombLand(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    this._addBomb(player, type, BOMB_INDEX_LAND, 1);
  }

  bombIntercept(player: Player, type: NukeType, count: BigIntLike): void {
    this._addBomb(player, type, BOMB_INDEX_INTERCEPT, count);
  }

  goldWork(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_WORK, gold);
  }

  goldDonationReceived(
    player: Player,
    gold: BigIntLike,
    goldBefore: BigIntLike,
  ): void {
    this._addGold(player, GOLD_INDEX_DONATE_RECV, gold);
    this._addDonation(player, DONATION_INDEX_GOLD_RECV, 1);
    if (_bigint(goldBefore) < DONATION_BROKE_GOLD_THRESHOLD) {
      this._addDonation(player, DONATION_INDEX_GOLD_RECV_BROKE, 1);
    }
  }

  goldWar(player: Player, captured: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_WAR, gold);
    const conquestType = conquest_by_type[captured.type()];
    if (conquestType !== undefined) {
      this._addConquest(player, conquestType);
    }
  }

  unitBuild(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_BUILT, 1);
  }

  unitCapture(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_CAPTURE, 1);
  }

  unitUpgrade(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_UPGRADE, 1);
  }

  unitDestroy(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_DESTROY, 1);
  }

  unitLose(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_LOST, 1);
  }

  playerKilled(player: Player, tick: number): void {
    this._addPlayerKilled(player, tick);
  }

  recordFinalTiles(player: Player, tiles: BigIntLike): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.finalTiles = _bigint(tiles);
  }

  recordAlliancesAtEnd(
    player: Player,
    stillStanding: number,
    longestStandingTicks: BigIntLike,
  ): void {
    // HELD_TO_END is a count of what was standing at the final tick, not a
    // tally of events: it is written, not accumulated. Today setWinner runs
    // once per game, but an additive write would double silently the day that
    // stops being true, and no assertion anywhere would catch it.
    this._setAlliance(player, ALLIANCE_INDEX_HELD_TO_END, stillStanding);
    this._maxAlliance(
      player,
      ALLIANCE_INDEX_LONGEST_HELD,
      longestStandingTicks,
    );
  }

  recordTickSample(
    player: Player,
    tiles: BigIntLike,
    troops: BigIntLike,
    allianceCount: number,
  ): void {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;

    const t = _bigint(tiles);
    p.tiles ??= [0n, 0n, 0n];
    while (p.tiles.length <= TILE_INDEX_DRAWDOWN_TROUGH) p.tiles.push(0n);
    if (t > p.tiles[TILE_INDEX_PEAK]) p.tiles[TILE_INDEX_PEAK] = t;
    const peak = p.tiles[TILE_INDEX_PEAK];
    const ddPeak = p.tiles[TILE_INDEX_DRAWDOWN_PEAK];
    const ddTrough = p.tiles[TILE_INDEX_DRAWDOWN_TROUGH];
    // Cross-multiplied rather than compared as a ratio, so this stays in
    // exact integer arithmetic. bigint is unbounded, so there is no overflow
    // to reason about. ddPeak === 0n means no drawdown has been recorded yet
    // (including a leading zero-tile sample, which cannot itself represent a
    // decline), so unconditionally seed rather than comparing against it.
    if (ddPeak === 0n || (peak - t) * ddPeak > (ddPeak - ddTrough) * peak) {
      p.tiles[TILE_INDEX_DRAWDOWN_PEAK] = peak;
      p.tiles[TILE_INDEX_DRAWDOWN_TROUGH] = t;
    }

    const tr = _bigint(troops);
    if (p.peakTroops === undefined || tr > p.peakTroops) p.peakTroops = tr;

    this._maxAlliance(player, ALLIANCE_INDEX_PEAK_CONCURRENT, allianceCount);
  }

  recordKilledBy(victim: Player, killerClientID: ClientID | null): void {
    const p = this._makePlayerStats(victim);
    if (p === undefined) return;
    // First write wins; `undefined` means unstamped, and `null` is a valid
    // recorded value (eliminated by a non-client killer).
    if (p.killedBy === undefined) p.killedBy = killerClientID;
  }

  recordDeathPosition(victim: Player, position: number): void {
    const p = this._makePlayerStats(victim);
    if (p === undefined) return;
    p.deathPosition ??= position; // first write wins
  }

  recordKill(player: Player, victim: Player, tick: BigIntLike): void {
    if (victim.type() !== PlayerType.Human) return;
    const victimId = victim.clientID();
    if (victimId === null) return;
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.kills ??= [];
    p.kills.push({ victim: victimId, tick: _bigint(tick) });
  }

  trainSelfTrade(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_TRAIN_SELF, gold);
  }

  trainExternalTrade(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_TRAIN_OTHER, gold);
  }

  lobbyFillTime(fillTimeMs: number): void {}
}

export const StatsSnapshot = snapshotType({
  name: "Stats",
  version: 1,
  schema: z.object({
    // Stored as the live AllPlayersStats tree (bigints and all). Its shape is
    // versioned by StatsSchemas, which game records already keep readable.
    data: z.record(z.string(), z.unknown()),
  }),
});
export type StatsState = z.infer<typeof StatsSnapshot.schema>;
