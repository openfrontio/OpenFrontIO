import {
  ATTACK_INDEX_CANCELLED,
  ATTACK_INDEX_INCOMING,
  ATTACK_INDEX_OUTGOING,
  BOAT_INDEX_ARRIVED,
  BOAT_INDEX_DESTROYED,
  BOAT_INDEX_SENT,
  BoatType,
  BOMB_INDEX_INTERCEPTED,
  BOMB_INDEX_LANDED,
  BOMB_INDEX_LAUNCHED,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
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
  data: AllPlayersStats = {};

  getPlayerStats(sender: PlayerID): PlayerStats {
    if (sender in this.data) {
      return this.data[sender];
    }
    const data = {
      betrayals: 0,
      boats: {
        [UnitType.TransportShip]: [0, 0, 0],
        [UnitType.TradeShip]: [0, 0, 0],
      },
      bombs: {
        [UnitType.AtomBomb]: [0, 0, 0],
        [UnitType.HydrogenBomb]: [0, 0, 0],
        [UnitType.MIRVWarhead]: [0, 0, 0],
        [UnitType.MIRV]: [0, 0, 0],
      },
      units: {
        [UnitType.City]: [0, 0, 0, 0],
        [UnitType.DefensePost]: [0, 0, 0, 0],
        [UnitType.Port]: [0, 0, 0, 0],
        [UnitType.Warship]: [0, 0, 0, 0],
        [UnitType.MissileSilo]: [0, 0, 0, 0],
        [UnitType.SAMLauncher]: [0, 0, 0, 0],
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

  attack(outgoing: PlayerID, incoming: PlayerID, troops: number): void {
    const o = this.getPlayerStats(outgoing);
    const i = this.getPlayerStats(incoming);
    o.attacks[ATTACK_INDEX_OUTGOING] += troops;
    i.attacks[ATTACK_INDEX_INCOMING] += troops;
  }

  attackCancel(outgoing: PlayerID, incoming: PlayerID, troops: number): void {
    const o = this.getPlayerStats(outgoing);
    const i = this.getPlayerStats(incoming);
    o.attacks[ATTACK_INDEX_CANCELLED] += troops;
    o.attacks[ATTACK_INDEX_OUTGOING] -= troops;
    i.attacks[ATTACK_INDEX_INCOMING] -= troops;
  }

  betray(player: PlayerID): void {
    this.getPlayerStats(player).betrayals++;
  }

  boatSend(player: PlayerID, type: BoatType): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats[type];
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_SENT]++;
  }

  boatArrive(player: PlayerID, type: BoatType): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats[type];
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_ARRIVED]++;
  }

  boatDestroy(player: PlayerID, type: BoatType): void {
    const data = this.getPlayerStats(player);
    const boats = data.boats[type];
    if (boats === undefined) throw new Error();
    boats[BOAT_INDEX_DESTROYED]++;
  }

  bombLaunch(player: PlayerID, target: PlayerID | null, type: NukeType): void {
    const data = this.getPlayerStats(player);
    const bomb = data.bombs[type];
    if (bomb === undefined) throw new Error();
    bomb[BOMB_INDEX_LAUNCHED]++;
  }

  bombLand(player: PlayerID, target: PlayerID | null, type: NukeType): void {
    const data = this.getPlayerStats(player);
    const bomb = data.bombs[type];
    if (bomb === undefined) throw new Error();
    bomb[BOMB_INDEX_LANDED]++;
  }

  bombIntercept(
    player: PlayerID,
    target: PlayerID | null,
    type: NukeType,
  ): void {
    const data = this.getPlayerStats(player);
    const bomb = data.bombs[type];
    if (bomb === undefined) throw new Error();
    bomb[BOMB_INDEX_INTERCEPTED]++;
  }

  goldWork(player: PlayerID, gold: number): void {
    const data = this.getPlayerStats(player);
    data.gold[GOLD_INDEX_WORK] += gold;
  }

  goldTrade(player: PlayerID, gold: number): void {
    const data = this.getPlayerStats(player);
    data.gold[GOLD_INDEX_TRADE] += gold;
  }

  goldWar(player: PlayerID, gold: number): void {
    const data = this.getPlayerStats(player);
    data.gold[GOLD_INDEX_WAR] += gold;
  }

  unitBuild(player: PlayerID, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    const unit = data.units[type];
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_BUILT]++;
  }

  unitLose(player: PlayerID, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    const unit = data.units[type];
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_LOST]++;
  }

  unitDestroy(player: PlayerID, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    const unit = data.units[type];
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_DESTROYED]++;
  }

  unitCapture(player: PlayerID, type: OtherUnit): void {
    const data = this.getPlayerStats(player);
    const unit = data.units[type];
    if (unit === undefined) throw new Error();
    unit[OTHER_INDEX_CAPTURED]++;
  }
}
