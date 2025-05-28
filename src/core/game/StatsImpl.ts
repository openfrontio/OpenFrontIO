import { AllPlayersStats } from "../Schemas";
import {
  ATTACK_INDEX_CANCEL,
  ATTACK_INDEX_RECV,
  ATTACK_INDEX_SENT,
  BOAT_INDEX_ARRIVE,
  BOAT_INDEX_CAPTURE,
  BOAT_INDEX_DESTROY,
  BOAT_INDEX_SENT,
  BoatUnit,
  BOMB_INDEX_INTERCEPT,
  BOMB_INDEX_LAND,
  BOMB_INDEX_LAUNCH,
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
  NukeType,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_CAPTURE,
  OTHER_INDEX_DESTROY,
  OTHER_INDEX_LOST,
  OtherUnitType,
  PlayerStats,
  unitTypeToBombUnit,
  unitTypeToOtherUnit,
} from "../StatsSchemas";
import { Player, TerraNullius } from "./Game";
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

export class StatsImpl implements Stats {
  private readonly data: AllPlayersStats = {};

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
    if (p.attacks === undefined) p.attacks = [0n];
    while (p.attacks.length <= index) p.attacks.push(0n);
    p.attacks[index] += _bigint(value);
  }

  private _addBetrayal(player: Player, value: BigIntLike) {
    const data = this._makePlayerStats(player);
    if (data === undefined) return;
    if (data.betrayals === undefined) {
      data.betrayals = _bigint(value);
    } else {
      data.betrayals += _bigint(value);
    }
  }

  private _addBoat(
    player: Player,
    type: BoatUnit,
    index: number,
    value: BigIntLike,
  ) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    if (p.boats === undefined) p.boats = { [type]: [0n] };
    if (p.boats[type] === undefined) p.boats[type] = [0n];
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
    if (p.bombs === undefined) p.bombs = { [type]: [0n] };
    if (p.bombs[type] === undefined) p.bombs[type] = [0n];
    while (p.bombs[type].length <= index) p.bombs[type].push(0n);
    p.bombs[type][index] += _bigint(value);
  }

  private _addGold(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    if (p.gold === undefined) p.gold = [0n];
    while (p.gold.length <= index) p.gold.push(0n);
    p.gold[index] += _bigint(value);
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
    if (p.units === undefined) p.units = { [type]: [0n] };
    if (p.units[type] === undefined) p.units[type] = [0n];
    while (p.units[type].length <= index) p.units[type].push(0n);
    p.units[type][index] += _bigint(value);
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

  bombIntercept(player: Player, attacker: Player, type: NukeType): void {
    this._addBomb(player, type, BOMB_INDEX_INTERCEPT, 1);
  }

  goldWork(player: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_WORK, gold);
  }

  goldWar(player: Player, captured: Player, gold: BigIntLike): void {
    this._addGold(player, GOLD_INDEX_WAR, gold);
  }

  unitBuild(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_BUILT, 1);
  }

  unitCapture(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_CAPTURE, 1);
  }

  unitDestroy(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_DESTROY, 1);
  }

  unitLose(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_LOST, 1);
  }
}
