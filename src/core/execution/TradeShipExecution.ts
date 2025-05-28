import { renderNumber } from "../../client/Utils";
import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { distSortUnit } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private origOwner: Player | null = null;
  private tradeShip: Unit | null = null;
  private wasCaptured = false;
  private tilesTraveled = 0;
  private aStar: AStar | null = null;

  constructor(
    private _owner: PlayerID,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.origOwner = mg.player(this._owner);
  }

  tick(ticks: number): void {
    if (this.mg === null || this.origOwner === null) {
      throw new Error("Not initialized");
    }
    if (this.tradeShip === null) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        consolex.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });

      // Record stats
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    if (this.origOwner !== this.tradeShip.owner()) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (this._dstPort.owner().id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() ||
        !this.tradeShip.owner().canTrade(this._dstPort.owner()))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (this.wasCaptured) {
      const ports = this.tradeShip
        .owner()
        .units(UnitType.Port)
        .sort(distSortUnit(this.mg, this.tradeShip));
      if (ports.length === 0) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = ports[0];
        this.tradeShip.setTargetUnit(this._dstPort);
      }
    }

    const cachedNextTile = this._dstPort.cacheGet(this.tradeShip.tile());
    if (cachedNextTile !== undefined) {
      this.moveTradeShip(cachedNextTile);
      return;
    }

    this.computeNewPath();
  }

  private fillCachePath(port: Unit, path: TileRef[]): void {
    if (path.length < 2) {
      throw new Error("path must have at least 2 points");
    }
    for (let i = 0; i < path.length - 1; i++) {
      if (port.cacheGet(path[i]) !== undefined) {
        continue;
      }
      const from = path[i];
      const to = path[i + 1];
      port.cachePut(from, to);
    }
  }

  private moveTradeShip(nextTile?: TileRef): void {
    if (nextTile === undefined) {
      throw new Error("missing tile");
    }

    if (nextTile === this._dstPort.tile()) {
      this.complete();
      return;
    }
    // Update safeFromPirates status
    if (this.mg!.isWater(nextTile) && this.mg!.isShoreline(nextTile)) {
      this.tradeShip!.setSafeFromPirates();
    }
    this.tradeShip!.move(nextTile);
    this.tilesTraveled++;
  }

  private computeNewPath(): void {
    if (this.aStar === null) {
      this.aStar = new MiniAStar(
        this.mg!,
        this.mg!.miniMap(),
        this.tradeShip!.tile(),
        this._dstPort.tile(),
        2500,
        20,
      );
    }

    switch (this.aStar.compute()) {
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.tradeShip!.touch();
        break;
      case PathFindResultType.Completed: {
        const fullPath = this.aStar.reconstructPath();
        if (fullPath === null || fullPath.length === 0) {
          throw new Error("missing path");
        }
        this.fillCachePath(this._dstPort, fullPath);
        if (!this.wasCaptured) {
          this.fillCachePath(this.srcPort, fullPath.slice().reverse());
        }
        this.moveTradeShip(fullPath.shift());
        break;
      }
      case PathFindResultType.PathNotFound:
        consolex.warn("trade ship cannot find route");
        this.tradeShip?.delete(false);
        this.active = false;
        break;
      default:
        throw new Error("unexpected path finding compute result");
    }
  }

  private complete() {
    if (this.mg === null || this.origOwner === null) {
      throw new Error("Not initialized");
    }
    if (this.tradeShip === null) return;
    this.active = false;
    this.tradeShip.delete(false);
    const gold = this.mg.config().tradeShipGold(this.tilesTraveled);

    if (this.wasCaptured) {
      const player = this.tradeShip.owner();
      player.addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from ship captured from ${this.origOwner.displayName()}`,
        MessageType.SUCCESS,
        this.tradeShip.owner().id(),
      );

      // Record stats
      this.mg.stats().boatCapturedTrade(player, this.origOwner, gold);
    } else {
      this.srcPort.owner().addGold(gold);
      this._dstPort.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.srcPort.owner().displayName()}`,
        MessageType.SUCCESS,
        this._dstPort.owner().id(),
      );
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this._dstPort.owner().displayName()}`,
        MessageType.SUCCESS,
        this.srcPort.owner().id(),
      );

      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}
