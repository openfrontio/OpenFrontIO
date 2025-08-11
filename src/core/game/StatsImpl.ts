import { AllPlayersStats } from "../Schemas";
import {
  Action,
  ACTION_INDEX_BROADCAST,
  ACTION_INDEX_RECV,
  ACTION_INDEX_SENT,
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
  CONQUER_INDEX_ELIMINATION,
  CONQUER_INDEX_ENCIRCLEMENT,
  ConqueredPlayerType,
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
  NukeType,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_CAPTURE,
  OTHER_INDEX_DESTROY,
  OTHER_INDEX_LOST,
  OTHER_INDEX_UPGRADE,
  OtherUnitType,
  PlayerStats,
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

  private _addAction(
    player: Player,
    action: Action,
    index: number,
    value: BigIntLike,
  ) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.actions ??= {};
    p.actions[action] ??= action === "emoji" ? [0n, 0n, 0n] : [0n, 0n];
    while (p.actions[action].length <= index) p.actions[action].push(0n);
    p.actions[action][index] += _bigint(value);
  }

  private _addAttack(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.attacks ??= [0n];
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

  private _addConquer(
    player: Player,
    playerType: ConqueredPlayerType,
    index: number,
  ) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.conquered ??= {};
    p.conquered[playerType] ??= [0n, 0n];
    while (p.conquered[playerType].length <= index)
      p.conquered[playerType].push(0n);
    p.conquered[playerType][index] += 1n;
  }

  private _addGold(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.gold ??= [0n];
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
    p.units ??= { [type]: [0n] };
    p.units[type] ??= [0n];
    while (p.units[type].length <= index) p.units[type].push(0n);
    p.units[type][index] += _bigint(value);
  }

  actionBroadcastEmoji(player: Player): void {
    this._addAction(player, "emoji", ACTION_INDEX_BROADCAST, 1);
  }

  actionSendEmoji(player: Player, target: Player): void {
    this._addAction(player, "emoji", ACTION_INDEX_SENT, 1);
    this._addAction(target, "emoji", ACTION_INDEX_RECV, 1);
  }

  actionSendGold(player: Player, target: Player, gold: BigIntLike): void {
    this._addAction(player, "gold", ACTION_INDEX_SENT, gold);
    this._addAction(target, "gold", ACTION_INDEX_RECV, gold);
  }

  actionSendQuickChat(player: Player, target: Player): void {
    this._addAction(player, "quickchat", ACTION_INDEX_SENT, 1);
    this._addAction(target, "quickchat", ACTION_INDEX_RECV, 1);
  }

  actionSendTarget(player: Player, target: Player): void {
    this._addAction(player, "target", ACTION_INDEX_SENT, 1);
    this._addAction(target, "target", ACTION_INDEX_RECV, 1);
  }

  actionSendTroops(player: Player, target: Player, troops: BigIntLike): void {
    this._addAction(player, "troops", ACTION_INDEX_SENT, troops);
    this._addAction(target, "troops", ACTION_INDEX_RECV, troops);
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

  bombIntercept(player: Player, type: NukeType, count: BigIntLike): void {
    this._addBomb(player, type, BOMB_INDEX_INTERCEPT, count);
  }

  conquer(
    player: Player,
    target: Player,
    method: "elimination" | "encirclement" = "elimination",
  ): void {
    const playerType: ConqueredPlayerType =
      target.type() === PlayerType.Bot
        ? "bot"
        : target.type() === PlayerType.FakeHuman
          ? "nation"
          : "human";

    const methodIndex =
      method === "elimination"
        ? CONQUER_INDEX_ELIMINATION
        : CONQUER_INDEX_ENCIRCLEMENT;
    this._addConquer(player, playerType, methodIndex);
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

  unitUpgrade(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_UPGRADE, 1);
  }

  unitDestroy(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_DESTROY, 1);
  }

  unitLose(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_LOST, 1);
  }
}
