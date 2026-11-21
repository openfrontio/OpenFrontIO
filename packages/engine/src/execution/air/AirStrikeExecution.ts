import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AttackExecution } from "../AttackExecution";
import { flyToward } from "./AirUtils";

export type AirStrikeKind = "bomb" | "paratroop";

// Ships a bomb run damages (structures lose a level instead).
const SHIP_TYPES: readonly UnitType[] = [
  UnitType.Warship,
  UnitType.TransportShip,
  UnitType.TradeShip,
  UnitType.FishingBoat,
  UnitType.AircraftCarrier,
];

/**
 * One sortie from the nearest airbase or carrier with a free slot:
 *
 * - "bomb": a Bomber flies to the target, and inside bombRadius every enemy
 *   structure loses a level (a level-1 one is destroyed), enemy ships take
 *   bomberShipDamage and the tile owner loses a share of troops. Territory
 *   does not change. The bomber then flies home and frees its slot.
 * - "paratroop": a Transport Plane carries up to paratroopersPerBaseLevel *
 *   base level troops and drops them on the target as a bridgehead attack,
 *   exactly like a boat landing. Shot down, the troops are lost.
 */
export class AirStrikeExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;
  private home: Unit | null = null;
  private returning = false;

  constructor(
    private player: Player,
    private dst: TileRef,
    private kind: AirStrikeKind,
    private troops: number | null = null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.isValidRef(this.dst)) {
      this.active = false;
    }
  }

  private planeType(): UnitType.Bomber | UnitType.TransportPlane {
    return this.kind === "bomb" ? UnitType.Bomber : UnitType.TransportPlane;
  }

  tick(ticks: number): void {
    if (!this.active) return;
    if (this.plane === null) {
      this.launch();
      return;
    }
    if (!this.plane.isActive()) {
      // Shot down: paratroopers aboard are lost with the plane.
      this.active = false;
      return;
    }
    // Captured with its base: the sortie now flies for the captor.
    this.player = this.plane.owner();
    const config = this.mg.config();

    if (this.returning) {
      if (this.home === null || !this.home.isActive()) {
        this.plane.delete(false);
        this.active = false;
        return;
      }
      if (
        flyToward(this.mg, this.plane, this.home.tile(), config.bomberSpeed())
      ) {
        this.plane.delete(false);
        this.active = false;
      }
      return;
    }

    const speed =
      this.kind === "bomb" ? config.bomberSpeed() : config.transportPlaneSpeed();
    if (!flyToward(this.mg, this.plane, this.dst, speed)) {
      return;
    }
    if (this.kind === "bomb") {
      this.dropBombs();
      this.returning = true;
    } else {
      this.dropParatroopers();
      this.plane.delete(false);
      this.active = false;
    }
  }

  private launch(): void {
    const type = this.planeType();
    if (this.player.canBuild(type, this.dst) === false) {
      this.active = false;
      return;
    }
    const home = this.player.airBaseFor(this.dst, type);
    if (home === null) {
      this.active = false;
      return;
    }
    this.home = home;
    let troops = 0;
    if (this.kind === "paratroop") {
      const level =
        home.type() === UnitType.AircraftCarrier ? 2 : Math.max(1, home.level());
      const cap = this.mg.config().paratroopersPerBaseLevel() * level;
      const want =
        this.troops ??
        this.mg.config().attackAmount(this.player, this.mg.owner(this.dst));
      troops = Math.max(0, Math.min(want, cap, this.player.troops()));
      if (troops <= 0) {
        this.active = false;
        return;
      }
    }
    this.plane =
      type === UnitType.Bomber
        ? this.player.buildUnit(UnitType.Bomber, home.tile(), {
            targetUnit: home,
            targetTile: this.dst,
          })
        : this.player.buildUnit(UnitType.TransportPlane, home.tile(), {
            targetUnit: home,
            targetTile: this.dst,
            troops,
          });

    const target = this.mg.owner(this.dst);
    if (target.isPlayer() && target !== this.player) {
      this.mg.displayIncomingUnit(
        this.plane.id(),
        this.kind === "bomb"
          ? "events_display.air_raid_inbound"
          : "events_display.paratroopers_inbound",
        this.kind === "bomb"
          ? MessageType.AIR_RAID_INBOUND
          : MessageType.PARATROOPERS_INBOUND,
        target.id(),
      );
    }
  }

  private dropBombs(): void {
    const config = this.mg.config();
    const radius = config.bombRadius();
    const hits = this.mg.nearbyUnits(
      this.dst,
      radius,
      [...Structures.types, ...SHIP_TYPES],
      ({ unit }) =>
        isUnit(unit) &&
        unit.isActive() &&
        unit.owner() !== this.player &&
        !this.player.isFriendly(unit.owner(), true),
    );
    // Deterministic order: by unit id.
    hits.sort((a, b) => a.unit.id() - b.unit.id());
    for (const { unit } of hits) {
      const u = unit as Unit;
      if (!u.isActive()) continue;
      if (Structures.has(u.type())) {
        u.decreaseLevel(this.player);
      } else {
        // modifyHealth sinks the ship when it reaches zero.
        u.modifyHealth(-config.bomberShipDamage(), this.player);
      }
    }
    const owner = this.mg.owner(this.dst);
    if (
      owner.isPlayer() &&
      owner !== this.player &&
      !this.player.isFriendly(owner, true)
    ) {
      const lost = Math.min(
        Math.floor(owner.troops() * config.bomberTroopLossShare()),
        config.bomberMaxTroopLoss(),
      );
      owner.removeTroops(lost);
      owner.updateRelation(this.player, -50);
    }
  }

  private dropParatroopers(): void {
    if (this.plane === null) return;
    const troops = this.plane.troops();
    const mg = this.mg;
    if (!mg.isLand(this.dst) || mg.isImpassable(this.dst) || troops <= 0) {
      // Nowhere to land: the drop is wasted.
      return;
    }
    const owner = mg.owner(this.dst);
    if (owner === this.player) {
      this.player.addTroops(troops);
      return;
    }
    if (owner.isPlayer() && this.player.isFriendly(owner)) {
      this.player.addTroops(troops);
      return;
    }
    this.player.conquer(this.dst);
    mg.addExecution(
      new AttackExecution(
        troops,
        this.player,
        owner.isPlayer() ? owner.id() : null,
        this.dst,
        false,
      ),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirStrikeExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      dst: this.dst,
      kind: this.kind,
      troops: this.troops,
      plane: w.unitOrNull(this.plane),
      home: w.unitOrNull(this.home),
      returning: this.returning,
    });
  }

  restoreSnapshot(s: AirStrikeState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.kind = s.kind;
    this.troops = s.troops;
    this.plane = r.unitOrNull(s.plane);
    this.home = r.unitOrNull(s.home);
    this.returning = s.returning;
  }
}

const AirStrikeStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  // Untrusted intent data until init validates it.
  dst: zInt(),
  kind: z.enum(["bomb", "paratroop"]),
  troops: zNum().nullable(),
  plane: zRef().nullable(),
  home: zRef().nullable(),
  returning: z.boolean(),
});
type AirStrikeState = z.infer<typeof AirStrikeStateSchema>;

export const AirStrikeExecutionSnapshot = execSnapshotType({
  name: "AirStrike",
  version: 1,
  schema: AirStrikeStateSchema,
  cls: () => AirStrikeExecution,
});
