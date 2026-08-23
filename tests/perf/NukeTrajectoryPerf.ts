import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import {
  buildNukeTrajectory,
  SAMInfo,
} from "../../src/client/render/gl/utils/NukeTrajectory";
import { PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

// Setup giant world map scenario with 2 players for in-game pipeline testing
const giantMapGame = await setup(
  "giantworldmap",
  { infiniteGold: true, instantBuild: true },
  [
    new PlayerInfo("player1", PlayerType.Human, "client_id1", "my_player_id"),
    new PlayerInfo("enemy", PlayerType.Bot, "client_id2", "enemy_player_id"),
  ],
  dirname(fileURLToPath(import.meta.url)),
);

const myPlayer = giantMapGame.player("my_player_id");
const enemyPlayer = giantMapGame.player("enemy_player_id");
const mapH = giantMapGame.map().height();

// Conquer land to place units (split territory between players)
console.log("Setting up in-game board state (500 mixed units)...");
for (let x = 0; x < giantMapGame.map().width(); x += 10) {
  for (let y = 0; y < giantMapGame.map().height(); y += 10) {
    const tile = giantMapGame.ref(x, y);
    if (giantMapGame.map().isLand(tile)) {
      if ((x + y) % 20 === 0) {
        myPlayer.conquer(tile);
      } else {
        enemyPlayer.conquer(tile);
      }
    }
  }
}

// Build my missile silo
const mySiloTile = giantMapGame.ref(25, 2);
myPlayer.buildUnit(UnitType.MissileSilo, mySiloTile, {});

// Populate mixed units (Factories, Cities, Silos, SAMs) across the map
const unitTypes = [
  UnitType.MissileSilo,
  UnitType.Factory,
  UnitType.SAMLauncher,
  UnitType.City,
];
let unitCount = 0;

for (let x = 1; x < giantMapGame.map().width(); x += 3) {
  for (let y = 1; y < giantMapGame.map().height(); y += 3) {
    if (unitCount >= 500) break;
    const tile = giantMapGame.ref(x, y);
    if (giantMapGame.map().isLand(tile)) {
      const isMine = unitCount % 2 === 0;
      const type = unitTypes[unitCount % unitTypes.length];
      const player = isMine ? myPlayer : enemyPlayer;
      const forceSam =
        x >= 8 && x <= 22 && !isMine ? UnitType.SAMLauncher : type;
      player.buildUnit(forceSam, tile, {});
      unitCount++;
    }
  }
}

// Exact mock scenarios for mathematical comparisons
const sparseSams: SAMInfo[] = [
  { x: 300, y: 300, r: 120 },
  { x: 450, y: 250, r: 90 },
  { x: 600, y: 400, r: 150 },
  { x: 800, y: 350, r: 100 },
  { x: 950, y: 300, r: 80 },
];

const denseSams: SAMInfo[] = Array.from({ length: 20 }, (_, k) => ({
  x: 200 + k * 40,
  y: 200 + (k % 5) * 100,
  r: 70 + (k % 4) * 10,
}));

const giantSams: SAMInfo[] = Array.from({ length: 100 }, (_, k) => ({
  x: 100 + (k % 10) * 350,
  y: 100 + Math.floor(k / 10) * 180,
  r: 110,
}));

// In-game: Starting nuke trajectory render extracts static SAM list ONCE
function startNukeTrajectoryRender(): {
  srcX: number;
  srcY: number;
  directionUp: boolean;
  sams: SAMInfo[];
} {
  const extractedSams: SAMInfo[] = [];
  const mapWidth = giantMapGame.map().width();

  for (const u of giantMapGame.units()) {
    if (
      u.type() === UnitType.SAMLauncher &&
      u.owner().id() !== "my_player_id" &&
      u.isActive()
    ) {
      extractedSams.push({
        x: u.tile() % mapWidth,
        y: Math.floor(u.tile() / mapWidth),
        r: 150 - 480 / (u.level() + 5),
      });
    }
  }

  return {
    srcX: mySiloTile % mapWidth,
    srcY: Math.floor(mySiloTile / mapWidth),
    directionUp: true,
    sams: extractedSams,
  };
}

const inGameStaticTrajectory = startNukeTrajectoryRender();

// Simulated mouse motion path
let mouseTick = 0;
function getSimulatedMousePos() {
  mouseTick++;
  return {
    x: 859 + Math.sin(mouseTick * 0.1) * 100,
    y: 397 + Math.cos(mouseTick * 0.1) * 100,
  };
}

const srcX = 1249;
const srcY = 108;
const dstX = 859;
const dstY = 397;

const results: string[] = [];

new Benchmark.Suite()
  .add("Scenario 1: 0 SAMs (Early game)", () => {
    buildNukeTrajectory(srcX, srcY, dstX, dstY, mapH, true, []);
  })
  .add("Scenario 2: 5 SAMs (Active Intercept)", () => {
    buildNukeTrajectory(srcX, srcY, dstX, dstY, mapH, true, sparseSams);
  })
  .add("Scenario 3: 20 SAMs (Mid-Late Game)", () => {
    buildNukeTrajectory(srcX, srcY, dstX, dstY, mapH, true, denseSams);
  })
  .add("Scenario 4: 100 SAMs (Giant World Map Endgame)", () => {
    buildNukeTrajectory(srcX, srcY, dstX, dstY, mapH, true, giantSams);
  })
  .add("In-Game Phase 1: Start Render (Find Silo + Extract SAMs)", () => {
    startNukeTrajectoryRender();
  })
  .add(
    "In-Game Phase 2: Live Cursor Move (60 FPS per-frame trajectory update)",
    () => {
      const mouse = getSimulatedMousePos();
      buildNukeTrajectory(
        inGameStaticTrajectory.srcX,
        inGameStaticTrajectory.srcY,
        mouse.x,
        mouse.y,
        mapH,
        inGameStaticTrajectory.directionUp,
        inGameStaticTrajectory.sams,
      );
    },
  )
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== NukeTrajectory Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
