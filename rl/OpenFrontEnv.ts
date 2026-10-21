/**
 * A single-agent, headless OpenFront environment for reinforcement learning.
 *
 * Wraps the real deterministic engine (GameRunner + Executor + EngineConfig)
 * with a Gym-style API. One "decision" = one agent action followed by
 * `decisionInterval` simulation ticks, so the agent acts at a fixed game-time
 * cadence regardless of how fast the wall clock runs.
 *
 * Observation (all values roughly in [0, 1]):
 *   spatial  C x G x G   density channels over a G x G grid laid on the map
 *   scalars  S           economy / military / diplomacy summary + neighbour slots
 *   masks    uint8       legality of each action head (see ACTION_* below)
 *
 * Action (factored): type, slot, ratio, cell. Which of slot/ratio/cell matter
 * depends on `type` (see TYPE_USES in rl/protocol.ts).
 */
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig, GameStartInfo } from "@openfront/engine-api/Schemas";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Game, Player } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import { createNationsForGame } from "@openfront/engine/game/NationCreation";
import { GameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../tests/perf/fullgame/NodeGameMapLoader";
import {
  ActionType,
  NUM_RATIOS,
  NUM_SLOTS,
  RATIOS,
  TYPE_COUNT,
} from "./protocol";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_CLIENT_ID = "AgentRL1";

export interface EnvOptions {
  map: string; // GameMapType key, case-insensitive (e.g. "world")
  compact: boolean; // use the 4x-downscaled map (much faster)
  bots: number; // tribe bots
  nations: "default" | "disabled" | number;
  difficulty: string; // Easy | Medium | Hard | Impossible
  grid: number; // G
  decisionInterval: number; // ticks per agent decision
  maxDecisions: number; // episode time limit, in decisions (after spawn)
  seed: number;
  instantBuild: boolean;
}

export const DEFAULT_ENV_OPTIONS: EnvOptions = {
  map: "world",
  compact: true,
  bots: 50,
  nations: "default",
  difficulty: "Medium",
  grid: 32,
  decisionInterval: 10,
  maxDecisions: 600,
  seed: 0,
  instantBuild: false,
};

export const NUM_CHANNELS = 8;
export const NUM_SCALARS = 24 + NUM_SLOTS * 6 + NUM_RATIOS * 0;
export const NUM_MASK_CELL_KINDS = 5;

export interface Dims {
  channels: number;
  grid: number;
  scalars: number;
  maskSize: number;
  numTypes: number;
  numSlots: number;
  numRatios: number;
  cellKinds: number;
}

export function dimsFor(grid: number): Dims {
  return {
    channels: NUM_CHANNELS,
    grid,
    scalars: NUM_SCALARS,
    maskSize: TYPE_COUNT + NUM_SLOTS * 2 + NUM_MASK_CELL_KINDS * grid * grid,
    numTypes: TYPE_COUNT,
    numSlots: NUM_SLOTS,
    numRatios: NUM_RATIOS,
    cellKinds: NUM_MASK_CELL_KINDS,
  };
}

export interface StepResult {
  /** simulation ticks advanced by this step */
  ticks: number;
  reward: number;
  done: boolean;
  won: boolean;
  /** only meaningful when done */
  stats: { tileFraction: number; rank: number; length: number; ret: number };
}

// Cell-mask kinds (index into the cell mask block).
const CELL_OWN = 0; // cells where I own land
const CELL_OWN_SHORE = 1; // cells where I own shoreline
const CELL_LAND_FREE = 2; // land not owned by me (boat targets / spawn)
const CELL_SHORE_FREE = 3; // shoreline not owned by me
const CELL_HOSTILE = 4; // cells owned by someone hostile (nuke targets)

const BUILD_UNIT: Partial<Record<ActionType, UnitType>> = {
  [ActionType.City]: UnitType.City,
  [ActionType.Port]: UnitType.Port,
  [ActionType.DefensePost]: UnitType.DefensePost,
  [ActionType.Factory]: UnitType.Factory,
  [ActionType.Silo]: UnitType.MissileSilo,
  [ActionType.Sam]: UnitType.SAMLauncher,
  [ActionType.Warship]: UnitType.Warship,
  [ActionType.AtomBomb]: UnitType.AtomBomb,
};

const BUILD_CELL_KIND: Partial<Record<ActionType, number>> = {
  [ActionType.City]: CELL_OWN,
  [ActionType.Port]: CELL_OWN_SHORE,
  [ActionType.DefensePost]: CELL_OWN,
  [ActionType.Factory]: CELL_OWN,
  [ActionType.Silo]: CELL_OWN,
  [ActionType.Sam]: CELL_OWN,
  [ActionType.Warship]: CELL_OWN_SHORE,
  [ActionType.AtomBomb]: CELL_HOSTILE,
  [ActionType.Boat]: CELL_SHORE_FREE,
  [ActionType.Spawn]: CELL_LAND_FREE,
};

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) throw new Error(`unknown map "${name}"`);
  return GameMapType[key as keyof typeof GameMapType];
}

function resolveDifficulty(name: string): Difficulty {
  const v = Object.values(Difficulty).find(
    (d) => d.toLowerCase() === name.toLowerCase(),
  );
  if (v === undefined) throw new Error(`unknown difficulty "${name}"`);
  return v;
}

export class OpenFrontEnv {
  readonly dims: Dims;
  private mapLoader = new NodeGameMapLoader(path.join(REPO_ROOT, "resources/maps"));

  private game!: Game;
  private runner!: GameRunner;
  private agent: Player | null = null;
  private turn = 0;
  private fatal: string | undefined;

  private decisions = 0;
  private episodeReturn = 0;
  private episodeCount = 0;
  private maxTroopsCache = 1;

  // reward-shaping state
  private prevTileFrac = 0;
  private prevCities = 0;
  private prevPorts = 0;
  private prevOther = 0;

  // per-grid-cell sampling tables (built per map)
  private cellSamples: Int32Array[] = []; // tile refs per cell
  private cellOfSample: Int32Array = new Int32Array(0);

  // reusable per-observation buffers
  private cellInfo: { x: number; y: number }[] = [];
  private slotPlayers: (Player | null)[] = new Array(NUM_SLOTS).fill(null);
  private costs = new Map<UnitType, bigint>();

  constructor(
    private opts: EnvOptions,
    readonly envIndex: number,
  ) {
    this.dims = dimsFor(opts.grid);
  }

  // ───────────────────────── lifecycle ─────────────────────────

  async reset(seed?: number): Promise<void> {
    const s = seed ?? this.opts.seed + this.episodeCount * 7919 + this.envIndex * 104729;
    this.episodeCount++;
    const gameMap = resolveMap(this.opts.map);
    const gameConfig: GameConfig = {
      gameMap,
      gameMapSize: this.opts.compact ? GameMapSize.Compact : GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      difficulty: resolveDifficulty(this.opts.difficulty),
      nations: this.opts.nations,
      donateGold: false,
      donateTroops: false,
      bots: this.opts.bots,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: this.opts.instantBuild,
      randomSpawn: false,
    };
    const gameID = `rl${(s >>> 0).toString(36)}x${this.envIndex}`.padEnd(8, "0").slice(0, 10);
    const gameStart: GameStartInfo = {
      gameID,
      lobbyCreatedAt: 0,
      config: gameConfig,
      players: [
        {
          clientID: AGENT_CLIENT_ID,
          username: "Agent",
        } as GameStartInfo["players"][number],
      ],
    };
    const config = new EngineConfig(gameConfig, false);
    const terrain = await loadTerrainMap(
      await loadMapFiles(this.mapLoader, gameConfig.gameMap, gameConfig.gameMapSize),
    );
    const random = new PseudoRandom(simpleHash(gameID));
    const human = new PlayerInfo(
      "Agent",
      PlayerType.Human,
      AGENT_CLIENT_ID,
      random.nextID(),
    );
    const nations = createNationsForGame(
      gameStart,
      terrain.nations,
      terrain.additionalNations,
      1,
      random,
    );
    this.game = createGame(
      [human],
      nations,
      terrain.gameMap,
      terrain.miniGameMap,
      config,
      terrain.teamGameSpawnAreas,
    );
    this.fatal = undefined;
    this.runner = new GameRunner(
      this.game,
      new Executor(this.game, gameID, AGENT_CLIENT_ID),
      (gu) => {
        if ("errMsg" in gu) this.fatal = `${gu.errMsg}\n${gu.stack ?? ""}`;
      },
    );
    this.runner.init();
    this.turn = 0;
    this.decisions = 0;
    this.episodeReturn = 0;
    this.agent = null;
    this.buildCellTables();
    // Run one tick so the human player is registered with the game.
    this.tickOnce([]);
    this.agent = this.game.playerByClientID(AGENT_CLIENT_ID);
    this.prevTileFrac = 0;
    this.prevCities = this.prevPorts = this.prevOther = 0;
  }

  // ───────────────────────── stepping ─────────────────────────

  /** Applies the action, advances decisionInterval ticks, returns reward/done. */
  step(type: number, slot: number, ratio: number, cell: number): StepResult {
    const startTick = this.game.ticks();
    const res = this.stepInner(type, slot, ratio, cell);
    res.ticks = this.game.ticks() - startTick;
    return res;
  }

  private stepInner(type: number, slot: number, ratio: number, cell: number): StepResult {
    const agent = this.agent!;
    if (this.game.inSpawnPhase()) {
      return this.stepSpawn(cell);
    }

    const intents = this.actionToIntents(agent, type, slot, ratio, cell);
    let legal = intents.length > 0 || type === ActionType.Noop;
    this.tickOnce(intents);
    for (let i = 1; i < this.opts.decisionInterval; i++) this.tickOnce([]);
    this.decisions++;

    let reward = legal ? 0 : -0.002;
    reward += this.shapedReward(agent);

    const alive = agent.isAlive();
    const winner = this.game.getWinner();
    const won = winner !== null && this.isAgentWinner(winner);
    const over = winner !== null || !alive || this.fatal !== undefined;
    const truncated = this.decisions >= this.opts.maxDecisions;
    let done = false;
    if (over || truncated) {
      done = true;
      const frac = this.tileFraction(agent);
      if (won) reward += 10;
      else if (!alive) reward -= 2;
      else reward += 4 * frac + 2 * (1 - (this.rank(agent) - 1) / Math.max(1, this.livePlayers()));
    }
    this.episodeReturn += reward;
    return {
      ticks: 0,
      reward,
      done,
      won,
      stats: {
        tileFraction: this.tileFraction(agent),
        rank: alive ? this.rank(agent) : this.livePlayers() + 1,
        length: this.decisions,
        ret: this.episodeReturn,
      },
    };
  }

  private stepSpawn(cell: number): StepResult {
    const agent = this.agent!;
    const tile = this.pickTileInCell(cell, (t) => this.isSpawnable(t));
    const intents: any[] = [];
    if (tile !== null) intents.push({ type: "spawn", tile });
    this.tickOnce(intents);
    while (this.game.inSpawnPhase() && this.fatal === undefined) this.tickOnce([]);
    // Let the spawn settle and the first territory appear.
    for (let i = 0; i < 2; i++) this.tickOnce([]);
    const spawned = agent.hasSpawned() && agent.isAlive();
    if (!spawned) {
      return {
        ticks: 0,
        reward: -1,
        done: true,
        won: false,
        stats: { tileFraction: 0, rank: this.livePlayers() + 1, length: 0, ret: -1 },
      };
    }
    this.prevTileFrac = this.tileFraction(agent);
    return {
      ticks: 0,
      reward: 0,
      done: false,
      won: false,
      stats: { tileFraction: this.prevTileFrac, rank: 0, length: 0, ret: 0 },
    };
  }

  private tickOnce(intents: any[]): void {
    this.runner.addTurn({
      turnNumber: this.turn++,
      intents: intents.map((i) => ({ ...i, clientID: AGENT_CLIENT_ID })),
    });
    this.runner.executeNextTick();
  }

  private isAgentWinner(winner: unknown): boolean {
    const w = winner as { clientID?: () => string | null };
    return typeof w?.clientID === "function" && w.clientID() === AGENT_CLIENT_ID;
  }

  // ───────────────────────── actions ─────────────────────────

  private actionToIntents(
    agent: Player,
    type: number,
    slot: number,
    ratioIdx: number,
    cell: number,
  ): any[] {
    const ratio = RATIOS[Math.max(0, Math.min(NUM_RATIOS - 1, ratioIdx))];
    switch (type) {
      case ActionType.Noop:
        return [];
      case ActionType.Attack: {
        const target = this.slotPlayers[slot];
        if (slot !== 0 && target === null) return [];
        if (slot !== 0 && !agent.sharesBorderWith(target!)) return [];
        if (slot !== 0 && agent.isFriendly(target!)) return [];
        const troops = agent.troops() * ratio;
        if (troops < 1) return [];
        return [
          { type: "attack", targetID: slot === 0 ? null : target!.id(), troops },
        ];
      }
      case ActionType.Boat: {
        const tile = this.pickTileInCell(cell, (t) => this.isBoatTarget(agent, t));
        const troops = agent.troops() * ratio;
        if (tile === null || troops < 1) return [];
        return [{ type: "boat", dst: tile, troops }];
      }
      case ActionType.AllyRequest: {
        const target = this.slotPlayers[slot];
        if (target === null || slot === 0) return [];
        if (!agent.canSendAllianceRequest(target)) return [];
        return [{ type: "allianceRequest", recipient: target.id() }];
      }
      case ActionType.AcceptAlliance: {
        const req = agent.incomingAllianceRequests()[0];
        if (!req) return [];
        return [{ type: "allianceRequest", recipient: req.requestor().id() }];
      }
      default: {
        const unit = BUILD_UNIT[type as ActionType];
        if (unit === undefined) return [];
        const kind = BUILD_CELL_KIND[type as ActionType]!;
        const tile = this.pickTileInCell(cell, (t) => {
          if (kind === CELL_OWN || kind === CELL_OWN_SHORE) {
            if (this.game.owner(t) !== agent) return false;
            if (kind === CELL_OWN_SHORE && !this.game.map().isShoreline(t)) return false;
          } else if (kind === CELL_HOSTILE) {
            const o = this.game.owner(t);
            if (!o.isPlayer() || o === agent || agent.isFriendly(o as Player)) return false;
          }
          return agent.canBuild(unit, t) !== false;
        });
        if (tile === null) return [];
        return [{ type: "build_unit", unit, tile }];
      }
    }
  }

  private isSpawnable(t: number): boolean {
    const m = this.game.map();
    return m.isLand(t) && !m.isImpassable(t) && !this.game.hasOwner(t);
  }

  private isBoatTarget(agent: Player, t: number): boolean {
    const m = this.game.map();
    return m.isLand(t) && m.isShoreline(t) && this.game.owner(t) !== agent;
  }

  /** Picks a sampled tile in the cell that satisfies `ok`, nearest the cell centre. */
  private pickTileInCell(cell: number, ok: (t: number) => boolean): number | null {
    const samples = this.cellSamples[cell];
    if (!samples || samples.length === 0) return null;
    const mid = samples.length >> 1;
    const m = this.game.map();
    let tries = 0;
    for (let k = 0; k < samples.length && tries < 48; k++) {
      // spiral out from the middle sample
      const idx = mid + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
      if (idx < 0 || idx >= samples.length) continue;
      const t = samples[idx];
      if (!m.isLand(t) && !m.isShoreline(t)) continue;
      tries++;
      if (ok(t)) return t;
    }
    return null;
  }

  // ───────────────────────── observation ─────────────────────────

  private buildCellTables(): void {
    const m = this.game.map();
    const G = this.opts.grid;
    const W = m.width();
    const H = m.height();
    const per = 8; // sampled points per cell axis
    this.cellSamples = [];
    this.cellInfo = [];
    const sampleList: number[] = [];
    const cellOf: number[] = [];
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const x0 = (gx * W) / G;
        const x1 = ((gx + 1) * W) / G;
        const y0 = (gy * H) / G;
        const y1 = ((gy + 1) * H) / G;
        const refs: number[] = [];
        for (let sy = 0; sy < per; sy++) {
          for (let sx = 0; sx < per; sx++) {
            const x = Math.min(W - 1, Math.floor(x0 + ((sx + 0.5) * (x1 - x0)) / per));
            const y = Math.min(H - 1, Math.floor(y0 + ((sy + 0.5) * (y1 - y0)) / per));
            const t = m.ref(x, y);
            refs.push(t);
            sampleList.push(t);
            cellOf.push(gy * G + gx);
          }
        }
        // Order for pickTileInCell: row-major sample order; middle ≈ cell centre.
        this.cellSamples.push(Int32Array.from(refs));
        this.cellInfo.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
      }
    }
    this.cellOfSample = Int32Array.from(cellOf);
  }

  tileFraction(p: Player): number {
    return p.numTilesOwned() / Math.max(1, this.game.totalLandTiles());
  }

  private livePlayers(): number {
    return this.game.players().filter((p) => p.isAlive()).length;
  }

  private rank(p: Player): number {
    const mine = p.numTilesOwned();
    let r = 1;
    for (const o of this.game.players()) {
      if (o !== p && o.isAlive() && o.numTilesOwned() > mine) r++;
    }
    return r;
  }

  private shapedReward(agent: Player): number {
    if (!agent.isAlive()) return 0;
    const frac = this.tileFraction(agent);
    let r = 20 * (frac - this.prevTileFrac);
    this.prevTileFrac = frac;
    const cities = agent.unitCount(UnitType.City);
    const ports = agent.unitCount(UnitType.Port);
    const other =
      agent.unitCount(UnitType.Factory) +
      agent.unitCount(UnitType.DefensePost) +
      agent.unitCount(UnitType.SAMLauncher) +
      agent.unitCount(UnitType.MissileSilo);
    if (cities > this.prevCities) r += 0.06 / (1 + this.prevCities);
    if (ports > this.prevPorts) r += 0.03 / (1 + this.prevPorts);
    if (other > this.prevOther) r += 0.01 / (1 + this.prevOther);
    this.prevCities = cities;
    this.prevPorts = ports;
    this.prevOther = other;
    return r;
  }

  /**
   * Writes the observation into the given views.
   * spatial: C*G*G floats, scalars: S floats, masks: maskSize bytes.
   */
  observe(spatial: Float32Array, scalars: Float32Array, masks: Uint8Array): void {
    spatial.fill(0);
    scalars.fill(0);
    masks.fill(0);
    const G = this.opts.grid;
    const GG = G * G;
    const game = this.game;
    const m = game.map();
    const agent = this.agent!;
    const inSpawn = game.inSpawnPhase();
    const alive = agent.isAlive();
    const mySmall = agent.smallID();
    const myTroops = Math.max(1, agent.troops());

    // Channel layout:
    // 0 land  1 mine  2 free land  3 hostile  4 friendly
    // 5 hostile strength (log troops ratio)  6 my structures  7 my border/shore
    const cLand = 0, cMine = GG, cFree = 2 * GG, cHost = 3 * GG, cFriend = 4 * GG;
    const cStr = 5 * GG, cStruct = 6 * GG, cShore = 7 * GG;
    const kOwn = TYPE_COUNT + NUM_SLOTS * 2;
    const mOwn = kOwn, mOwnShore = kOwn + GG, mLandFree = kOwn + 2 * GG;
    const mShoreFree = kOwn + 3 * GG, mHostile = kOwn + 4 * GG;

    const strengthCache = new Map<number, number>();
    const friendCache = new Map<number, boolean>();
    const samples = this.cellOfSample;
    const perCell = 64;
    const inv = 1 / perCell;
    let sampleIdx = 0;
    for (let cell = 0; cell < GG; cell++) {
      const refs = this.cellSamples[cell];
      for (let k = 0; k < refs.length; k++, sampleIdx++) {
        const t = refs[k];
        if (!m.isLand(t)) continue;
        spatial[cLand + cell] += inv;
        const shore = m.isShoreline(t);
        if (!m.hasOwner(t)) {
          spatial[cFree + cell] += inv;
          masks[mLandFree + cell] = 1;
          if (shore) masks[mShoreFree + cell] = 1;
          continue;
        }
        const oid = m.ownerID(t);
        if (oid === mySmall) {
          spatial[cMine + cell] += inv;
          masks[mOwn + cell] = 1;
          if (shore) {
            spatial[cShore + cell] += inv;
            masks[mOwnShore + cell] = 1;
          }
          continue;
        }
        let friendly = friendCache.get(oid);
        let st = strengthCache.get(oid);
        if (friendly === undefined) {
          const o = game.playerBySmallID(oid);
          if (o.isPlayer()) {
            friendly = agent.isFriendly(o);
            st = Math.max(-1, Math.min(1, Math.log2(Math.max(1, o.troops()) / myTroops) / 6));
          } else {
            friendly = false;
            st = 0;
          }
          friendCache.set(oid, friendly);
          strengthCache.set(oid, st!);
        }
        if (friendly) {
          spatial[cFriend + cell] += inv;
        } else {
          spatial[cHost + cell] += inv;
          spatial[cStr + cell] += inv * (st! * 0.5 + 0.5);
          masks[mHostile + cell] = 1;
          if (shore) masks[mShoreFree + cell] = 1;
        }
        if (shore && !friendly) masks[mShoreFree + cell] = 1;
        masks[mLandFree + cell] = 1;
      }
    }
    void samples;

    // my structures, binned into cells
    if (alive) {
      const W = m.width();
      const H = m.height();
      for (const u of agent.units(UnitType.City, UnitType.Port, UnitType.Factory)) {
        const t = u.tile();
        const gx = Math.min(G - 1, Math.floor((m.x(t) / W) * G));
        const gy = Math.min(G - 1, Math.floor((m.y(t) / H) * G));
        spatial[cStruct + gy * G + gx] = Math.min(1, spatial[cStruct + gy * G + gx] + 0.34);
      }
    }

    // ── scalars ──
    let si = 0;
    const put = (v: number) => {
      scalars[si++] = Number.isFinite(v) ? v : 0;
    };
    const frac = alive ? this.tileFraction(agent) : 0;
    const nAlive = this.livePlayers();
    const maxTroops = Math.max(1, game.config().maxTroops(agent));
    const gold = Number(agent.gold());
    put(Math.log10(1 + agent.troops()) / 7);
    put(Math.min(1.5, agent.troops() / maxTroops));
    put(Math.log10(1 + gold) / 9);
    put(Math.sqrt(frac));
    put(frac * 10 > 1 ? 1 : frac * 10);
    put(alive ? 1 - (this.rank(agent) - 1) / Math.max(1, nAlive) : 0);
    put(nAlive / 200);
    put(this.decisions / this.opts.maxDecisions);
    put(inSpawn ? 1 : 0);
    put(Math.min(1, agent.outgoingAttacks().length / 4));
    let incoming = 0;
    for (const a of agent.incomingAttacks()) incoming += a.troops();
    put(Math.min(1, incoming / myTroops));
    let outgoing = 0;
    for (const a of agent.outgoingAttacks()) outgoing += a.troops();
    put(Math.min(1, outgoing / myTroops));
    put(Math.min(1, agent.unitCount(UnitType.City) / 10));
    put(Math.min(1, agent.unitCount(UnitType.Port) / 5));
    put(Math.min(1, agent.unitCount(UnitType.DefensePost) / 5));
    put(Math.min(1, agent.unitCount(UnitType.Factory) / 5));
    put(Math.min(1, agent.unitCount(UnitType.MissileSilo) / 3));
    put(Math.min(1, agent.unitCount(UnitType.SAMLauncher) / 3));
    put(Math.min(1, agent.unitCount(UnitType.Warship) / 5));
    put(Math.min(1, agent.unitCount(UnitType.TransportShip) / 4));
    put(Math.min(1, agent.allies().length / 4));
    put(Math.min(1, agent.incomingAllianceRequests().length / 2));
    put(agent.isTraitor() ? 1 : 0);
    put(1); // bias
    si = 24;

    // affordability for builds
    this.costs.clear();
    if (alive && !inSpawn) {
      for (const b of agent.buildableUnits(null)) this.costs.set(b.type as UnitType, b.cost);
    }
    const affordable = (u: UnitType): boolean => {
      const c = this.costs.get(u);
      return c !== undefined && agent.gold() >= c;
    };

    // ── neighbour slots ──
    this.slotPlayers.fill(null);
    let nSlots = 1;
    let borderFree = false;
    const attackable: boolean[] = new Array(NUM_SLOTS).fill(false);
    const allyable: boolean[] = new Array(NUM_SLOTS).fill(false);
    if (alive && !inSpawn) {
      const near = agent.nearby();
      const players: Player[] = [];
      for (const n of near) {
        if (n.isPlayer()) players.push(n as Player);
        else borderFree = true;
      }
      players.sort((a, b) => a.smallID() - b.smallID());
      // slot 0 = unclaimed land
      attackable[0] = borderFree;
      const slotStat = (idx: number, p: Player | null) => {
        const base = 24 + idx * 6;
        if (p === null) {
          scalars[base] = idx === 0 && borderFree ? 1 : 0;
          return;
        }
        scalars[base] = 1;
        scalars[base + 1] = Math.max(-1, Math.min(1, Math.log2(Math.max(1, p.troops()) / myTroops) / 6)) * 0.5 + 0.5;
        scalars[base + 2] = Math.min(1, p.numTilesOwned() / Math.max(1, agent.numTilesOwned()) / 4);
        scalars[base + 3] = agent.isFriendly(p) ? 1 : 0;
        scalars[base + 4] = p.type() === PlayerType.Nation ? 1 : p.type() === PlayerType.Human ? 0.5 : 0;
        scalars[base + 5] = p.isTraitor() ? 1 : 0;
      };
      slotStat(0, null);
      for (const p of players) {
        if (nSlots >= NUM_SLOTS) break;
        this.slotPlayers[nSlots] = p;
        slotStat(nSlots, p);
        attackable[nSlots] = !agent.isFriendly(p);
        allyable[nSlots] = agent.canSendAllianceRequest(p);
        nSlots++;
      }
    }

    // ── masks ──
    const tm = (t: ActionType, v: boolean) => {
      masks[t] = v ? 1 : 0;
    };
    const anyCell = (off: number) => {
      for (let i = 0; i < GG; i++) if (masks[off + i]) return true;
      return false;
    };
    if (inSpawn) {
      tm(ActionType.Spawn, anyCell(mLandFree));
      if (!anyCell(mLandFree)) tm(ActionType.Noop, true);
    } else if (!alive) {
      tm(ActionType.Noop, true);
    } else {
      tm(ActionType.Noop, true);
      tm(ActionType.Attack, attackable.some(Boolean) && agent.troops() >= 2);
      tm(ActionType.Boat, agent.troops() >= 2 && anyCell(mShoreFree) && anyCell(mOwnShore));
      tm(ActionType.City, affordable(UnitType.City));
      tm(ActionType.Port, affordable(UnitType.Port) && anyCell(mOwnShore));
      tm(ActionType.DefensePost, affordable(UnitType.DefensePost));
      tm(ActionType.Factory, affordable(UnitType.Factory));
      tm(ActionType.Silo, affordable(UnitType.MissileSilo));
      tm(ActionType.Sam, affordable(UnitType.SAMLauncher));
      tm(ActionType.Warship, affordable(UnitType.Warship) && anyCell(mOwnShore));
      tm(
        ActionType.AtomBomb,
        affordable(UnitType.AtomBomb) &&
          agent.unitCount(UnitType.MissileSilo) > 0 &&
          anyCell(mHostile),
      );
      tm(ActionType.AllyRequest, allyable.some(Boolean));
      tm(ActionType.AcceptAlliance, agent.incomingAllianceRequests().length > 0);
    }
    const sOff = TYPE_COUNT;
    for (let i = 0; i < NUM_SLOTS; i++) {
      masks[sOff + i] = attackable[i] ? 1 : 0;
      masks[sOff + NUM_SLOTS + i] = allyable[i] ? 1 : 0;
    }
    // Heads that are unused for the sampled type still need >=1 legal choice.
    let any = false;
    for (let i = 0; i < NUM_SLOTS; i++) any ||= masks[sOff + i] === 1;
    if (!any) masks[sOff] = 1;
    any = false;
    for (let i = 0; i < NUM_SLOTS; i++) any ||= masks[sOff + NUM_SLOTS + i] === 1;
    if (!any) masks[sOff + NUM_SLOTS + 0] = 1;
    for (let kind = 0; kind < NUM_MASK_CELL_KINDS; kind++) {
      const off = kOwn + kind * GG;
      if (!anyCell(off)) masks[off] = 1;
    }
  }

  /** Downsampled ownership map for the live viewer (see rl/viewer.ts). */
  frame(maxW = 360): { w: number; h: number; data: Uint16Array; meta: object } {
    const m = this.game.map();
    const stride = Math.max(1, Math.ceil(m.width() / maxW));
    const w = Math.floor(m.width() / stride);
    const h = Math.floor(m.height() / stride);
    const data = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = m.ref(x * stride, y * stride);
        data[y * w + x] = m.isLand(t) ? m.ownerID(t) : 65535;
      }
    }
    const a = this.agent;
    const leaders = this.game
      .players()
      .filter((p) => p.isAlive())
      .sort((p, q) => q.numTilesOwned() - p.numTilesOwned())
      .slice(0, 8)
      .map((p) => ({
        id: p.smallID(),
        name: p.displayName(),
        tiles: p.numTilesOwned(),
        you: p === a,
      }));
    return {
      w,
      h,
      data,
      meta: {
        w,
        h,
        agent: a ? a.smallID() : -1,
        tick: this.game.ticks(),
        decisions: this.decisions,
        alive: this.livePlayers(),
        you: a && a.isAlive() ? this.info() : null,
        leaders,
      },
    };
  }

  /** Static info for logging. */
  info(): { tick: number; tiles: number; players: number; troops: number; gold: number } {
    const a = this.agent!;
    return {
      tick: this.game.ticks(),
      tiles: a.numTilesOwned(),
      players: this.livePlayers(),
      troops: Math.round(a.troops()),
      gold: Number(a.gold()),
    };
  }

  msPerTick(): number {
    return this.game.config().msPerTick();
  }

  error(): string | undefined {
    return this.fatal;
  }
}
