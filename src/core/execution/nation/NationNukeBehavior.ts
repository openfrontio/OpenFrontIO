import {
  Difficulty,
  Game,
  GameMode,
  Gold,
  Player,
  PlayerType,
  Tick,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef, euclDistFN } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { boundingBoxTiles } from "../../Util";
import { NukeExecution } from "../NukeExecution";
import { closestTwoTiles } from "../Util";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { EMOJI_NUKE, NationEmojiBehavior } from "./NationEmojiBehavior";
import { randTerritoryTileArray } from "./NationUtils";

export class NationNukeBehavior {
  private readonly lastNukeSent: [Tick, TileRef][] = [];

  constructor(
    private random: PseudoRandom,
    private mg: Game,
    private player: Player,
    private attackBehavior: AiAttackBehavior,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  maybeSendNuke(other: Player | null) {
    if (this.attackBehavior === null) throw new Error("not initialized");
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      other === null ||
      other.type() === PlayerType.Bot || // Don't nuke bots (as opposed to nations and humans)
      this.player.isOnSameTeam(other) ||
      this.attackBehavior.shouldAttack(other) === false
    ) {
      return;
    }

    const nukeType =
      this.player.gold() > this.cost(UnitType.HydrogenBomb)
        ? UnitType.HydrogenBomb
        : UnitType.AtomBomb;
    const range = nukeType === UnitType.HydrogenBomb ? 80 : 20;

    const structures = other.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles = randTerritoryTileArray(this.random, this.mg, other, 10);
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = 0;
    this.removeOldNukeEvents();

    outer: for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      const boundingBox = boundingBoxTiles(this.mg, tile, range)
        // Add radius / 2 in case there is a piece of unwanted territory inside the outer radius that we miss.
        .concat(boundingBoxTiles(this.mg, tile, Math.floor(range / 2)));
      for (const t of boundingBox) {
        if (!this.isValidNukeTile(t, other)) {
          continue outer;
        }
      }
      if (!this.player.canBuild(nukeType, tile)) continue;
      const value = this.nukeTileScore(tile, silos, structures);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile !== null) {
      this.sendNuke(bestTile, nukeType, other);
    }
  }

  private isValidNukeTile(t: TileRef, other: Player | null): boolean {
    const difficulty = this.mg.config().gameConfig().difficulty;

    const owner = this.mg.owner(t);
    if (owner === other) return true;
    // On Hard & Impossible, allow TerraNullius (hit small islands) and in team games other non-friendly players
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      (!owner.isPlayer() ||
        (this.mg.config().gameConfig().gameMode === GameMode.Team &&
          owner.isPlayer() &&
          !this.player.isFriendly(owner)))
    ) {
      return true;
    }
    // On Easy & Medium, only allow tiles owned by the target player (=> nuke away from the border) to reduce nuke usage
    return false;
  }

  private removeOldNukeEvents() {
    const maxAge = 500;
    const tick = this.mg.ticks();
    while (
      this.lastNukeSent.length > 0 &&
      this.lastNukeSent[0][0] + maxAge < tick
    ) {
      this.lastNukeSent.shift();
    }
  }

  private nukeTileScore(tile: TileRef, silos: Unit[], targets: Unit[]): number {
    // Potential damage in a 25-tile radius
    const dist = euclDistFN(tile, 25, false);
    let tileValue = targets
      .filter((unit) => dist(this.mg, unit.tile()))
      .map((unit): number => {
        switch (unit.type()) {
          case UnitType.City:
            return 25_000;
          case UnitType.DefensePost:
            return 5_000;
          case UnitType.MissileSilo:
            return 50_000;
          case UnitType.Port:
            return 10_000;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Avoid areas defended by SAM launchers (not on easy difficulty)
    if (this.mg.config().gameConfig().difficulty !== Difficulty.Easy) {
      const dist50 = euclDistFN(tile, 50, false);
      tileValue -=
        50_000 *
        targets.filter(
          (unit) =>
            unit.type() === UnitType.SAMLauncher &&
            dist50(this.mg, unit.tile()),
        ).length;
    }

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.mg, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.mg.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private sendNuke(
    tile: TileRef,
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
    targetPlayer: Player,
  ) {
    if (this.attackBehavior === null || this.emojiBehavior === null)
      throw new Error("not initialized");
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.mg.addExecution(new NukeExecution(nukeType, this.player, tile));
    this.emojiBehavior.maybeSendEmoji(targetPlayer, EMOJI_NUKE);
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.mg, this.player);
  }
}
