import { createLogger, format, Logger, transports } from "winston";
import { DevServerConfig } from "../../src/core/configuration/DevConfig";
import { GameManager } from "../../src/server/GameManager";

let gm: GameManager;
let logger: Logger;

describe("GameServer", () => {
  beforeAll(() => {
    logger = createLogger({
      level: "info",
      format: format.json(),
      transports: [new transports.Console()],
    });
  });
  beforeEach(async () => {
    gm = new GameManager(new DevServerConfig(), logger);
  });
  test("GameServer has no clients", async () => {
    expect(gm.getClient("fakeclientid", "fakegameid")).toBeUndefined();
  });
});
