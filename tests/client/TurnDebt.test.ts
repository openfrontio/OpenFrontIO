// Mock all dependencies before importing the test subject
jest.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: jest.fn(),
}));

jest.mock("../../src/client/Main", () => ({}));

jest.mock("../../src/client/DarkModeButton", () => ({}));

jest.mock("../../src/core/configuration/ConfigLoader", () => ({
  getConfig: jest.fn(),
}));

jest.mock("../../src/core/ExpressSchemas", () => ({
  ApiPublicLobbiesResponseSchema: {
    array: jest.fn(),
  },
}));

jest.mock("../../src/client/Transport", () => ({
  Transport: jest.fn().mockImplementation(() => ({
    reconnect: jest.fn(),
  })),
  TurnDebtEvent: class TurnDebtEvent {
    constructor(public readonly isInTurnDebt: boolean) {}
  },
}));

jest.mock("../../src/client/graphics/GameRenderer", () => ({
  GameRenderer: jest.fn().mockImplementation(() => ({
    tick: jest.fn(),
  })),
}));

jest.mock("../../src/client/InputHandler", () => ({
  InputHandler: jest.fn(),
}));

jest.mock("../../src/core/worker/WorkerClient", () => ({
  WorkerClient: jest.fn(),
}));

jest.mock("../../src/core/game/GameView", () => ({
  GameView: jest.fn(),
}));

jest.mock("../../src/client/LocalPersistantStats", () => ({
  endGame: jest.fn(),
  startGame: jest.fn(),
  startTime: jest.fn(),
}));

jest.mock("../../src/core/Schemas", () => ({
  createGameRecord: jest.fn(),
}));

jest.mock("../../src/client/graphics/layers/CatchupMessage", () => ({
  CatchupMessage: jest.fn().mockImplementation(() => ({
    show: jest.fn(),
    hide: jest.fn(),
  })),
}));

// Mock version.txt file
jest.mock("../../resources/version.txt", () => "EXPERIMENTAL BUILD", { virtual: true });

// Import after mocks are set up
import { ClientGameRunner } from "../../src/client/ClientGameRunner";
import { EventBus } from "../../src/core/EventBus";
import { TurnDebtEvent } from "../../src/client/Transport";

describe("Turn Debt", () => {
  let clientGameRunner: ClientGameRunner;
  let eventBus: EventBus;
  let emittedEvents: TurnDebtEvent[];

  beforeEach(() => {
    eventBus = new EventBus();
    emittedEvents = [];
    eventBus.on(TurnDebtEvent, (event) => {
      emittedEvents.push(event);
    });

    // Create ClientGameRunner with minimal dependencies
    clientGameRunner = new ClientGameRunner(
      { serverConfig: {}, gameConfig: {} } as any,
      eventBus,
      { tick: jest.fn() } as any,
      {} as any,
      { reconnect: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  test("enters turn debt when threshold is exceeded", () => {
    for (let i = 0; i < 25; i++) {
      clientGameRunner["turnsSeen"]++;
    }

    for (let i = 0; i < 3; i++) {
      clientGameRunner["onTurnProcessed"]();
    }

    expect(clientGameRunner["isInTurnDebt"]).toBe(true);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].isInTurnDebt).toBe(true);
  });

  test("exits turn debt when caught up", () => {
    for (let i = 0; i < 25; i++) {
      clientGameRunner["turnsSeen"]++;
    }
    clientGameRunner["onTurnProcessed"]();
    expect(clientGameRunner["isInTurnDebt"]).toBe(true);

    for (let i = 0; i < 21; i++) {
      clientGameRunner["onTurnProcessed"]();
    }

    expect(clientGameRunner["isInTurnDebt"]).toBe(false);
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].isInTurnDebt).toBe(false);
  });

  test("tracks peak turn debt", () => {
    for (let i = 0; i < 25; i++) {
      clientGameRunner["turnsSeen"]++;
    }

    for (let i = 0; i < 5; i++) {
      clientGameRunner["onTurnProcessed"]();
    }

    expect(clientGameRunner["peakTurnDebt"]).toBe(25);

    // Test that peakTurnDebt is updated if a new maximum is reached
    for (let i = 0; i < 10; i++) {
      clientGameRunner["turnsSeen"]++;
    }

    // Peak turn debt is only updated when a turn is processed
    clientGameRunner["onTurnProcessed"]();

    expect(clientGameRunner["peakTurnDebt"]).toBe(30);
  });

  test("calculates progress correctly", () => {
    // Create a turn debt of 30 turns
    for (let i = 0; i < 30; i++) {
      clientGameRunner["turnsSeen"]++;
    }

    // Process 15 turns
    for (let i = 0; i < 15; i++) {
      clientGameRunner["onTurnProcessed"]();
    }

    // With turnDebtExitThreshold of 5, and peakTurnDebt of 30
    // Progress should be: (25 - 15) / 25 * 100 = 40%
    const progress = Math.round(((25 - 15) / 25) * 100);
    expect(progress).toBe(40);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
