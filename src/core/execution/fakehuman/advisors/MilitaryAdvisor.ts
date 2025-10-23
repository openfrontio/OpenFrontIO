import { Cell, Player, PlayerType, Tick, UnitType } from "../../../game/Game";
import { euclDistFN, TileRef } from "../../../game/GameMap";
import { boundingBoxTiles } from "../../../Util";
import { EmojiExecution } from "../../EmojiExecution";
import { NukeExecution } from "../../NukeExecution";
import { TransportShipExecution } from "../../TransportShipExecution";
import { closestTwoTiles } from "../../Util";
import { BotBehavior, EMOJI_HECKLE } from "../../utils/BotBehavior";
import { BaseAdvisor } from "../core/BaseAdvisor";
import { ActionRecommendation, AdvisorPriority } from "../core/types";

/**
 * Military advisor handles attack strategies, enemy selection, and military decisions
 * Manages border analysis, enemy targeting, nuke attacks, boat attacks, and emoji taunting
 */
export class MilitaryAdvisor extends BaseAdvisor {
  private readonly lastEmojiSent = new Map<Player, Tick>();
  private readonly lastNukeSent: [Tick, TileRef][] = [];
  private behavior: BotBehavior | null = null;

  /**
   * Set the BotBehavior instance for attack execution
   */
  setBehavior(behavior: BotBehavior): void {
    this.behavior = behavior;
  }

  /**
   * Analyze current game state and recommend military actions
   * This matches the original maybeAttack() logic exactly
   */
  recommend(): ActionRecommendation | null {
    const enemyborder = this.getEnemyBorderTiles();

    if (enemyborder.length === 0) {
      // No enemies on border, 10% chance to send boat randomly (original logic)
      if (this.random.chance(10)) {
        return this.recommendBoatAttack();
      }
      return null;
    }

    // 20% chance to send boat instead of analyzing borders (original logic)
    if (this.random.chance(20)) {
      return this.recommendBoatAttack();
    }

    const borderPlayers = enemyborder.map((t) =>
      this.game.playerBySmallID(this.game.ownerID(t)),
    );

    // Check for unclaimed territory (original logic)
    if (borderPlayers.some((o) => !o.isPlayer())) {
      return this.recommendTerraNulliusAttack();
    }

    const enemies = borderPlayers
      .filter((o) => o.isPlayer())
      .sort((a, b) => a.troops() - b.troops());

    // 20% chance to send alliance request (original logic)
    if (this.random.chance(20)) {
      const allianceRec = this.recommendAllianceRequest(enemies);
      if (allianceRec) return allianceRec;
    }

    // Use BotBehavior's enemy selection and attack logic (original behavior)
    if (!this.behavior) return null;

    this.behavior.forgetOldEnemies();
    this.behavior.assistAllies();

    const enemy = this.behavior.selectEnemy(enemies);
    if (!enemy) return null;

    // Execute emoji, nuke, and attack in sequence (original logic)
    this.maybeSendEmoji(enemy);
    this.maybeSendNuke(enemy);

    if (this.player.sharesBorderWith(enemy)) {
      return this.recommendDirectAttack(enemy);
    } else {
      return this.recommendBoatAttackOnEnemy(enemy);
    }
  }

  private getEnemyBorderTiles(): TileRef[] {
    return Array.from(this.player.borderTiles())
      .flatMap((t) => this.game.neighbors(t))
      .filter(
        (t) =>
          this.game.isLand(t) && this.game.ownerID(t) !== this.player.smallID(),
      );
  }

  private selectEnemy(enemies: Player[]): Player | null {
    if (!this.behavior) {
      // Fallback to weakest enemy if no behavior available
      return enemies.length > 0 ? enemies[0] : null;
    }
    return this.behavior.selectEnemy(enemies);
  }

  private recommendBoatAttack(): ActionRecommendation | null {
    const oceanShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.game.isOceanShore(t),
    );
    if (oceanShore.length === 0) return null;

    const src = this.random.randElement(oceanShore);
    const dst = this.findBoatTarget(src, 150); // Original search radius
    if (dst === null) return null;

    return {
      execute: () => {
        this.game.addExecution(
          new TransportShipExecution(
            this.player,
            this.game.owner(dst).id(),
            dst,
            this.player.troops() / 5, // Original troop count
            null,
          ),
        );
      },
      score: 60,
      priority: AdvisorPriority.Normal,
      description: "Random boat attack",
    };
  }

  private recommendTerraNulliusAttack(): ActionRecommendation {
    return {
      execute: () => {
        if (this.behavior) {
          this.behavior.sendAttack(this.game.terraNullius());
        }
      },
      score: 80,
      priority: AdvisorPriority.High,
      description: "Attack unclaimed territory",
    };
  }

  private recommendAllianceRequest(
    enemies: Player[],
  ): ActionRecommendation | null {
    const toAlly = this.random.randElement(enemies);
    if (!this.player.canSendAllianceRequest(toAlly)) return null;

    return {
      execute: () => {
        this.player.createAllianceRequest(toAlly);
      },
      score: 30,
      priority: AdvisorPriority.Low,
      description: `Alliance request to ${toAlly.id()}`,
    };
  }

  private recommendEmojiAttack(enemy: Player): ActionRecommendation | null {
    if (enemy.type() !== PlayerType.Human) return null;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.game.ticks() - lastSent <= 300) return null;

    return {
      execute: () => {
        this.lastEmojiSent.set(enemy, this.game.ticks());
        this.game.addExecution(
          new EmojiExecution(
            this.player,
            enemy.id(),
            this.random.randElement(EMOJI_HECKLE),
          ),
        );
      },
      score: 40,
      priority: AdvisorPriority.Low,
      description: `Emoji taunt to ${enemy.id()}`,
    };
  }

  private recommendNukeAttack(enemy: Player): ActionRecommendation | null {
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      enemy.type() === PlayerType.Bot ||
      this.player.isOnSameTeam(enemy)
    ) {
      return null;
    }

    const nukeType =
      this.player.gold() > this.cost(UnitType.HydrogenBomb)
        ? UnitType.HydrogenBomb
        : UnitType.AtomBomb;

    const bestTile = this.findBestNukeTarget(enemy, nukeType);
    if (!bestTile) return null;

    return {
      execute: () => {
        this.sendNuke(bestTile, nukeType);
      },
      score: 200,
      priority: AdvisorPriority.High,
      description: `${nukeType} attack on ${enemy.id()}`,
    };
  }

  private recommendDirectAttack(enemy: Player): ActionRecommendation | null {
    if (this.player.sharesBorderWith(enemy)) {
      return {
        execute: () => {
          if (this.behavior) {
            this.behavior.sendAttack(enemy);
          }
        },
        score: 150,
        priority: AdvisorPriority.High,
        description: `Direct attack on ${enemy.id()}`,
      };
    } else {
      return this.recommendBoatAttackOnEnemy(enemy);
    }
  }

  private recommendBoatAttackOnEnemy(
    enemy: Player,
  ): ActionRecommendation | null {
    const closest = closestTwoTiles(
      this.game,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isOceanShore(t),
      ),
      Array.from(enemy.borderTiles()).filter((t) => this.game.isOceanShore(t)),
    );
    if (closest === null) return null;

    return {
      execute: () => {
        this.game.addExecution(
          new TransportShipExecution(
            this.player,
            enemy.id(),
            closest.y,
            this.player.troops() / 5, // Original troop count
            null,
          ),
        );
      },
      score: 120,
      priority: AdvisorPriority.Normal,
      description: `Boat attack on ${enemy.id()}`,
    };
  }

  private findBoatTarget(tile: TileRef, dist: number): TileRef | null {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - dist, x + dist);
      const randY = this.random.nextInt(y - dist, y + dist);
      if (!this.game.isValidCoord(randX, randY)) continue;
      const randTile = this.game.ref(randX, randY);
      if (!this.game.isLand(randTile)) continue;
      const owner = this.game.owner(randTile);
      if (!owner.isPlayer()) return randTile;
      if (!owner.isFriendly(this.player)) return randTile;
    }
    return null;
  }

  private findBestNukeTarget(
    enemy: Player,
    nukeType: UnitType,
  ): TileRef | null {
    const range = nukeType === UnitType.HydrogenBomb ? 60 : 15;
    const structures = enemy.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles = this.getRandomTerritoryTiles(10);
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = 0;
    this.removeOldNukeEvents();

    for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      const boundingBox = boundingBoxTiles(this.game, tile, range).concat(
        boundingBoxTiles(this.game, tile, Math.floor(range / 2)),
      );
      let validTarget = true;
      for (const t of boundingBox) {
        if (this.game.owner(t) !== enemy) {
          validTarget = false;
          break;
        }
      }
      if (!validTarget) continue;
      if (!this.player.canBuild(nukeType, tile)) continue;
      const value = this.calculateNukeTileScore(tile, structures);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }

    return bestTile;
  }

  private calculateNukeTileScore(tile: TileRef, targets: any[]): number {
    const dist = euclDistFN(tile, 25, false);
    let tileValue = targets
      .filter((unit) => dist(this.game, unit.tile()))
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

    // Avoid areas defended by SAM launchers
    const dist50 = euclDistFN(tile, 50, false);
    tileValue -=
      50_000 *
      targets.filter(
        (unit) =>
          unit.type() === UnitType.SAMLauncher &&
          dist50(this.game, unit.tile()),
      ).length;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.game, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private getRandomTerritoryTiles(numTiles: number): TileRef[] {
    const boundingBox = this.calculateBoundingBox();
    const tiles: TileRef[] = [];
    for (let i = 0; i < numTiles; i++) {
      const tile = this.getRandomTerritoryTile(boundingBox);
      if (tile !== null) {
        tiles.push(tile);
      }
    }
    return tiles;
  }

  private calculateBoundingBox(): {
    min: { x: number; y: number };
    max: { x: number; y: number };
  } {
    const borderTiles = Array.from(this.player.borderTiles());
    if (borderTiles.length === 0) {
      return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const tile of borderTiles) {
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  }

  private getRandomTerritoryTile(boundingBox: {
    min: { x: number; y: number };
    max: { x: number; y: number };
  }): TileRef | null {
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.game.isOnMap(new Cell(randX, randY))) continue;
      const randTile = this.game.ref(randX, randY);
      if (this.game.owner(randTile) === this.player) {
        return randTile;
      }
    }
    return null;
  }

  private sendNuke(tile: TileRef, nukeType: UnitType): void {
    const tick = this.game.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.game.addExecution(
      new NukeExecution(nukeType as any, this.player, tile),
    );
  }

  private removeOldNukeEvents(): void {
    const maxAge = 500;
    const tick = this.game.ticks();
    while (
      this.lastNukeSent.length > 0 &&
      this.lastNukeSent[0][0] + maxAge < tick
    ) {
      this.lastNukeSent.shift();
    }
  }

  private maybeSendEmoji(enemy: Player): void {
    if (enemy.type() !== PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.game.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(enemy, this.game.ticks());
    this.game.addExecution(
      new EmojiExecution(
        this.player,
        enemy.id(),
        this.random.randElement(EMOJI_HECKLE),
      ),
    );
  }

  private maybeSendNuke(enemy: Player): void {
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      enemy.type() === PlayerType.Bot ||
      this.player.isOnSameTeam(enemy)
    ) {
      return;
    }

    const nukeType =
      this.player.gold() > this.cost(UnitType.HydrogenBomb)
        ? UnitType.HydrogenBomb
        : UnitType.AtomBomb;

    const bestTile = this.findBestNukeTarget(enemy, nukeType);
    if (!bestTile) return;

    this.sendNuke(bestTile, nukeType);
  }
}
