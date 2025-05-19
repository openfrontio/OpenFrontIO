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
  BuiltDestroyedCapturedLost,
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
import { Player, TerraNullius, UnitType } from "./Game";
import { Stats } from "./Stats";

export class StatsImpl implements Stats {
  private readonly data: AllPlayersStats = {};

  getPlayerStats(sender: Player): PlayerStats | null {
    const clientID = sender.clientID();
    if (clientID === null) return null;
    if (clientID in this.data) {
      return this.data[clientID];
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
    this.data[clientID] = data;
    return data;
  }

  stats() {
    return this.data;
  }

  attack(
    outgoing: Player,
    incoming: Player | TerraNullius,
    troops: number,
  ): void {
    const o = this.getPlayerStats(outgoing);
    if (o !== null) {
      o.attacks[ATTACK_INDEX_OUTGOING] += troops;
    }
    const i = incoming.isPlayer() ? this.getPlayerStats(incoming) : null;
    if (i !== null) {
      i.attacks[ATTACK_INDEX_INCOMING] += troops;
    }
  }

  attackCancel(
    outgoing: Player,
    incoming: Player | TerraNullius,
    troops: number,
  ): void {
    const o = this.getPlayerStats(outgoing);
    if (o !== null) {
      o.attacks[ATTACK_INDEX_CANCELLED] += troops;
      o.attacks[ATTACK_INDEX_OUTGOING] -= troops;
    }
    const i = incoming.isPlayer() ? this.getPlayerStats(incoming) : null;
    if (i !== null) {
      i.attacks[ATTACK_INDEX_INCOMING] -= troops;
    }
  }

  betray(player: Player): void {
    const p = this.getPlayerStats(player);
    if (p !== null) {
      p.betrayals++;
    }
  }

  boatSendTrade(player: Player, target: Player | null): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const boats = data.boats.trade;
      if (boats === undefined) throw new Error();
      boats[BOAT_INDEX_SENT]++;
    }
  }

  boatArriveTrade(player: Player, target: Player, gold: number): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      data.gold[GOLD_INDEX_TRADE] += gold;
      const boats = data.boats.trade;
      if (boats === undefined) throw new Error();
      boats[BOAT_INDEX_ARRIVED]++;
    }
    const odat = this.getPlayerStats(target);
    if (odat !== null) {
      odat.gold[GOLD_INDEX_TRADE] += gold;
    }
  }

  boatDestroyTrade(player: Player, target: Player): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const boats = data.boats.trade;
      if (boats === undefined) throw new Error();
      boats[BOAT_INDEX_DESTROYED]++;
    }
  }

  boatSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number,
  ): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const boats = data.boats.trans;
      if (boats === undefined) throw new Error();
      boats[BOAT_INDEX_SENT]++;
    }
  }

  boatArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number,
  ): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const boats = data.boats.trans;
      if (boats === undefined) throw new Error();
      boats[BOAT_INDEX_ARRIVED]++;
    }
  }

  boatDestroyTroops(player: Player, target: Player, troops: number): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const boats = data.boats.trans;
      if (boats === undefined) throw new Error();
      boats[BOAT_INDEX_DESTROYED]++;
    }
  }

  private _getBomb(
    data: PlayerStats,
    type: NukeType,
  ): LaunchedLandedIntercepted | undefined {
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

  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const bomb = this._getBomb(data, type);
      if (bomb === undefined) throw new Error();
      bomb[BOMB_INDEX_LAUNCHED]++;
    }
  }

  bombLand(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const bomb = this._getBomb(data, type);
      if (bomb === undefined) throw new Error();
      bomb[BOMB_INDEX_LANDED]++;
    }
  }

  bombIntercept(player: Player, target: Player, type: NukeType): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const bomb = this._getBomb(data, type);
      if (bomb === undefined) throw new Error();
      bomb[BOMB_INDEX_INTERCEPTED]++;
    }
  }

  goldWork(player: Player, gold: number): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      data.gold[GOLD_INDEX_WORK] += gold;
    }
  }

  goldWar(player: Player, captured: Player, gold: number): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      data.gold[GOLD_INDEX_WAR] += gold;
    }
  }

  private _getOtherUnit(
    data: PlayerStats,
    type: OtherUnit,
  ): BuiltDestroyedCapturedLost | undefined {
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

  unitBuild(player: Player, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const unit = this._getOtherUnit(data, type);
      if (unit === undefined) throw new Error();
      unit[OTHER_INDEX_BUILT]++;
    }
  }

  unitCapture(player: Player, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const unit = this._getOtherUnit(data, type);
      if (unit === undefined) throw new Error();
      unit[OTHER_INDEX_CAPTURED]++;
    }
  }

  unitDestroy(player: Player, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const unit = this._getOtherUnit(data, type);
      if (unit === undefined) throw new Error();
      unit[OTHER_INDEX_DESTROYED]++;
    }
  }

  unitLose(player: Player, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    if (data !== null) {
      const unit = this._getOtherUnit(data, type);
      if (unit === undefined) throw new Error();
      unit[OTHER_INDEX_LOST]++;
    }
  }
}
