import { z } from "zod";
import {
  AllPlayers,
  Difficulty,
  Game,
  Gold,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zRef,
} from "../../snapshot/SnapshotType";
import { assertNever } from "../../Util";
import { ConstructionExecution } from "../ConstructionExecution";
import {
  EMOJI_WARSHIP_RETALIATION,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";

export class NationWarshipBehavior {
  // Track our transport ships we currently own
  private trackedTransportShips: Set<Unit> = new Set();
  // Track our trade ships we currently own
  private trackedTradeShips: Set<Unit> = new Set();
  // Track incoming transport ships
  private trackedIncomingTransportShips: Set<Unit> = new Set();
  // Track incoming transport ships we have dealt with
  private dealtWithTransportShip: Set<Unit> = new Set();

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  snapshot(w: SnapshotWriter): Versioned {
    // Sets are iterated in order and may hold dead units.
    const units = (set: Set<Unit>) => [...set].map((u) => w.unit(u));
    return w.versioned(NationWarshipBehaviorSnapshot, {
      trackedTransportShips: units(this.trackedTransportShips),
      trackedTradeShips: units(this.trackedTradeShips),
      trackedIncomingTransportShips: units(this.trackedIncomingTransportShips),
      dealtWithTransportShip: units(this.dealtWithTransportShip),
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
    emojiBehavior: NationEmojiBehavior,
  ): void {
    const s = readVersioned(NationWarshipBehaviorSnapshot, raw);
    const units = (refs: number[]) => new Set(refs.map((i) => r.unit(i)));
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.emojiBehavior = emojiBehavior;
    this.trackedTransportShips = units(s.trackedTransportShips);
    this.trackedTradeShips = units(s.trackedTradeShips);
    this.trackedIncomingTransportShips = units(s.trackedIncomingTransportShips);
    this.dealtWithTransportShip = units(s.dealtWithTransportShip);
  }

  maybeSpawnWarship(): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (this.game.config().isUnitDisabled(UnitType.Warship)) {
      return false;
    }
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() > this.cost(UnitType.Warship)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile(), 250);
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        return false;
      }
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, targetTile),
      );
      return true;
    }
    return false;
  }

  private warshipSpawnTile(portTile: TileRef, radius: number): TileRef | null {
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.game.x(portTile) - radius,
        this.game.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.game.y(portTile) - radius,
        this.game.y(portTile) + radius,
      );
      if (!this.game.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.game.ref(randX, randY);
      // Sanity check
      if (!this.game.isWater(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  trackShipsAndRetaliate(): void {
    this.trackTransportShipsAndRetaliate();
    this.trackTradeShipsAndRetaliate();
    this.trackIncomingTransportsAndRetaliate();
  }

  // Send out a warship if our transport ship got captured
  private trackTransportShipsAndRetaliate(): void {
    if (this.game.config().isUnitDisabled(UnitType.TransportShip)) {
      return;
    }
    // Add any currently owned transport ships to our tracking set
    this.player
      .units(UnitType.TransportShip)
      .forEach((u) => this.trackedTransportShips.add(u));

    // Iterate tracked transport ships; if it got destroyed by an enemy:
    // retaliate. Deleting the current entry while iterating a Set is safe.
    for (const ship of this.trackedTransportShips) {
      if (!ship.isActive()) {
        // Distinguish between arrival/retreat and enemy destruction
        if (ship.wasDestroyedByEnemy() && ship.destroyer() !== undefined) {
          this.maybeRetaliateWithWarship(
            ship.tile(),
            ship.destroyer()!,
            "transport",
          );
        }
        this.trackedTransportShips.delete(ship);
      }
    }
  }

  // Send out a warship if our trade ship got captured
  private trackTradeShipsAndRetaliate(): void {
    // Add any currently owned trade ships to our tracking map
    this.player
      .units(UnitType.TradeShip)
      .forEach((u) => this.trackedTradeShips.add(u));

    // Iterate tracked trade ships; if we no longer own it, it was captured:
    // retaliate. Deleting the current entry while iterating a Set is safe.
    for (const ship of this.trackedTradeShips) {
      if (!ship.isActive()) {
        this.trackedTradeShips.delete(ship);
        continue;
      }
      if (ship.owner().id() !== this.player.id()) {
        // Ship was ours and is now owned by someone else -> captured
        this.maybeRetaliateWithWarship(ship.tile(), ship.owner(), "trade");
        this.trackedTradeShips.delete(ship);
      }
    }
  }

  private trackIncomingTransportsAndRetaliate(): void {
    // Add any transports which are targeting us to our tracking map
    for (const p of this.game.units(UnitType.TransportShip)) {
      const target = p.targetTile();
      if (
        target &&
        p.isActive() &&
        !p.transportShipState().isRetreating &&
        this.game.ownerID(target) === this.player?.smallID() &&
        p.owner().smallID() !== this.player?.smallID()
      ) {
        this.trackedIncomingTransportShips.add(p);
      }
    }

    // Deleting the current entry while iterating a Set is safe.
    for (const transport of this.trackedIncomingTransportShips) {
      const target = transport.targetTile();
      if (
        !transport.isActive() ||
        target === undefined ||
        transport.transportShipState().isRetreating
      ) {
        this.trackedIncomingTransportShips.delete(transport);
        this.dealtWithTransportShip.delete(transport);
        continue;
      }
      // Transport has already been dealt with
      if (this.dealtWithTransportShip.has(transport)) {
        continue;
      }

      const distanceToTarget = this.game.manhattanDist(
        transport.tile(),
        target,
      );
      // Too close to deal with
      if (distanceToTarget < 20) {
        this.dealtWithTransportShip.add(transport);
        continue;
      }

      // Possible dock snipe counter? Too niche?
      if (!transport.owner().isAlliedWith(this.player)) {
        if (
          this.game.hasUnitNearby(
            target,
            90,
            UnitType.Warship,
            this.player.id(),
            true,
          ) ||
          this.player.units(UnitType.Warship).filter((p) => {
            const patrolTile = p.warshipState().patrolTile;
            return (
              patrolTile !== undefined &&
              this.game.manhattanDist(target, patrolTile) < 90
            );
          }).length > 0
        ) {
          this.dealtWithTransportShip.add(transport);
          continue;
        }
        const oceanTiles = this.warshipSpawnTile(target, 30);
        if (oceanTiles === null) continue;
        this.maybeRetaliateWithWarship(
          oceanTiles,
          transport.owner(),
          "transport",
        );
        this.dealtWithTransportShip.add(transport);
        break;
      }
    }
  }

  private maybeRetaliateWithWarship(
    tile: TileRef,
    enemy: Player,
    reason: "trade" | "transport",
  ): void {
    // Don't retaliate against ourselves (e.g. own nuke destroyed own ship)
    if (enemy === this.player) {
      return;
    }

    // One of ours already patrols there (sent by any trigger): don't pile up more
    if (this.warshipsCovering(tile).length > 0) {
      return;
    }

    // Don't send too many warships
    if (this.player.units(UnitType.Warship).length >= 10) {
      this.maybeMoveWarship(tile);
      return;
    }

    const { difficulty } = this.game.config().gameConfig();
    // In Easy never retaliate. In Medium retaliate with 15% chance. Hard with 50%, Impossible with 80%.
    if (
      (difficulty === Difficulty.Medium && this.random.nextInt(0, 100) < 15) ||
      (difficulty === Difficulty.Hard && this.random.nextInt(0, 100) < 50) ||
      (difficulty === Difficulty.Impossible && this.random.nextInt(0, 100) < 80)
    ) {
      const canBuild = this.player.canBuild(UnitType.Warship, tile);
      if (canBuild === false) {
        this.maybeMoveWarship(tile);
        return;
      }
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, tile),
      );
      this.emojiBehavior.maybeSendEmoji(enemy, EMOJI_WARSHIP_RETALIATION);
      this.player.updateRelation(enemy, reason === "trade" ? -7.5 : -15);
    }
  }

  // Send a squad at the fleet blocking our boats, all at once or not at all:
  // Hard as many ships as they have, Impossible one more
  clearSeaLane(blocker: Unit): void {
    if (this.game.config().isUnitDisabled(UnitType.Warship)) return;
    const { difficulty } = this.game.config().gameConfig();
    const target = blocker.tile();
    const fleet = this.hostileWarshipsNear(target);
    let wanted: number;
    switch (difficulty) {
      case Difficulty.Easy:
      case Difficulty.Medium:
        return;
      case Difficulty.Hard:
        wanted = fleet;
        break;
      case Difficulty.Impossible:
        wanted = fleet + 1;
        break;
      default:
        assertNever(difficulty);
    }

    const covering = this.warshipsCovering(target);
    const component = this.game.getWaterComponent(target);
    // Ships with enemies around their patrol tile are busy; pulling them away would thrash
    const spare = this.player
      .units(UnitType.Warship)
      .filter((w) => {
        const state = w.warshipState();
        return (
          !covering.includes(w) &&
          state.state === "patrolling" &&
          this.game.getWaterComponent(w.tile()) === component &&
          (state.patrolTile === undefined ||
            this.hostileWarshipsNear(state.patrolTile) === 0)
        );
      })
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), target) -
          this.game.manhattanDist(b.tile(), target),
      );
    const recruits = spare.slice(0, Math.max(0, wanted - covering.length));
    const builds = wanted - covering.length - recruits.length;
    // Ships sent in one by one get sunk one by one
    if (builds > 0) {
      if (this.player.units(UnitType.Warship).length + builds > 10) return;
      if (this.player.gold() < this.cost(UnitType.Warship) * BigInt(builds)) {
        return;
      }
      if (this.player.canBuild(UnitType.Warship, target) === false) return;
    }
    for (const w of recruits) {
      w.updateWarshipState({ patrolTile: target });
    }
    for (let i = 0; i < builds; i++) {
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, target),
      );
    }
  }

  private hostileWarshipsNear(tile: TileRef): number {
    return this.game
      .nearbyUnits(
        tile,
        this.game.config().warshipTargettingRange(),
        UnitType.Warship,
      )
      .filter(({ unit }) => unit.owner().canAttackPlayer(this.player, true))
      .length;
  }

  // Our warships on the same water whose patrol area includes `tile`
  private warshipsCovering(tile: TileRef): Unit[] {
    const component = this.game.getWaterComponent(tile);
    const patrolRange = this.game.config().warshipPatrolRange();
    return this.player.units(UnitType.Warship).filter((w) => {
      const patrolTile = w.warshipState().patrolTile;
      return (
        patrolTile !== undefined &&
        this.game.getWaterComponent(w.tile()) === component &&
        this.game.manhattanDist(patrolTile, tile) <= patrolRange
      );
    });
  }

  private maybeMoveWarship(tile: TileRef): void {
    // Make sure we are targeting water
    if (this.game.isWater(tile)) {
      const warship = this.player
        .units(UnitType.Warship)
        .filter((p) => {
          const patrolTile = p.warshipState().patrolTile;
          return (
            patrolTile !== undefined &&
            // Dont send ships which are already traveling
            this.game.manhattanDist(p.tile(), patrolTile) < 130
          );
        })
        .sort((a, b) => {
          // Sort by distance (closest first)
          const distA = this.game.manhattanDist(a.tile(), tile);
          const distB = this.game.manhattanDist(b.tile(), tile);
          return distA - distB;
        })[0];

      if (warship) {
        warship.updateWarshipState({ patrolTile: tile });
      }
    }
  }

  // Prevent warship infestations: if current player is one of the 3 richest and an enemy has too many warships, send a counter-warship.
  // What is a warship infestation? A player tries to dominate the entire ocean to block all trade and transport boats.
  counterWarshipInfestation(): void {
    if (!this.shouldCounterWarshipInfestation()) {
      return;
    }

    const isTeamGame = this.player.team() !== null;

    if (!this.isRichPlayer(isTeamGame)) {
      return;
    }

    const target = this.findWarshipInfestationCounterTarget(isTeamGame);
    if (target !== null) {
      this.buildCounterWarship(target);
    }
  }

  private shouldCounterWarshipInfestation(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.Warship)) {
      return false;
    }

    // Only the smart nations can do this
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }

    // Quit early if there aren't many warships in the game
    if (this.game.unitCount(UnitType.Warship) <= 10) {
      return false;
    }

    // Quit early if we can't afford a warship
    if (this.cost(UnitType.Warship) > this.player.gold()) {
      return false;
    }

    // Quit early if we don't have a port to send warships from
    if (this.player.units(UnitType.Port).length === 0) {
      return false;
    }

    // Don't send too many warships
    if (this.player.units(UnitType.Warship).length >= 10) {
      return false;
    }

    return true;
  }

  // Check if current player is one of the 3 richest (We don't want poor nations to use their precious gold on this)
  private isRichPlayer(isTeamGame: boolean): boolean {
    const players = this.game.players().filter((p) => {
      if (p.type() === PlayerType.Human) return false;
      return isTeamGame ? p.team() === this.player.team() : true;
    });
    const topThree = players
      .sort((a, b) => Number(b.gold() - a.gold()))
      .slice(0, 3);
    return topThree.some((p) => p.id() === this.player.id());
  }

  private findWarshipInfestationCounterTarget(
    isTeamGame: boolean,
  ): { player: Player; warship: Unit } | null {
    return isTeamGame
      ? this.findTeamGameWarshipTarget()
      : this.findFreeForAllWarshipTarget();
  }

  private findTeamGameWarshipTarget(): {
    player: Player;
    warship: Unit;
  } | null {
    const enemyTeamWarships = new Map<
      string,
      { count: number; team: string; players: Player[] }
    >();

    for (const p of this.game.players()) {
      // Skip friendly players (our team and allies)
      if (this.player.isFriendly(p) || p.id() === this.player.id()) {
        continue;
      }

      const team = p.team();
      if (team === null) continue;

      const teamKey = team.toString();
      const warshipCount = p.units(UnitType.Warship).length;

      if (!enemyTeamWarships.has(teamKey)) {
        enemyTeamWarships.set(teamKey, {
          count: 0,
          team: teamKey,
          players: [],
        });
      }
      const teamData = enemyTeamWarships.get(teamKey)!;
      teamData.count += warshipCount;
      teamData.players.push(p);
    }

    // Find team with more than 15 warships
    for (const [, teamData] of enemyTeamWarships.entries()) {
      if (teamData.count > 15) {
        // Find player in that team with most warships
        const playerWithMostWarships = teamData.players.reduce(
          (max, p) => {
            const count = p.units(UnitType.Warship).length;
            const maxCount = max ? max.units(UnitType.Warship).length : 0;
            return count > maxCount ? p : max;
          },
          null as Player | null,
        );

        if (playerWithMostWarships) {
          const warships = playerWithMostWarships.units(UnitType.Warship);
          if (warships.length > 3) {
            return {
              player: playerWithMostWarships,
              warship: this.random.randElement(warships),
            };
          }
        }
      }
    }

    return null;
  }

  private findFreeForAllWarshipTarget(): {
    player: Player;
    warship: Unit;
  } | null {
    const enemies = this.game
      .players()
      .filter((p) => !this.player.isFriendly(p) && p.id() !== this.player.id());

    for (const enemy of enemies) {
      const enemyWarships = enemy.units(UnitType.Warship);
      if (enemyWarships.length > 10) {
        return {
          player: enemy,
          warship: this.random.randElement(enemyWarships),
        };
      }
    }

    return null;
  }

  private buildCounterWarship(target: { player: Player; warship: Unit }): void {
    const canBuild = this.player.canBuild(
      UnitType.Warship,
      target.warship.tile(),
    );
    if (canBuild === false) {
      this.maybeMoveWarship(target.warship.tile());
      return;
    }

    this.game.addExecution(
      new ConstructionExecution(
        this.player,
        UnitType.Warship,
        target.warship.tile(),
      ),
    );
    this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_WARSHIP_RETALIATION);
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}

export const NationWarshipBehaviorSnapshot = snapshotType({
  name: "NationWarshipBehavior",
  version: 1,
  schema: z.object({
    trackedTransportShips: z.array(zRef()),
    trackedTradeShips: z.array(zRef()),
    trackedIncomingTransportShips: z.array(zRef()),
    dealtWithTransportShip: z.array(zRef()),
  }),
});
