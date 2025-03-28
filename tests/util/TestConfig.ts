import { DefaultConfig } from "../../src/core/configuration/DefaultConfig";

export class TestConfig extends DefaultConfig {
  _proximityBonusPortsNb: number = 0;

  samHittingChance(): number {
    return 1;
  }

  radiusPortSpawn(): number {
    return 1;
  }

  proximityBonusPortsNb(totalPorts: number): number {
    return this._proximityBonusPortsNb;
  }

  // Specific to TestConfig
  setProximityBonusPortsNb(nb: number): void {
    this._proximityBonusPortsNb = nb;
  }
}
