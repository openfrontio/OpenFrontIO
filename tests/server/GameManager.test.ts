import { jest } from "@jest/globals";

import { createLogger, format, Logger, transports } from "winston";
import { DevServerConfig } from "../../src/core/configuration/DevConfig";
import { Client } from "../../src/server/Client";
import { GameManager } from "../../src/server/GameManager";
import { GameServer } from "../../src/server/GameServer";

jest.mock("ws", () => {
  return {
    default: jest.fn().mockImplementation(() => ({})),
    Server: jest.fn(),
  };
});

import { WebSocket } from "ws";

const mockSocket = {
  send: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
  terminate: jest.fn(),
  ping: jest.fn(),
  pong: jest.fn(),
  readyState: 1,
  isPaused: false,
  removeAllListeners: jest.fn(),
} as unknown as WebSocket;

let gm: GameManager;
let gameServer1: GameServer;
let gameServer2: GameServer;
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
    gameServer1 = gm.createGame("001", undefined);
    gameServer2 = gm.createGame("002", undefined);
  });

  test("GameServer client counting is working correctly", async () => {
    expect(gm.activeClients()).toBe(0);
    expect(gameServer1.numClients()).toBe(0);
    expect(gameServer2.numClients()).toBe(0);

    const emptyStringArray: string[] = [];

    gameServer1.addClient(
      new Client(
        "fakeclientid1",
        "persistentid1",
        null,
        emptyStringArray,
        emptyStringArray,
        "ip1",
        "username1",
        mockSocket,
        undefined,
        undefined,
      ),
      0,
    );

    expect(gm.activeClients()).toBe(1);
    expect(gameServer1.numClients()).toBe(1);
    expect(gameServer2.numClients()).toBe(0);

    gameServer1.addClient(
      new Client(
        "fakeclientid2",
        "persistentid2",
        null,
        emptyStringArray,
        emptyStringArray,
        "ip2",
        "username2",
        mockSocket,
        undefined,
        undefined,
      ),
      0,
    );
    gameServer2.addClient(
      new Client(
        "fakeclientid3",
        "persistentid3",
        null,
        emptyStringArray,
        emptyStringArray,
        "ip3",
        "username3",
        mockSocket,
        undefined,
        undefined,
      ),
      0,
    );

    expect(gm.activeClients()).toBe(3);
    expect(gameServer1.numClients()).toBe(2);
    expect(gameServer2.numClients()).toBe(1);
  });
});
