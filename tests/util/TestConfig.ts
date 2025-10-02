import { NukeMagnitude } from "../../src/core/configuration/Config";
import { DefaultConfig } from "../../src/core/configuration/DefaultConfig";
import {
  Game,
  Player,
  TerraNullius,
  Tick,
  UnitType,
} from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";

export class TestConfig extends DefaultConfig {
  private _proximityBonusPortsNb: number = 0;
  private _defaultNukeSpeed: number = 4;

  samHittingChance(): number {
    return 1;
  }

  radiusPortSpawn(): number {
    return 1;
  }

  proximityBonusPortsNb(_totalPorts: number): number {
    return this._proximityBonusPortsNb;
  }

  // Specific to TestConfig
  setProximityBonusPortsNb(nb: number): void {
    this._proximityBonusPortsNb = nb;
  }

  nukeMagnitudes(_: UnitType): NukeMagnitude {
    return { inner: 1, outer: 1 };
  }

  setDefaultNukeSpeed(speed: number): void {
    this._defaultNukeSpeed = speed;
  }

  defaultNukeSpeed(): number {
    return this._defaultNukeSpeed;
  }

  defaultNukeTargetableRange(): number {
    return 20;
  }

  defaultSamRange(): number {
    return 20;
  }

  spawnImmunityDuration(): Tick {
    return 0;
  }

  attackLogic(
    _gm: Game,
    _attackTroops: number,
    _attacker: Player,
    _defender: Player | TerraNullius,
    _tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    return { attackerTroopLoss: 1, defenderTroopLoss: 1, tilesPerTickUsed: 1 };
  }

  attackTilesPerTick(
    _attackTroops: number,
    _attacker: Player,
    _defender: Player | TerraNullius,
    _numAdjacentTilesWithEnemy: number,
  ): number {
    return 1;
  }
}
