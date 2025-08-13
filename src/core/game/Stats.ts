import { AllPlayersStats } from "../Schemas";
import { NukeType, OtherUnitType, PlayerStats } from "../StatsSchemas";
import { Player, TerraNullius } from "./Game";

export type Stats = {
  getPlayerStats(player: Player): PlayerStats | null;
  stats(): AllPlayersStats;

  // Player broadcasts an emoji to all players
  actionBroadcastEmoji(player: Player): void;

  // Player sends an emoji to another player
  actionSendEmoji(player: Player, target: Player): void;

  // Player sends gold to another player
  actionSendGold(player: Player, target: Player, gold: number | bigint): void;

  // Player sends a quick chat to another player
  actionSendQuickChat(player: Player, target: Player): void;

  // Player targets another player
  actionSendTarget(player: Player, target: Player): void;

  // Player sends troops to another player
  actionSendTroops(
    player: Player,
    target: Player,
    troops: number | bigint,
  ): void;

  // Player attacks target
  attack(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player cancels attack on target
  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player betrays another player
  betray(player: Player): void;

  // Player sends a trade ship to target
  boatSendTrade(player: Player, target: Player): void;

  // Player's trade ship arrives at target, both players earn gold
  boatArriveTrade(player: Player, target: Player, gold: number | bigint): void;

  // Player's trade ship, captured from target, arrives. Player earns gold.
  boatCapturedTrade(
    player: Player,
    target: Player,
    gold: number | bigint,
  ): void;

  // Player destroys target's trade ship
  boatDestroyTrade(player: Player, target: Player): void;

  // Player sends a transport ship to target with troops
  boatSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player's transport ship arrives at target with troops
  boatArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player destroys target's transport ship with troops
  boatDestroyTroops(
    player: Player,
    target: Player,
    troops: number | bigint,
  ): void;

  // Player launches bomb at target
  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void;

  // Player's bomb lands at target
  bombLand(player: Player, target: Player | TerraNullius, type: NukeType): void;

  // Player's SAM intercepts a bomb from attacker
  bombIntercept(player: Player, type: NukeType, count: number | bigint): void;

  // Player conquers a bot, nation, or player
  conquer(
    player: Player,
    target: Player,
    method?: "elimination" | "encirclement",
  ): void;

  // Player earns gold from conquering tiles or trade ships from captured
  goldWar(player: Player, captured: Player, gold: number | bigint): void;

  // Player earns gold from workers
  goldWork(player: Player, gold: number | bigint): void;

  // Player builds a unit of type
  unitBuild(player: Player, type: OtherUnitType): void;

  // Player captures a unit of type
  unitCapture(player: Player, type: OtherUnitType): void;

  // Player upgrades a unit of type
  unitUpgrade(player: Player, type: OtherUnitType): void;

  // Player destroys a unit of type
  unitDestroy(player: Player, type: OtherUnitType): void;

  // Player loses a unit of type
  unitLose(player: Player, type: OtherUnitType): void;
};
