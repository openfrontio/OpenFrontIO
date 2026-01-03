import {
  Difficulty,
  Game,
  GameMode,
  Gold,
  Player,
  PlayerType,
  Relation,
  Tick,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef, euclDistFN } from "../../game/GameMap";
import { ParabolaPathFinder } from "../../pathfinding/PathFinding";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever, boundingBoxTiles } from "../../Util";
import { NukeExecution } from "../NukeExecution";
import { closestTwoTiles } from "../Util";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { EMOJI_NUKE, NationEmojiBehavior } from "./NationEmojiBehavior";
import { randTerritoryTileArray } from "./NationUtils";

export class NationNukeBehavior {
  private readonly recentlySentNukes: [
    Tick,
    TileRef,
    UnitType.AtomBomb | UnitType.HydrogenBomb,
  ][] = [];
  private atomBombsLaunched = 0;
  private atomBombPerceivedCost = this.cost(UnitType.AtomBomb);
  private hydrogenBombsLaunched = 0;
  private hydrogenBombPerceivedCost = this.cost(UnitType.HydrogenBomb);
  // Make 1/3 of nations "hydro-nations" that only throw hydrogen bombs (to reduce atom bomb spam)
  private readonly isHydroNation: boolean = this.random.chance(3);

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private attackBehavior: AiAttackBehavior,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  maybeSendNuke() {
    const nukeTarget = this.findBestNukeTarget();
    if (nukeTarget === null) {
      return;
    }

    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      nukeTarget.type() === PlayerType.Bot || // Don't nuke bots (as opposed to nations and humans)
      this.player.isOnSameTeam(nukeTarget) ||
      this.attackBehavior.shouldAttack(nukeTarget) === false
    ) {
      return;
    }

    const hydroCost = this.getPerceivedNukeCost(UnitType.HydrogenBomb);
    const atomCost = this.getPerceivedNukeCost(UnitType.AtomBomb);
    let nukeType: UnitType;
    if (this.player.gold() >= hydroCost) {
      nukeType = UnitType.HydrogenBomb;
    } else if (!this.isHydroNation && this.player.gold() >= atomCost) {
      nukeType = UnitType.AtomBomb;
    } else {
      return;
    }
    const range = this.game.config().nukeMagnitudes(nukeType).outer;

    const structures = nukeTarget.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
      UnitType.Factory,
    );
    const structureTiles = structures.map((u) => u.tile());
    const difficulty = this.game.config().gameConfig().difficulty;
    // Use more random tiles on Impossible difficulty to improve chances of finding a perfect SAM outranging spot
    const numRandomTiles = difficulty === Difficulty.Impossible ? 30 : 10;
    const randomTiles = randTerritoryTileArray(
      this.random,
      this.game,
      nukeTarget,
      numRandomTiles,
    );
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = -1; // -1 is important, so that we can also nuke land without structures
    this.removeOldNukeEvents();

    outer: for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      const boundingBox = boundingBoxTiles(this.game, tile, range)
        // Add radius / 2 in case there is a piece of unwanted territory inside the outer radius that we miss.
        .concat(boundingBoxTiles(this.game, tile, Math.floor(range / 2)));
      for (const t of boundingBox) {
        if (!this.isValidNukeTile(t, nukeTarget)) {
          continue outer;
        }
      }
      const spawnTile = this.player.canBuild(nukeType, tile);
      if (spawnTile === false) continue;

      // In team games, avoid nuking the same position as a teammate
      if (
        this.game.config().gameConfig().gameMode === GameMode.Team &&
        difficulty !== Difficulty.Easy &&
        this.isTeammateAlreadyNukingThisSpot(tile, nukeType)
      ) {
        continue;
      }

      // On Hard & Impossible, avoid trajectories that can be intercepted by enemy SAMs
      if (
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        this.isTrajectoryInterceptableBySam(spawnTile, tile)
      ) {
        continue;
      }

      const value = this.nukeTileScore(tile, silos, structures, nukeType);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile !== null) {
      this.sendNuke(bestTile, nukeType, nukeTarget);
    }
  }

  findBestNukeTarget(): Player | null {
    // Retaliate against incoming attacks (Most important!)
    const incomingAttackPlayer = this.attackBehavior.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      return incomingAttackPlayer;
    }

    // On impossible difficulty, prioritize nuking the crown if they have more than 50% of the map
    const { difficulty, gameMode } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Impossible && gameMode === GameMode.FFA) {
      const numTilesWithoutFallout =
        this.game.numLandTiles() - this.game.numTilesWithFallout();
      if (numTilesWithoutFallout > 0) {
        const sortedByTiles = this.game
          .players()
          .slice()
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
        const crown = sortedByTiles[0];

        if (crown && crown !== this.player && !this.player.isFriendly(crown)) {
          const crownShare = crown.numTilesOwned() / numTilesWithoutFallout;
          if (crownShare > 0.5) {
            return crown;
          }
        }
      }
    }

    // Assist allies, check their targets (this is basically the same as in assistAllies, but without sending emojis)
    for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) continue;

      for (const target of ally.targets()) {
        if (target === this.player) continue;
        if (this.player.isFriendly(target)) continue;
        // Found a valid ally target to nuke
        return target;
      }
    }

    // Find the most hated player
    // Ignore much weaker players (we don't need nukes to deal with them)
    const myMaxTroops = this.game.config().maxTroops(this.player);
    for (const relation of this.player.allRelationsSorted()) {
      if (relation.relation !== Relation.Hostile) continue;
      const other = relation.player;
      if (this.player.isFriendly(other)) continue;

      const otherMaxTroops = this.game.config().maxTroops(other);
      if (myMaxTroops >= otherMaxTroops * 2) continue;

      return other;
    }

    // In FFAs, nuke the crown if they're far enough ahead
    const crownTarget = this.findFFACrownTarget();
    if (crownTarget) {
      return crownTarget;
    }

    // In Teams, nuke the strongest team
    const teamTarget = this.findStrongestTeamTarget();
    if (teamTarget) {
      return teamTarget;
    }

    return null;
  }

  private findFFACrownTarget(): Player | null {
    const { difficulty, gameMode } = this.game.config().gameConfig();
    if (gameMode !== GameMode.FFA) {
      return null;
    }

    if (this.game.players().length <= 1) {
      return null;
    }

    const sortedByTiles = this.game
      .players()
      .slice()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const firstPlace = sortedByTiles[0];

    // If we're the crown on Impossible difficulty, target 2nd place
    if (
      difficulty === Difficulty.Impossible &&
      firstPlace === this.player &&
      sortedByTiles.length >= 2
    ) {
      const secondPlace = sortedByTiles[1];
      if (!this.player.isFriendly(secondPlace)) {
        return secondPlace;
      }
    }

    // Don't target ourselves or allies
    if (firstPlace === this.player || this.player.isFriendly(firstPlace)) {
      return null;
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    if (numTilesWithoutFallout <= 0) {
      return null;
    }

    const firstPlaceShare = firstPlace.numTilesOwned() / numTilesWithoutFallout;
    const myShare = this.player.numTilesOwned() / numTilesWithoutFallout;

    let threshold: number;
    switch (difficulty) {
      case Difficulty.Easy:
        threshold = 0.4; // 40%
        break;
      case Difficulty.Medium:
        threshold = 0.3; // 30%
        break;
      case Difficulty.Hard:
        threshold = 0.2; // 20%
        break;
      case Difficulty.Impossible:
        threshold = 0.1; // 10%
        break;
      default:
        assertNever(difficulty);
    }

    // Check if first place has threshold% more tile-percentage of the map than us
    if (firstPlaceShare - myShare > threshold) {
      return firstPlace;
    }

    return null;
  }

  private findStrongestTeamTarget(): Player | null {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return null;
    }

    if (this.game.players().length <= 1) {
      return null;
    }

    const teamTiles = new Map<string, number>();
    const teamPlayers = new Map<string, Player[]>();

    for (const p of this.game.players()) {
      const team = p.team();
      if (team === null) continue;

      teamTiles.set(team, (teamTiles.get(team) ?? 0) + p.numTilesOwned());
      let players = teamPlayers.get(team);
      if (!players) {
        players = [];
        teamPlayers.set(team, players);
      }
      players.push(p);
    }

    const sortedTeams = Array.from(teamTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    if (sortedTeams.length === 0) {
      return null;
    }

    let strongestTeam = sortedTeams[0][0];
    if (strongestTeam === this.player.team()) {
      if (sortedTeams.length > 1) {
        strongestTeam = sortedTeams[1][0];
      } else {
        return null;
      }
    }

    const targetTeamPlayers = teamPlayers.get(strongestTeam)!;

    // Filter out friendly players
    const validTargets = targetTeamPlayers.filter(
      (p) => !this.player.isFriendly(p),
    );

    if (validTargets.length === 0) {
      return null;
    }

    if (this.random.chance(2)) {
      // Strongest player
      return validTargets.reduce((prev, current) =>
        this.game.config().maxTroops(prev) >
        this.game.config().maxTroops(current)
          ? prev
          : current,
      );
    } else {
      // Random player
      return this.random.randElement(validTargets);
    }
  }

  // Simulate saving up for a MIRV
  private getPerceivedNukeCost(type: UnitType): Gold {
    // Return the actual cost in team games (saving up for a MIRV is not relevant, the game will be finished before that)
    // or if we already have enough gold to buy both a MIRV and a hydro
    if (
      this.game.config().gameConfig().gameMode === GameMode.Team ||
      this.player.gold() >
        this.cost(UnitType.MIRV) + this.cost(UnitType.HydrogenBomb)
    ) {
      return this.cost(type);
    }

    // On Hard & Impossible, ignore perceived cost when under heavy attack (2x troops)
    // The nation is probably going to get destroyed soon, so go all-in on nukes
    const difficulty = this.game.config().gameConfig().difficulty;
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.isUnderHeavyAttack()
    ) {
      return this.cost(type);
    }

    if (type === UnitType.AtomBomb) {
      return this.atomBombPerceivedCost;
    } else {
      return this.hydrogenBombPerceivedCost;
    }
  }

  private isUnderHeavyAttack(): boolean {
    // Get the total incoming attack troops
    const incomingAttacks = this.player.incomingAttacks();
    let totalIncomingTroops = 0;
    for (const attack of incomingAttacks) {
      totalIncomingTroops += attack.troops();
    }

    const myTroops = this.player.troops();

    // Consider it a heavy attack if total incoming attacks have 2x our troops
    return totalIncomingTroops >= myTroops * 2;
  }

  private removeOldNukeEvents() {
    const maxAge = 600; // 600 ticks = 1 minute
    const tick = this.game.ticks();
    while (
      this.recentlySentNukes.length > 0 &&
      this.recentlySentNukes[0][0] + maxAge < tick
    ) {
      this.recentlySentNukes.shift();
    }
  }

  private isTeammateAlreadyNukingThisSpot(
    tile: TileRef,
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
  ): boolean {
    // Get the inner radius for our nuke type
    const ourInnerRadius = this.game.config().nukeMagnitudes(nukeType).inner;

    // Get all active nukes in the game
    const activeNukes = this.game.units(
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
    );

    // Check if any teammate's nuke blast radius overlaps with ours
    for (const nuke of activeNukes) {
      const nukeOwner = nuke.owner();

      // Skip our own nukes and non-teammate nukes
      if (nukeOwner === this.player || !this.player.isFriendly(nukeOwner)) {
        continue;
      }

      // Get the target tile of the teammate's nuke
      const targetTile = nuke.targetTile();
      if (!targetTile) continue;

      // Get the blast radius of the teammate's nuke
      const teammateInnerRadius = this.game
        .config()
        .nukeMagnitudes(nuke.type()).inner;

      // Check if the blast zones overlap
      // They overlap if distance between targets < sum of the two radii
      const distSquared = this.game.euclideanDistSquared(tile, targetTile);
      const sumRadius = ourInnerRadius + teammateInnerRadius;
      const sumRadiusSquared = sumRadius * sumRadius;

      if (distSquared <= sumRadiusSquared) {
        return true;
      }
    }

    return false;
  }

  // mirroring NukeTrajectoryPreviewLayer.ts logic a bit
  private isTrajectoryInterceptableBySam(
    spawnTile: TileRef,
    targetTile: TileRef,
  ): boolean {
    const pathFinder = new ParabolaPathFinder(this.game);
    const speed = this.game.config().defaultNukeSpeed();
    const distanceBasedHeight = true; // Atom/Hydrogen bombs use distance-based height
    const rocketDirectionUp = true; // AI nukes always go "up" for now

    pathFinder.computeControlPoints(
      spawnTile,
      targetTile,
      speed,
      distanceBasedHeight,
      rocketDirectionUp,
    );

    const trajectory = pathFinder.allTiles();
    if (trajectory.length === 0) {
      return false;
    }

    const targetRangeSquared =
      this.game.config().defaultNukeTargetableRange() ** 2;

    let untargetableStart = -1;
    let untargetableEnd = -1;
    for (let i = 0; i < trajectory.length; i++) {
      const tile = trajectory[i];
      if (untargetableStart === -1) {
        if (
          this.game.euclideanDistSquared(tile, spawnTile) > targetRangeSquared
        ) {
          if (
            this.game.euclideanDistSquared(tile, targetTile) <
            targetRangeSquared
          ) {
            // Overlapping spawn & target range – no untargetable segment.
            break;
          } else {
            untargetableStart = i;
          }
        }
      } else if (
        this.game.euclideanDistSquared(tile, targetTile) < targetRangeSquared
      ) {
        untargetableEnd = i;
        break;
      }
    }

    for (let i = 0; i < trajectory.length; i++) {
      // Skip the mid-air untargetable portion
      if (
        untargetableStart !== -1 &&
        untargetableEnd !== -1 &&
        i === untargetableStart
      ) {
        i = untargetableEnd - 1;
        continue;
      }

      const tile = trajectory[i];
      const nearbySams = this.game.nearbyUnits(
        tile,
        this.game.config().maxSamRange(),
        UnitType.SAMLauncher,
      );

      for (const sam of nearbySams) {
        const owner = sam.unit.owner();
        if (owner === this.player || this.player.isFriendly(owner)) {
          continue;
        }
        const rangeSquared = this.game.config().samRange(sam.unit.level()) ** 2;
        if (sam.distSquared <= rangeSquared) {
          return true;
        }
      }
    }

    return false;
  }

  private isValidNukeTile(t: TileRef, nukeTarget: Player | null): boolean {
    const difficulty = this.game.config().gameConfig().difficulty;

    const owner = this.game.owner(t);
    if (owner === nukeTarget) return true;
    // On Hard & Impossible, allow TerraNullius (hit small islands) and in team games other non-friendly players
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      (!owner.isPlayer() ||
        (this.game.config().gameConfig().gameMode === GameMode.Team &&
          owner.isPlayer() &&
          !this.player.isFriendly(owner)))
    ) {
      return true;
    }
    // On Easy & Medium, only allow tiles owned by the target player (=> nuke away from the border) to reduce nuke usage
    return false;
  }

  private nukeTileScore(
    tile: TileRef,
    silos: Unit[],
    targets: Unit[],
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
  ): number {
    const magnitude = this.game.config().nukeMagnitudes(nukeType);
    const dist = euclDistFN(tile, magnitude.outer, false);
    let tileValue = targets
      .filter((unit) => dist(this.game, unit.tile()))
      .map((unit): number => {
        const level = unit.level();
        switch (unit.type()) {
          case UnitType.City:
            return 25_000 * level;
          case UnitType.DefensePost:
            return 5_000 * level;
          case UnitType.MissileSilo:
            return 50_000 * level;
          case UnitType.Port:
            return 15_000 * level;
          case UnitType.Factory:
            return 15_000 * level;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    const difficulty = this.game.config().gameConfig().difficulty;
    // On Easy, ignore SAMs entirely.
    // On Medium, apply a simple local SAM penalty.
    // On Hard & Impossible we rely on trajectory-based interception checks instead. See maybeSendNuke().
    if (difficulty === Difficulty.Medium) {
      const dist50 = euclDistFN(tile, 50, false);
      const hasSam = targets.some(
        (unit) =>
          unit.type() === UnitType.SAMLauncher &&
          dist50(this.game, unit.tile()),
      );
      if (hasSam) return -1;
    }

    // On Impossible difficulty and a hydrogen bomb, add value for SAMs that can be outranged
    if (
      difficulty === Difficulty.Impossible &&
      nukeType === UnitType.HydrogenBomb
    ) {
      const hydroMagnitude = this.game
        .config()
        .nukeMagnitudes(UnitType.HydrogenBomb);
      const nearbySams = this.game.nearbyUnits(
        tile,
        hydroMagnitude.outer,
        UnitType.SAMLauncher,
      );

      for (const sam of nearbySams) {
        const samLevel = sam.unit.level();
        if (samLevel >= 5) continue; // Can't outrange level 5+ SAMs

        const samRange = this.game.config().samRange(samLevel);
        const distToSam = Math.sqrt(
          this.game.euclideanDistSquared(tile, sam.unit.tile()),
        );

        // Check if we can outrange this SAM
        if (distToSam > samRange) {
          // Add significant value for destroying a SAM that we can outrange
          tileValue += 100_000 * samLevel;
        }
      }
    }

    // Prefer tiles that are closer to a silo (but preserve structure value)
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.game, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.game.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    const distancePenalty = distanceToClosestSilo * 30;
    const baseTileValue = tileValue;
    tileValue = Math.max(baseTileValue * 0.2, tileValue - distancePenalty); // Keep at least 20% of structure value

    // Don't target near recent targets
    tileValue -= this.recentlySentNukes
      .filter(([_tick, recentTile, recentNukeType]) => {
        const recentInnerRadius = this.game
          .config()
          .nukeMagnitudes(recentNukeType).inner;
        const distSquared = this.game.euclideanDistSquared(tile, recentTile);
        return distSquared <= recentInnerRadius * recentInnerRadius;
      })
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private sendNuke(
    tile: TileRef,
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
    targetPlayer: Player,
  ) {
    const tick = this.game.ticks();
    this.recentlySentNukes.push([tick, tile, nukeType]);
    if (nukeType === UnitType.AtomBomb) {
      this.atomBombsLaunched++;
      // Increase perceived cost by 25% each time to simulate saving up for a MIRV (higher than hydro to make atom bombs less attractive for the lategame)
      this.atomBombPerceivedCost = (this.atomBombPerceivedCost * 125n) / 100n;
    } else if (nukeType === UnitType.HydrogenBomb) {
      this.hydrogenBombsLaunched++;
      // Increase perceived cost by 15% each time to simulate saving up for a MIRV
      this.hydrogenBombPerceivedCost =
        (this.hydrogenBombPerceivedCost * 115n) / 100n;
    }
    this.game.addExecution(new NukeExecution(nukeType, this.player, tile));
    this.emojiBehavior.maybeSendEmoji(targetPlayer, EMOJI_NUKE);
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}
