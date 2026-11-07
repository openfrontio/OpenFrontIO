import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  ZombieRaidPlayerUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import {
  CURE_BASE_POINTS_PER_SECOND,
  CURE_HEAL_TILES_PER_SECOND,
  CURE_POINTS_PER_AIRPORT_LEVEL,
  CURE_POINTS_PER_CITY_LEVEL,
  CURE_TARGET,
  applyPercentBonus,
  survivorBuffForTile,
  ZOMBIE,
  ZOMBIE_PLAYER_ID,
} from "@openfront/engine-lib/game/ModRules";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { ZombieRaidState } from "../game/ZombieRaidState";
import { UnitTypeSchema } from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { FighterJetExecution } from "./FighterJetExecution";
import { isDrivable } from "./ModMovement";
import { PlayerExecution } from "./PlayerExecution";
import { TankExecution } from "./TankExecution";
import { TribeExecution } from "./TribeExecution";
import { WarshipExecution } from "./WarshipExecution";

const TICKS_PER_MINUTE = 600;
// A fresh survivor camp appears this often while there is room for one.
const CAMP_RESPAWN_TICKS = 600;
// Survivor camps keep this far apart.
const CAMP_SPACING = 12;
// Never take more than this share of a player's land in the first wave, so the
// outbreak hurts without wiping anyone out on the spot.
const MAX_INITIAL_LOSS_PERCENT = 40;
// Zombie units of one type, to bound simulation cost.
const MAX_ZOMBIE_UNITS_PER_TYPE = 60;

/**
 * Zombie Raid. After a set time an outbreak turns part of every player's land
 * into zombie land and starts a zombie faction. From then on
 *  - units that die rise again as zombies for good,
 *  - every player researches a cure at a rate set by their cities and airports;
 *    a cured player is safe from the outbreak and heals zombie land,
 *  - survivors hide in camps on zombie land; whoever takes the land rescues
 *    them and gains a permanent, stackable buff.
 *
 * Deterministic: integer math and a seeded PRNG only. The state the rest of the
 * simulation reads lives in ZombieRaidState, which this execution owns.
 */
export class ZombieRaidExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private random: PseudoRandom;
  private state = new ZombieRaidState();
  private started = false;
  private lastCampTick = 0;

  constructor(private outbreakMinutes: number) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(simpleHash("zombie-raid"));
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  isActive(): boolean {
    return this.active;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    if (mg === null) throw new Error("Not initialized");

    if (!this.started) {
      this.started = true;
      this.state.outbreakTick = ticks + this.outbreakMinutes * TICKS_PER_MINUTE;
      mg.setZombieRaid(this.state);
    }

    if (this.state.outbroken) {
      this.reanimateDead();
    }
    if (ticks % 10 !== 0) return;

    if (!this.state.outbroken && ticks >= this.state.outbreakTick) {
      this.outbreak(ticks);
    }
    if (this.state.outbroken) {
      this.research();
      this.healCured();
      this.rescueSurvivors();
      this.maintainCamps(ticks);
      this.feedHorde();
      this.grantSurvivorBonuses();
    }
    this.publish();
  }

  // -------------------------------------------------------------------------
  // Outbreak
  // -------------------------------------------------------------------------

  private zombie(): Player | null {
    if (this.state.zombieSmallID === 0) return null;
    const p = this.mg!.playerBySmallID(this.state.zombieSmallID);
    return p.isPlayer() ? p : null;
  }

  private outbreak(ticks: number): void {
    const mg = this.mg!;
    const zombie = mg.addPlayer(
      new PlayerInfo(ZOMBIE.name, PlayerType.Bot, null, ZOMBIE_PLAYER_ID),
    );
    this.state.outbroken = true;
    this.state.zombieSmallID = zombie.smallID();

    let firstEpicenter: TileRef | undefined;
    let epicenters = 0;
    for (const victim of mg.players()) {
      if (victim === zombie || victim.type() === PlayerType.Bot) continue;
      const infected = this.infect(victim, zombie);
      if (infected.first !== undefined) {
        firstEpicenter ??= infected.first;
        epicenters += infected.count;
      }
    }

    if (firstEpicenter === undefined) {
      // Nobody had land to infect: fall back to any free land tile.
      this.active = false;
      return;
    }

    zombie.setSpawnTile(firstEpicenter);
    mg.stats().recordSpawnTile(zombie, firstEpicenter);
    zombie.addTroops(ZOMBIE.startingTroopsPerEpicenter * epicenters);
    mg.addExecution(new PlayerExecution(zombie));
    mg.addExecution(new TribeExecution(zombie));

    this.placeInitialCamps(zombie);
    mg.displayMessage(
      "events_display.zombie_outbreak",
      MessageType.NUKE_DETONATED,
      null,
    );
  }

  /** Turns patches of `victim`'s land into zombie land. */
  private infect(
    victim: Player,
    zombie: Player,
  ): { first: TileRef | undefined; count: number } {
    const mg = this.mg!;
    const owned = victim.numTilesOwned();
    if (owned === 0) return { first: undefined, count: 0 };

    const wanted = Math.min(
      ZOMBIE.maxEpicentersPerPlayer,
      1 + Math.floor(owned / ZOMBIE.tilesPerEpicenter),
    );
    let budget = Math.floor((owned * MAX_INITIAL_LOSS_PERCENT) / 100);
    const tiles: TileRef[] = [];
    for (const t of victim.tiles()) tiles.push(t);

    let first: TileRef | undefined;
    let count = 0;
    for (let i = 0; i < wanted && budget > 0; i++) {
      const center = tiles[this.random.nextInt(0, tiles.length)];
      if (mg.owner(center) !== victim) continue;
      const taken = this.floodInfect(
        center,
        victim,
        zombie,
        Math.min(ZOMBIE.epicenterTiles, budget),
      );
      if (taken === 0) continue;
      budget -= taken;
      first ??= center;
      count++;
    }
    return { first, count };
  }

  private floodInfect(
    start: TileRef,
    victim: Player,
    zombie: Player,
    limit: number,
  ): number {
    const mg = this.mg!;
    const seen = new Set<TileRef>([start]);
    const queue: TileRef[] = [start];
    let taken = 0;
    for (let head = 0; head < queue.length && taken < limit; head++) {
      const tile = queue[head];
      if (mg.owner(tile) !== victim || !isDrivable(mg, tile)) continue;
      zombie.conquer(tile);
      taken++;
      for (const n of mg.neighbors(tile)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return taken;
  }

  // -------------------------------------------------------------------------
  // Survivors
  // -------------------------------------------------------------------------

  private placeInitialCamps(zombie: Player): void {
    const count = Math.max(
      ZOMBIE.minSurvivorCamps,
      Math.min(
        ZOMBIE.maxSurvivorCamps,
        Math.floor(zombie.numTilesOwned() / ZOMBIE.tilesPerSurvivorCamp),
      ),
    );
    for (let i = 0; i < count; i++) {
      this.placeCamp(zombie);
    }
  }

  private placeCamp(zombie: Player): boolean {
    const mg = this.mg!;
    const tiles: TileRef[] = [];
    for (const t of zombie.tiles()) tiles.push(t);
    if (tiles.length === 0) return false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const tile = tiles[this.random.nextInt(0, tiles.length)];
      if (!isDrivable(mg, tile)) continue;
      if (
        mg.nearbyUnits(tile, CAMP_SPACING, [UnitType.SurvivorCamp]).length > 0
      ) {
        continue;
      }
      zombie.buildUnit(UnitType.SurvivorCamp, tile, {});
      return true;
    }
    return false;
  }

  private maintainCamps(ticks: number): void {
    const zombie = this.zombie();
    if (zombie === null) return;
    if (ticks - this.lastCampTick < CAMP_RESPAWN_TICKS) return;
    this.lastCampTick = ticks;
    if (zombie.unitCount(UnitType.SurvivorCamp) >= ZOMBIE.maxSurvivorCamps) {
      return;
    }
    this.placeCamp(zombie);
  }

  /** A camp whose land now belongs to a player has been rescued by them. */
  private rescueSurvivors(): void {
    const mg = this.mg!;
    for (const camp of mg.units(UnitType.SurvivorCamp)) {
      const holder = mg.owner(camp.tile());
      if (!holder.isPlayer() || holder.smallID() === this.state.zombieSmallID) {
        continue;
      }
      // Survivors are for human players. Left open to nations and tribes they
      // were all taken within seconds of the outbreak (seen in a live game: 27
      // of 40 camps in 7 seconds), leaving nothing to find. A camp on land an AI
      // holds just waits until a human takes that land.
      if (holder.type() !== PlayerType.Human) continue;
      this.rescue(camp, holder);
    }
  }

  private rescue(camp: Unit, rescuer: Player): void {
    const kind = survivorBuffForTile(camp.tile());
    this.state.addStack(rescuer.smallID(), kind);
    this.state.survivorsRescued++;
    camp.delete(false);
    this.mg!.displayMessage(
      "events_display.survivors_rescued",
      MessageType.CAPTURED_ENEMY_UNIT,
      rescuer.id(),
      undefined,
      { buff: `survivor_buff.${kind}` },
    );
  }

  // -------------------------------------------------------------------------
  // Cure
  // -------------------------------------------------------------------------

  private research(): void {
    const mg = this.mg!;
    for (const p of mg.players()) {
      if (p.type() === PlayerType.Bot) continue;
      const id = p.smallID();
      if (this.state.isCured(id)) continue;
      let gain =
        CURE_BASE_POINTS_PER_SECOND +
        p.unitCount(UnitType.City) * CURE_POINTS_PER_CITY_LEVEL +
        p.unitCount(UnitType.Airport) * CURE_POINTS_PER_AIRPORT_LEVEL;
      gain = applyPercentBonus(gain, this.state.buffPercent(id, "researcher"));
      const next = Math.min(CURE_TARGET, this.state.curePoints(id) + gain);
      this.state.cure.set(id, next);
      if (next >= CURE_TARGET) {
        mg.displayMessage(
          "events_display.cure_completed",
          MessageType.ALLIANCE_ACCEPTED,
          null,
          undefined,
          { name: p.displayName() },
        );
      }
    }
  }

  /** A cured player pushes the infection back along their border. */
  private healCured(): void {
    const mg = this.mg!;
    const zombie = this.zombie();
    if (zombie === null) return;
    for (const p of mg.players()) {
      if (p === zombie || p.type() === PlayerType.Bot) continue;
      if (!this.state.isCured(p.smallID())) continue;
      let budget = CURE_HEAL_TILES_PER_SECOND;
      let scanned = 0;
      for (const border of p.borderTiles()) {
        if (budget <= 0 || ++scanned > 256) break;
        for (const n of mg.neighbors(border)) {
          if (budget > 0 && mg.owner(n) === zombie && isDrivable(mg, n)) {
            p.conquer(n);
            budget--;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // The horde
  // -------------------------------------------------------------------------

  private feedHorde(): void {
    const zombie = this.zombie();
    if (zombie === null || !zombie.isAlive()) return;
    zombie.addTroops(zombie.numTilesOwned() * ZOMBIE.troopsPerTilePerSecond);
  }

  /**
   * Rescued survivors keep paying off: medics add to troop growth and
   * scavengers to gold income, each as a share of the player's normal income
   * (per stack, see SURVIVOR_BUFF_PERCENT_PER_STACK). Researchers speed up the
   * cure and gunners hit harder; those are applied where they are used.
   */
  private grantSurvivorBonuses(): void {
    const mg = this.mg!;
    const config = mg.config();
    for (const p of mg.players()) {
      if (p.type() === PlayerType.Bot) continue;
      const id = p.smallID();
      const medic = this.state.buffPercent(id, "medic");
      if (medic > 0) {
        // The base rates are per tick; the bonus is paid once a second.
        p.addTroops(
          Math.floor((config.troopIncreaseRate(p) * 10 * medic) / 100),
        );
      }
      const scavenger = this.state.buffPercent(id, "scavenger");
      if (scavenger > 0) {
        p.addGold(
          (config.goldAdditionRate(p) * 10n * BigInt(scavenger)) / 100n,
        );
      }
    }
  }

  /** Units that died since last tick rise again, owned by the zombies. */
  private reanimateDead(): void {
    const mg = this.mg!;
    const zombie = this.zombie();
    const dead = this.state.pendingDeaths.splice(0);
    if (zombie === null) return;
    for (const d of dead) {
      if (zombie.unitCount(d.type) >= MAX_ZOMBIE_UNITS_PER_TYPE) continue;
      const fits =
        d.type === UnitType.Tank
          ? isDrivable(mg, d.tile)
          : d.type === UnitType.Warship
            ? mg.isWater(d.tile)
            : true;
      if (!fits) continue;
      // The horde does not pay: top its purse up so building nets to zero.
      zombie.addGold(mg.unitInfo(d.type).cost(mg, zombie));
      const unit = zombie.buildUnit(d.type, d.tile, { patrolTile: d.tile });
      switch (d.type) {
        case UnitType.Tank:
          mg.addExecution(new TankExecution(unit));
          break;
        case UnitType.FighterJet:
          mg.addExecution(new FighterJetExecution(unit));
          break;
        case UnitType.Warship:
          mg.addExecution(new WarshipExecution(unit));
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Client feed
  // -------------------------------------------------------------------------

  private publish(): void {
    const mg = this.mg!;
    const players: ZombieRaidPlayerUpdate[] = [];
    for (const p of mg.players()) {
      if (p.type() === PlayerType.Bot) continue;
      const id = p.smallID();
      players.push({
        smallID: id,
        curePoints: this.state.curePoints(id),
        buffs: [...(this.state.buffs.get(id) ?? [])],
      });
    }
    mg.addUpdate({
      type: GameUpdateType.ZombieRaid,
      outbreakTick: this.state.outbreakTick,
      outbroken: this.state.outbroken,
      zombieSmallID: this.state.zombieSmallID,
      survivorsRescued: this.state.survivorsRescued,
      survivorsLeft: this.mg!.unitCount(UnitType.SurvivorCamp),
      players,
    });
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  snapshot(w: SnapshotWriter): ExecRecord {
    return ZombieRaidExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      outbreakMinutes: this.outbreakMinutes,
      started: this.started,
      lastCampTick: this.lastCampTick,
      random: this.mg === null ? null : w.random(this.random),
      outbreakTick: this.state.outbreakTick,
      outbroken: this.state.outbroken,
      zombieSmallID: this.state.zombieSmallID,
      survivorsRescued: this.state.survivorsRescued,
      cure: [...this.state.cure].map(([id, pts]) => ({ id, pts })),
      buffs: [...this.state.buffs].map(([id, stacks]) => ({ id, stacks })),
      pendingDeaths: this.state.pendingDeaths.map((d) => ({
        type: d.type,
        tile: d.tile,
        owner: d.formerOwnerSmallID,
      })),
    });
  }

  restoreSnapshot(s: ZombieRaidState_, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.outbreakMinutes = s.outbreakMinutes;
    this.started = s.started;
    this.lastCampTick = s.lastCampTick;
    if (s.random !== null) this.random = r.random(s.random);
    const st = new ZombieRaidState();
    st.outbreakTick = s.outbreakTick;
    st.outbroken = s.outbroken;
    st.zombieSmallID = s.zombieSmallID;
    st.survivorsRescued = s.survivorsRescued;
    for (const c of s.cure) st.cure.set(c.id, c.pts);
    for (const b of s.buffs) st.buffs.set(b.id, [...b.stacks]);
    for (const d of s.pendingDeaths) {
      st.pendingDeaths.push({
        type: d.type,
        tile: d.tile,
        formerOwnerSmallID: d.owner,
      });
    }
    this.state = st;
    // Restored games keep running, so the rest of the simulation must see the
    // restored state, not a stale one.
    if (s.started) r.game.setZombieRaid(st);
  }
}

const ZombieRaidStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  outbreakMinutes: zInt(),
  started: z.boolean(),
  lastCampTick: zInt(),
  random: zRandom().nullable(),
  outbreakTick: zInt(),
  outbroken: z.boolean(),
  zombieSmallID: zPlayerRef(),
  survivorsRescued: zInt(),
  cure: z.array(z.object({ id: zPlayerRef(), pts: zInt() })),
  buffs: z.array(z.object({ id: zPlayerRef(), stacks: z.array(zInt()) })),
  pendingDeaths: z.array(
    z.object({ type: UnitTypeSchema, tile: zTile(), owner: zPlayerRef() }),
  ),
});
type ZombieRaidState_ = z.infer<typeof ZombieRaidStateSchema>;

export const ZombieRaidExecutionSnapshot = execSnapshotType({
  name: "ZombieRaid",
  version: 1,
  schema: ZombieRaidStateSchema,
  cls: () => ZombieRaidExecution,
});
