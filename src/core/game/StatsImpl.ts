import {
  ATTACK_INDEX_CANCELLED,
  ATTACK_INDEX_INCOMING,
  ATTACK_INDEX_OUTGOING,
  BOAT_INDEX_ARRIVED,
  BOAT_INDEX_DESTROYED,
  BOAT_INDEX_SENT,
  BOMB_INDEX_INTERCEPTED,
  BOMB_INDEX_LANDED,
  BOMB_INDEX_LAUNCHED,
  BuiltLostDestroyedCaptured,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
  LaunchedLandedIntercepted,
  NukeType,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_CAPTURED,
  OTHER_INDEX_DESTROYED,
  OTHER_INDEX_LOST,
  OtherUnit,
} from "../AnalyticsSchemas";
import { AllPlayersStats, PlayerStats } from "../Schemas";
import { PlayerID, UnitType } from "./Game";
import { Stats } from "./Stats";

export class StatsImpl implements Stats {
  private readonly data: AllPlayersStats = {};

  getPlayerStats(sender: PlayerID): PlayerStats {
    if (sender in this.data) {
      return this.data[sender];
    }
    const data = {
      betrayals: 0,
      boats: {
        trade: [0, 0, 0],
        trans: [0, 0, 0],
      },
      bombs: {
        abomb: [0, 0, 0],
        hbomb: [0, 0, 0],
        mirvw: [0, 0, 0],
        mirv: [0, 0, 0],
      },
      units: {
        city: [0, 0, 0, 0],
        defp: [0, 0, 0, 0],
        port: [0, 0, 0, 0],
        wshp: [0, 0, 0, 0],
        silo: [0, 0, 0, 0],
        saml: [0, 0, 0, 0],
      },
      attacks: [0, 0, 0],
      gold: [0, 0, 0],
    } satisfies PlayerStats;
    this.data[sender] = data;
    return data;
  }

  stats() {
    return this.data;
  }

  attack(outgoing: PlayerID, incoming: PlayerID | null, troops: number): void {
    const o = this.getPlayerStats(outgoing);
    o.attacks[ATTACK_INDEX_OUTGOING] += troops;
    if (incoming === null) return;
    const i = this.getPlayerStats(incoming);
    i.attacks[ATTACK_INDEX_INCOMING] += troops;
  }

  attackCancel(
    outgoing: PlayerID,
    incoming: PlayerID | null,
    troops: number,
  ): void {
    const o = this.getPlayerStats(outgoing);
    o.attacks[ATTACK_INDEX_CANCELLED] += troops;
    o.attacks[ATTACK_INDEX_OUTGOING] -= troops;
    if (incoming === null) return;
    const i = this.getPlayerStats(incoming);
    i.attacks[ATTACK_INDEX_INCOMING] -= troops;
  }

  betray(player: PlayerID): void {
    this.getPlayerStats(player).betrayals++;
  }

  boatSendTrade(player: PlayerID, target: PlayerID | null): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats.trade;
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_SENT]++;
  }

  boatArriveTrade(player: PlayerID, target: PlayerID, gold: number): void {
    const data = this.getPlayerStats(player);
    const odat = this.getPlayerStats(target);
    data.gold[GOLD_INDEX_TRADE] += gold;
    odat.gold[GOLD_INDEX_TRADE] += gold;
    const boats = data.boats.trade;
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_ARRIVED]++;
  }

  boatDestroyTrade(player: PlayerID, target: PlayerID): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats.trade;
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_DESTROYED]++;
  }

  boatSendTroops(
    player: PlayerID,
    target: PlayerID | null,
    troops: number,
  ): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats.trans;
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_SENT]++;
  }

  boatArriveTroops(
    player: PlayerID,
    target: PlayerID | null,
    troops: number,
  ): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats.trans;
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_ARRIVED]++;
  }

  boatDestroyTroops(player: PlayerID, target: PlayerID, troops: number): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats.trans;
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_DESTROYED]++;
  }

  private _getBomb(
    player: PlayerID,
    type: NukeType,
  ): LaunchedLandedIntercepted | undefined {
    const data = this.getPlayerStats(player);
    switch (type) {
      case UnitType.AtomBomb:
        return data.bombs.abomb;
      case UnitType.HydrogenBomb:
        return data.bombs.hbomb;
      case UnitType.MIRV:
        return data.bombs.mirv;
      case UnitType.MIRVWarhead:
        return data.bombs.mirvw;
    }
    throw new Error(`Unknown NukeType ${type}`);
  }

  bombLaunch(player: PlayerID, target: PlayerID | null, type: NukeType): void {
    const bomb = this._getBomb(player, type);
    if (bomb === undefined) throw new Error();
    bomb[BOMB_INDEX_LAUNCHED]++;
  }

  bombLand(player: PlayerID, target: PlayerID | null, type: NukeType): void {
    const bomb = this._getBomb(player, type);
    if (bomb === undefined) throw new Error();
    bomb[BOMB_INDEX_LANDED]++;
  }

  bombIntercept(player: PlayerID, target: PlayerID, type: NukeType): void {
    const bomb = this._getBomb(player, type);
    if (bomb === undefined) throw new Error();
    bomb[BOMB_INDEX_INTERCEPTED]++;
  }

  goldWork(player: PlayerID, gold: number): void {
    const data = this.getPlayerStats(player);
    data.gold[GOLD_INDEX_WORK] += gold;
  }

  goldWar(player: PlayerID, captured: PlayerID, gold: number): void {
    const data = this.getPlayerStats(player);
    data.gold[GOLD_INDEX_WAR] += gold;
  }

  private _getOtherUnit(
    player: PlayerID,
    type: OtherUnit,
  ): BuiltLostDestroyedCaptured | undefined {
    const data = this.getPlayerStats(player);
    switch (type) {
      case UnitType.City:
        return data.units.city;
      case UnitType.DefensePost:
        return data.units.defp;
      case UnitType.MissileSilo:
        return data.units.silo;
      case UnitType.Port:
        return data.units.port;
      case UnitType.SAMLauncher:
        return data.units.saml;
      case UnitType.Warship:
        return data.units.wshp;
    }
    throw new Error(`Unknown OtherUnit ${type}`);
  }

  unitBuild(player: PlayerID, type: OtherUnit): void {
    const unit = this._getOtherUnit(player, type);
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_BUILT]++;
  }

  unitCapture(player: PlayerID, type: OtherUnit): void {
    const unit = this._getOtherUnit(player, type);
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_CAPTURED]++;
  }

  unitDestroy(player: PlayerID, type: OtherUnit): void {
    const unit = this._getOtherUnit(player, type);
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_DESTROYED]++;
  }

  unitLose(player: PlayerID, type: OtherUnit): void {
    const unit = this._getOtherUnit(player, type);
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_LOST]++;
  }
}
