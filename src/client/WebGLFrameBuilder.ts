import { Colord } from "colord";
import { PlayerType, TrainType, UnitType } from "../core/game/Game";
import { GameUpdateType, GameUpdateViewData } from "../core/game/GameUpdates";
import { GameView } from "../core/game/GameView";
import { RailroadCache } from "./render/frame/railroad-cache";
import { TrailManager } from "./render/frame/trail-manager";
import {
  PlayerStatic,
  UnitState,
  GameView as WebGLGameView,
} from "./render/gl";
import {
  BonusEvent,
  ConquestFx,
  DeadUnitFx,
  PlayerTypeEnum,
  TrainType as RendererTrainType,
} from "./render/types";

const TRAIL_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.TransportShip,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
]);

const PALETTE_SIZE = 4096;

export class WebGLFrameBuilder {
  private readonly mapW: number;
  private readonly mapH: number;
  private readonly tileState: Uint16Array;
  private readonly palette: Float32Array;
  private readonly knownSmallIDs = new Set<number>();
  private readonly railroadCache: RailroadCache;
  private readonly trailManager: TrailManager;
  private readonly unitMap = new Map<number, UnitState>();
  private readonly trailIds: number[] = [];

  constructor(
    private readonly view: WebGLGameView,
    gameView: GameView,
  ) {
    this.mapW = gameView.width();
    this.mapH = gameView.height();
    this.tileState = new Uint16Array(this.mapW * this.mapH);
    this.palette = new Float32Array(PALETTE_SIZE * 2 * 4);
    this.railroadCache = new RailroadCache(this.mapW, this.mapH);
    this.trailManager = new TrailManager(this.mapW, this.mapH);
  }

  update(gameView: GameView, gu: GameUpdateViewData): void {
    this.syncPlayers(gameView);
    this.fillTileState(gameView);
    this.fillUnitMap(gameView);
    this.trailManager.update(this.unitMap, this.trailIds);
    this.view.uploadTileAndTrailState(
      this.tileState,
      this.trailManager.getTrailState(),
    );
    this.trailManager.clearDirtyRows();
    this.applyRailroads(gu);
    this.view.updateStructures(this.unitMap);
    this.view.updateUnits(this.unitMap, gameView.ticks());
    this.applyFxEvents(gameView, gu);
  }

  private applyFxEvents(gameView: GameView, gu: GameUpdateViewData): void {
    const deadUnits: DeadUnitFx[] = [];
    for (const u of gu.updates[GameUpdateType.Unit] ?? []) {
      if (u.isActive) continue;
      deadUnits.push({
        unitType: u.unitType,
        pos: u.pos,
        reachedTarget: u.reachedTarget,
      });
    }
    if (deadUnits.length > 0) {
      this.view.applyDeadUnits(deadUnits);
    }

    const conquests: ConquestFx[] = [];
    for (const c of gu.updates[GameUpdateType.ConquestEvent] ?? []) {
      const conquered = gameView.player(c.conqueredId);
      const loc = conquered.nameLocation();
      conquests.push({
        x: loc.x,
        y: loc.y,
        gold: Number(c.gold),
      });
    }
    if (conquests.length > 0) {
      this.view.applyConquestEvents(conquests);
    }

    const bonuses: BonusEvent[] = [];
    for (const b of gu.updates[GameUpdateType.BonusEvent] ?? []) {
      const player = gameView.player(b.player);
      bonuses.push({
        playerID: b.player,
        smallID: player.smallID(),
        tile: b.tile,
        gold: Number(b.gold),
        troops: b.troops,
      });
    }
    if (bonuses.length > 0) {
      this.view.applyBonusEvents(bonuses);
    }
  }

  private fillUnitMap(gameView: GameView): void {
    this.unitMap.clear();
    this.trailIds.length = 0;
    for (const u of gameView.units()) {
      this.unitMap.set(u.id(), toUnitState(u));
      if (TRAIL_TYPES.has(u.type())) {
        this.trailIds.push(u.id());
      }
    }
  }

  private applyRailroads(gu: GameUpdateViewData): void {
    this.railroadCache.apply(gu);
    if (this.railroadCache.railroadDirty) {
      this.view.uploadRailroadState(this.railroadCache.railroadState);
      this.railroadCache.clearDirty();
    }
    if (this.railroadCache.revealedRailTiles.length > 0) {
      this.view.applyRailroadDust(this.railroadCache.revealedRailTiles);
    }
  }

  private syncPlayers(gameView: GameView): void {
    const newPlayers: PlayerStatic[] = [];
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      if (this.knownSmallIDs.has(smallID)) continue;
      this.knownSmallIDs.add(smallID);

      this.writePaletteEntry(smallID, p.territoryColor(), p.borderColor());

      newPlayers.push({
        smallID,
        id: p.id(),
        name: p.name(),
        displayName: p.displayName(),
        clientID: p.clientID(),
        playerType: gamePlayerTypeToEnum(p.type()),
        team: p.team() ?? null,
        isLobbyCreator: p.isLobbyCreator(),
        color: p.territoryColor().toHex(),
      });
    }
    if (newPlayers.length > 0) {
      this.view.addPlayers(newPlayers, this.palette);
    }
  }

  private writePaletteEntry(
    smallID: number,
    fill: Colord,
    border: Colord,
  ): void {
    const fillRgba = fill.toRgb();
    const fillOff = smallID * 4;
    this.palette[fillOff] = fillRgba.r / 255;
    this.palette[fillOff + 1] = fillRgba.g / 255;
    this.palette[fillOff + 2] = fillRgba.b / 255;
    this.palette[fillOff + 3] = 150 / 255;

    const borderRgba = border.toRgb();
    const borderOff = PALETTE_SIZE * 4 + smallID * 4;
    this.palette[borderOff] = borderRgba.r / 255;
    this.palette[borderOff + 1] = borderRgba.g / 255;
    this.palette[borderOff + 2] = borderRgba.b / 255;
    this.palette[borderOff + 3] = 1.0;
  }

  private fillTileState(gameView: GameView): void {
    const w = this.mapW;
    const h = this.mapH;
    const buf = this.tileState;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ref = gameView.ref(x, y);
        let v = gameView.ownerID(ref) & 0x0fff;
        if (gameView.hasFallout(ref)) v |= 1 << 13;
        buf[y * w + x] = v;
      }
    }
  }
}

function toUnitState(u: import("../core/game/GameView").UnitView): UnitState {
  return {
    id: u.id(),
    unitType: u.type(),
    ownerID: u.owner().smallID(),
    lastOwnerID: null,
    pos: u.tile(),
    lastPos: u.lastTile(),
    isActive: u.isActive(),
    reachedTarget: u.reachedTarget(),
    retreating: false,
    targetable: u.targetable(),
    markedForDeletion: u.markedForDeletion(),
    health: u.hasHealth() ? u.health() : null,
    underConstruction: u.isUnderConstruction(),
    targetUnitId: u.targetUnitId() ?? null,
    targetTile: u.targetTile() ?? null,
    troops: u.troops(),
    missileTimerQueue: u.missileTimerQueue(),
    level: u.level(),
    hasTrainStation: u.hasTrainStation(),
    trainType: trainTypeToNum(u.trainType()),
    loaded: u.isLoaded() ?? null,
    constructionStartTick: u.isUnderConstruction() ? u.createdAt() : null,
  };
}

function trainTypeToNum(t: TrainType | undefined): number | null {
  switch (t) {
    case TrainType.Engine:
      return RendererTrainType.Engine;
    case TrainType.TailEngine:
      return RendererTrainType.TailEngine;
    case TrainType.Carriage:
      return RendererTrainType.Carriage;
    default:
      return null;
  }
}

function gamePlayerTypeToEnum(t: PlayerType): PlayerTypeEnum {
  switch (t) {
    case PlayerType.Human:
      return PlayerTypeEnum.Human;
    case PlayerType.Bot:
      return PlayerTypeEnum.Bot;
    case PlayerType.Nation:
      return PlayerTypeEnum.Nation;
    default:
      return PlayerTypeEnum.Bot;
  }
}
