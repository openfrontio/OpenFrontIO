import { AllPlayersStats, ClientID } from "../Schemas";
import {
  BoatUnitType,
  NukeType,
  OtherUnitType,
  PlayerStats,
} from "../StatsSchemas";
import { Player, TerraNullius } from "./Game";

export interface Stats {
  getPlayerStats(player: Player): PlayerStats | null;
  stats(): AllPlayersStats;

  numMirvsLaunched(): bigint;

  // Player attacks target
  attack(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // An attack of this size is now bearing down on target, after any
  // cancelling-out and merging with the attacker's other attacks. Separate
  // from attack() because that one is called per click, before the merge.
  attackMaxIncoming(
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

  // Player entered an alliance. Called for BOTH parties.
  allianceFormed(player: Player): void;

  // An alliance this player was in ended, after `durationTicks`. `counter`
  // selects which tally to bump: the betrayed party passes "brokenByOther",
  // a timeout passes "expired" for both parties, and the BREAKER passes null
  // -- their side is already counted by betray(). All three update the
  // longest-held maximum, which is why the breaker still calls this.
  allianceEnded(
    player: Player,
    durationTicks: number | bigint,
    counter: "brokenByOther" | "expired" | null,
  ): void;

  // Time between lobby creation and game start (ms)
  lobbyFillTime(fillTimeMs: number): void;

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

  // Player takes ownership of target's transport ship, by conquering them or
  // by inheriting from a disconnected teammate. Unlike a trade ship, which is
  // captured by hunting it down, this one changes hands with its owner.
  boatCapturedTroops(player: Player, target: Player): void;

  // Player's boat was destroyed. Counts every destruction, including ones no
  // one is credited with (the owner's own nuke, the owner being eliminated),
  // so it is not the mirror of boatDestroyTrade/boatDestroyTroops.
  boatLose(player: Player, type: BoatUnitType): void;

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

  // player was killed (0 tiles)
  playerKilled(player: Player, tick: number): void;

  // OFM live standings: who eliminated the player (null = non-client killer) and
  // their finishing place. Both first-write-wins.
  recordKilledBy(victim: Player, killerClientID: ClientID | null): void;
  recordDeathPosition(victim: Player, position: number): void;

  // Record tiles owned at game end (final standings).
  recordFinalTiles(player: Player, tiles: number | bigint): void;

  // Alliances still standing when the game ended. Called for every player
  // from GameImpl.setWinner, beside recordFinalTiles.
  recordAlliancesAtEnd(
    player: Player,
    stillStanding: number,
    longestStandingTicks: number | bigint,
  ): void;

  // Per-player, per-tick sample of state that only has a high-water value.
  // Called once per living, spawned player per tick from
  // GameImpl.executeNextTick(). Values are passed in rather than read off the
  // player, matching recordFinalTiles: Stats is a sink, not a reader.
  recordTickSample(
    player: Player,
    tiles: number | bigint,
    troops: number | bigint,
    allianceCount: number,
  ): void;

  // Record that player eliminated human victim at tick (OFM kill scoring).
  recordKill(player: Player, victim: Player, tick: number | bigint): void;

  // Player's train arrives at any station, generating gold
  trainSelfTrade(player: Player, gold: number | bigint): void;

  // Another player's train arrives at own station
  trainExternalTrade(player: Player, goldPlayer: number | bigint): void;
}
