import Benchmark from "benchmark";
import { EventEmitter } from "events";
import { Logger } from "winston";
import { GameEnv, ServerConfig } from "../../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { GameConfig } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  send(data: any) {}
  close() {
    this.emit("close");
  }
}

// Mock Logger
const mockLogger = {
  child: () => mockLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

// Mock Config
const mockConfig = {
  env: () => GameEnv.Dev,
  turnIntervalMs: () => 200,
} as unknown as ServerConfig;

// Setup GameServer
function setupGameServer(numClients: number) {
  const gameConfig: GameConfig = {
    gameType: GameType.Private,
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    difficulty: Difficulty.Easy,
    disableNations: false,
    bots: 0,
    infiniteGold: false,
    donateGold: false,
    infiniteTroops: false,
    donateTroops: false,
    maxTimerValue: 0,
    instantBuild: false,
    randomSpawn: false,
    spawnImmunityDuration: 0,
    gameMode: GameMode.FFA,
    disabledUnits: [],
    playerTeams: undefined,
    goldMultiplier: 1,
    startingGold: 1000,
  };

  const server = new GameServer(
    "perf_test_game",
    mockLogger,
    Date.now(),
    mockConfig,
    gameConfig,
    "creator_id",
  );

  for (let i = 0; i < numClients; i++) {
    const ws = new MockWebSocket() as any;
    const client = new Client(
      `client_${i}`,
      `persistent_${i}`,
      null,
      [],
      [],
      "127.0.0.1",
      `User${i}`,
      ws,
      {},
    );
    // Explicitly casting Client to any to inject it or use public methods
    server.joinClient(client);
  }

  server.start();
  return server;
}

const suite = new Benchmark.Suite();

// Scenario 1: EndTurn
const serverTurn = setupGameServer(100);

function simulateTurnActivity(server: GameServer, numIntents: number) {
  for (let i = 0; i < numIntents; i++) {
    // We manually push intents or just assume they are there
    (server as any).addIntent({
      type: "attack",
      clientID: `client_${i % 100}`,
      origin: { x: 0, y: 0 },
      target: { x: 10, y: 10 },
      amount: 10,
    });
  }
}

suite.add("GameServer.endTurn (100 clients, 100 intents)", () => {
  simulateTurnActivity(serverTurn, 100);
  (serverTurn as any).endTurn();
  (serverTurn as any).turnsAsJSON = [];
});

// Scenario 2: Message Parsing (Throughput)
const serverMsg = setupGameServer(100);
const clientToCheck = serverMsg.activeClients[0];
const msgIntent = JSON.stringify({
  type: "intent",
  intent: {
    type: "attack",
    clientID: clientToCheck.clientID,
    targetID: "target_id",
    troops: 10,
  },
});
const msgPing = JSON.stringify({ type: "ping" });

suite.add("Message Parsing (Intent - Fast Path)", () => {
  // Simulate WS message
  clientToCheck.ws.emit("message", msgIntent);
});

suite.add("Message Parsing (Ping - Fast Path)", () => {
  clientToCheck.ws.emit("message", msgPing);
});

suite
  .on("cycle", (event: any) => {
    console.log(String(event.target));
  })
  .on("complete", () => {
    console.log("Benchmark complete");
  })
  .run({ async: true });
