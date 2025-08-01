import { createLogger, format, Logger, transports } from "winston";
import { DevServerConfig } from "../../src/core/configuration/DevConfig";
import { GameManager } from "../../src/server/GameManager";
import { GameServer } from "../../src/server/GameServer";

let gm: GameManager;
let gameServer: GameServer;
let logger: Logger;

describe("GameServer and GameManager", () => {
  beforeAll(() => {
    logger = createLogger({
      level: "info",
      format: format.json(),
      transports: [new transports.Console()],
    });
  });

  beforeEach(async () => {
    gm = new GameManager(new DevServerConfig(), logger);
    gameServer = gm.createGame("000", undefined);
  });

  test("GameServer has no clients", async () => {
    expect(gm.activeClients()).toBe(0);
    expect(gameServer.activeClients.length).toBe(0);
  });
});
