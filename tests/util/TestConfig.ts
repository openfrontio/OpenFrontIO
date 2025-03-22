import { DefaultConfig } from "../../src/core/configuration/DefaultConfig";

export class TestConfig extends DefaultConfig {
  samHittingChance(): number {
    return 1;
  }
}
