import { DefaultConfig } from "../src/core/configuration/DefaultConfig";
import { createGameConfig } from "./util/Setup";
import { TestServerConfig } from "./util/TestServerConfig";

describe("Config", () => {
  test("Trade ship spawn rate", async () => {
    const config = new DefaultConfig(
      new TestServerConfig(),
      createGameConfig(),
      null,
      false,
    );

    expect(config.tradeShipSpawnRate(0)).toBe(5);
    expect(config.tradeShipSpawnRate(1)).toBe(5);
    expect(config.tradeShipSpawnRate(20)).toBe(5);
    expect(config.tradeShipSpawnRate(21)).toBe(6);
    expect(config.tradeShipSpawnRate(30)).toBe(15);
    expect(config.tradeShipSpawnRate(50)).toBe(35);
    expect(config.tradeShipSpawnRate(100)).toBe(85);
    expect(config.tradeShipSpawnRate(151)).toBe(1_000_000);
  });
});
