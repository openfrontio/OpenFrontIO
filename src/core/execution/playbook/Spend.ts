// Spend: the scored-spending model behind `scoredSpend` (plan package B3).
//
// Every purchase the bot can make is a Candidate whose `value` is the expected return over the horizon divided by
// its cost, with the return measured in gold-equivalent. Economy.build() enumerates the candidates, subtracts the
// escrow list once, and buys the best affordable one with value >= 1. The value functions here are pure and take
// plain numbers so tests can feed them fixed inputs; every constant carries the lab result it encodes.

import { Unit, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";

export interface Candidate {
  kind: "build" | "upgrade";
  type: UnitType;
  tile?: TileRef;
  unit?: Unit;
  cost: bigint;
  value: number; // expected return over the horizon / cost
  why: string;
}

export interface Escrow {
  purpose: string;
  amount: bigint;
  until: number; // tick the reservation lapses (informational: the list is rebuilt every pass)
}

// ---------------------------------------------------------------- constants (each one is a lab number)
/** Gold-equivalent of one troop of cap — the one constant that converts cap into gold. 20 makes a city's 250k cap
 *  worth 5M, about 20 % more than one port level earns over a 10-minute horizon (≈700/tick × 6000), so that at
 *  the same price a full army (troops ≥ 0.8 × cap, fullness 1) buys cap before another port level while an army
 *  under that buys the port: the ports lab's "level the port unless troops are near cap" rule as a curve. */
export const CAP_GOLD_PER_TROOP = 20;
/** Ticks a 250k cap step takes to fill from regen (10 + troops^0.73 / 4 per tick, ~2–3k/tick mid-game). */
export const CAP_FILL_TICKS = 2500;
/** Trade ships one port level launches per tick on an empty sea (PortExecution rolls 1/100 per level per tick). */
export const SHIPS_PER_TICK_PER_LEVEL = 0.01;
/** Gold a trade lane actually yields per launched ship, as a share of the raw tradeShipGold: the guide measured a
 *  port at ~7× base income (≈700/tick) once nations have ports, against the raw ~1k/tick the spawn roll implies
 *  (captured ships, partners that die, travel time). */
export const TRADE_EFFICIENCY = 0.7;
/** Own port levels at which the marginal level earns half of the first: the ports lab measured ~1.7k/s per extra
 *  level beyond 40–80 own levels against 80 rival levels. */
export const PORT_HALF_LEVELS = 80;
/** A second port once the first is at portLevelBeforeSecond: it reaches partners on other water and survives a
 *  captured lane, worth this much over one more level on the same port (lab: level 3 before a second port). */
export const NEW_PORT_BONUS = 1.15;
/** A port with no partner in sight (ocean coast from portWithoutPartnerTick) earns this share of a partnered one. */
export const NO_PARTNER_SHARE = 0.5;
/** Gold-equivalent of what a silo's bombs win over a full phase (a 750k atom takes ~3 structures and the land
 *  under them); readiness gates it, because v8's early silos cost 36 % of land. */
export const SILO_WORTH = 3_000_000;
/** A silo level once a bomb target sat out of range three times. */
export const SILO_LEVEL_WORTH = 2_000_000;
/** Gold-equivalent of one city unit under a SAM umbrella (a levelled city, its cap and the land it anchors). */
export const SAM_CITY_WORTH = 400_000;
/** Cities one launcher covers (Economy: one SAM per 8 city units). */
export const SAM_CITIES = 8;
/** Share of the trade income a warship protects (it sinks landing boats and pirates on the lanes). */
export const WARSHIP_TRADE_SHARE = 0.1;
/** Gold-equivalent of a defence post facing a threat (the land and troops a surprise attack would take). */
export const THREAT_POST_WORTH = 400_000;

// ---------------------------------------------------------------- horizon and escrow
/** Time left in the current phase. Opening/mid: one 10-minute block; from 20:00 the game clock runs out at 25:00
 *  (guide: nothing bought after 25:00 pays back). The clock-only reading; `phaseGates` uses horizonForPhase. */
export function horizon(tick: number): number {
  if (tick < 12000) return 6000;
  return Math.max(1000, 15000 - tick);
}

/** C1 (`phaseGates`): the horizon from the phase. Opening and consolidate: a 10-minute block; war: 4000 ticks (a war
 *  resolves or is judged inside SIM_HORIZON + a follow-up); endgame: what is left of the 25:00 clock, and 1000
 *  ticks past it (the last purchases that still pay: a bomb, a SAM level). */
export function horizonForPhase(phase: "opening" | "consolidate" | "war" | "endgame", tick: number): number {
  switch (phase) {
    case "opening":
    case "consolidate":
      return 6000;
    case "war":
      return 4000;
    case "endgame":
      return Math.max(1000, 15000 - tick);
  }
}

/** Gold left to spend: the escrow list is subtracted exactly once. `exempt` lets the purchase an escrow saves for
 *  spend its own reservation. */
export function available(gold: bigint, escrow: Escrow[], exempt?: string): bigint {
  let held = 0n;
  for (const e of escrow) if (e.purpose !== exempt) held += e.amount;
  return gold - held;
}

// ---------------------------------------------------------------- value functions
/** value = return / cost, 0 when the cost is 0 or the return is not positive. */
export function valueOf(ret: number, cost: bigint): number {
  if (cost <= 0n || ret <= 0) return 0;
  return ret / Number(cost);
}

/** Cap: `capTroops` × CAP_GOLD_PER_TROOP, scaled by how full we are (troops/cap over capFullShare: an empty army
 *  cannot use more room) and by whether the step can fill within the horizon. `extra` is gold/tick the same
 *  building also earns (a city on a rail is a train stop). */
export function capReturn(capTroops: number, capShare: number, capFullShare: number, horizonTicks: number, extra = 0): number {
  const fullness = Math.min(1, Math.max(0.25, capShare / Math.max(0.01, capFullShare)));
  const fill = Math.min(1, horizonTicks / CAP_FILL_TICKS);
  return capTroops * CAP_GOLD_PER_TROOP * fullness * fill + extra * horizonTicks;
}

export interface PortInputs {
  shipGold: number; // gold one ship pays each end (config.tradeShipGold at a typical lane length)
  mapShips: number; // trade ships on the map now
  seaFullShips: number; // param: map-wide saturation
  ownLevels: number; // our port levels (before this one)
  partner: boolean; // a foreign port on shared water
}

/** Gold per tick one more port level earns: the spawn roll × the lane's gold × TRADE_EFFICIENCY, halved on a sea
 *  at seaFullShips (a smooth cliff: the pool of ships is map-wide) and halved again at PORT_HALF_LEVELS own levels. */
export function portLevelReturnPerTick(inp: PortInputs): number {
  const sea = 1 / (1 + Math.pow(inp.mapShips / Math.max(1, inp.seaFullShips), 3));
  const own = PORT_HALF_LEVELS / (PORT_HALF_LEVELS + inp.ownLevels);
  const partner = inp.partner ? 1 : NO_PARTNER_SHARE;
  return SHIPS_PER_TICK_PER_LEVEL * inp.shipGold * TRADE_EFFICIENCY * sea * own * partner;
}

/** A level on the best port: the per-level income over the horizon. */
export function portLevelReturn(inp: PortInputs, horizonTicks: number): number {
  return portLevelReturnPerTick(inp) * horizonTicks;
}

/** A new port: the same income less the build time, scaled by the level curve — bestLevel / portLevelBeforeSecond
 *  below the line (the lab levelled the first port to 3 before a second), NEW_PORT_BONUS at or above it. */
export function newPortReturn(inp: PortInputs, bestLevel: number, portLevelBeforeSecond: number, horizonTicks: number, buildTicks: number): number {
  const curve = bestLevel === 0 ? 1 : bestLevel >= portLevelBeforeSecond ? NEW_PORT_BONUS : bestLevel / portLevelBeforeSecond;
  return portLevelReturnPerTick(inp) * Math.max(0, horizonTicks - buildTicks) * curve;
}

export interface RailInputs {
  factories: number; // factories we own (train spawn slows with more)
  ownStops: number; // our stations the line will serve (existing within 110 tiles + planned anchor and infill)
  allyStops: number; // allied cities on the line (35k a stop vs 10k)
  selfStopGold: number; // config.trainGold("self", …)
  allyStopGold: number; // config.trainGold("ally", …)
}

/** Gold per tick a rail line earns: one train every trainSpawnRate ticks per factory, paying every station it
 *  visits. Stations only exist within 110 tiles of a factory, so `ownStops` must be counted there. */
export function railReturnPerTick(inp: RailInputs, trainSpawnRate: number): number {
  if (inp.ownStops + inp.allyStops === 0) return 0;
  const perTrain = inp.ownStops * inp.selfStopGold + inp.allyStops * inp.allyStopGold;
  return perTrain / Math.max(1, trainSpawnRate);
}

/** The whole line's income over the horizon against what is left to build of it; each step of the line
 *  (factory, anchor, infill) carries this value. */
export function railValue(inp: RailInputs, trainSpawnRate: number, remainingCost: bigint, horizonTicks: number, buildTicks: number): number {
  return valueOf(railReturnPerTick(inp, trainSpawnRate) * Math.max(0, horizonTicks - buildTicks), remainingCost);
}

export interface SiloInputs {
  enemySilos: boolean; // an unfriendly non-bot player owns a silo
  rank: number; // our land rank among non-bots (99 = unknown/early)
  idleAtCap: boolean; // troops idle above 90 % of cap with no war on
  cityUnits: number;
  economy: boolean; // a port level or a factory pays (nation-style: a silo once something earns)
  tick: number;
}

/** A silo: SILO_WORTH × threat × readiness. Threat comes from enemy silos and rank, not the clock; readiness is
 *  nation-style (four city units, an earning economy), with no silo before 5:00 and an idle full army as an
 *  alternative reason. */
export function siloReturn(inp: SiloInputs, horizonTicks: number): number {
  if (inp.tick < 3000) return 0;
  let threat = inp.enemySilos ? 1 : 0.3; // calm: only a top-three rank or an idle full army lifts a silo over 1 (v8: silos on a clock cost 36 % of land)
  if (inp.rank <= 3) threat *= 1.3;
  if (inp.idleAtCap) threat *= 1.3;
  const ready = Math.min(1, inp.cityUnits / 4) * (inp.economy || inp.idleAtCap ? 1 : 0.3);
  return SILO_WORTH * threat * ready * Math.min(1, horizonTicks / 3000);
}

export interface SamInputs {
  enemySilos: boolean;
  rank: number;
  tick: number;
  cityUnits: number;
}

/** A launcher: the city units it covers × SAM_CITY_WORTH × threat (enemy silos 1, top three 0.7, after 12:00
 *  0.35 — nations start MIRVing the leaders then). A level is worth half a launcher. */
export function samReturn(inp: SamInputs, kind: "build" | "upgrade", horizonTicks: number): number {
  const threat = inp.enemySilos ? 1 : inp.rank <= 3 ? 0.7 : inp.tick >= 7200 ? 0.35 : 0;
  const covered = Math.min(inp.cityUnits, SAM_CITIES);
  return covered * SAM_CITY_WORTH * threat * (kind === "upgrade" ? 0.5 : 1) * Math.min(1, horizonTicks / 2000);
}

/** A warship: WARSHIP_TRADE_SHARE of the trade income it guards over the horizon. */
export function warshipReturn(tradePerTick: number, horizonTicks: number): number {
  return tradePerTick * WARSHIP_TRADE_SHARE * horizonTicks;
}

/** A defence post facing a threat: THREAT_POST_WORTH, half again when the threat is an ally about to lapse. */
export function threatPostReturn(expiring: boolean): number {
  return THREAT_POST_WORTH * (expiring ? 1.5 : 1);
}

// ---------------------------------------------------------------- ranking and logging
export function rankCandidates(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => b.value - a.value);
}

/** `City 1.8 / Port lvl 1.3 / Silo 0.4` — the top `n` for the lab viewer (" / ", because the lab joins log lines with " | "). */
export function describeTop(cands: Candidate[], n = 3): string {
  return rankCandidates(cands).slice(0, n).map((c) => `${c.why} ${c.value.toFixed(1)}`).join(" / ");
}
