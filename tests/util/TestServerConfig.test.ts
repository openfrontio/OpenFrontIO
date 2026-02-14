import { describe, expect, it } from "vitest";
import { GameEnv } from "../../src/core/configuration/Config";
import { TestServerConfig } from "./TestServerConfig";

describe("TestServerConfig", () => {
  it("provides deterministic non-throwing defaults", async () => {
    const config = new TestServerConfig();

    expect(config.turnIntervalMs()).toBe(100);
    expect(config.gameCreationRate()).toBe(60_000);
    expect(config.numWorkers()).toBe(1);
    expect(config.workerPath("game-1")).toBe("w0");
    expect(config.workerPort("game-1")).toBe(3001);
    expect(config.env()).toBe(GameEnv.Dev);
    expect(config.jwtAudience()).toBe("localhost");
    expect(config.jwtIssuer()).toBe("http://localhost:8787");
    expect(await config.lobbyMaxPlayers()).toBe(64);
    expect(await config.supportsCompactMapForTeams()).toBe(true);

    const jwk = await config.jwkPublicKey();
    expect(jwk.kty).toBe("OKP");
  });
});
