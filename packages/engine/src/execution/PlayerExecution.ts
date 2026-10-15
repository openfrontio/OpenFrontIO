import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Cell,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { getMode, simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { EngineConfig } from "../configuration/EngineConfig";
import { Execution, Game, Player } from "../game/Game";
import {
  bumpTraversalGeneration,
  tileTraversalScratch,
  TileTraversalScratch,
} from "../game/TileTraversalScratch";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const TICKS_PER_CLUSTER_CALC = 20;

const CLUSTER_SURROUNDED = 1;
const CLUSTER_SEVERED_CANDIDATE = 2;
// Touches coast, map edge or open land: never land cut off with no way out.
const CLUSTER_OPEN = 4;

// Border tiles that may belong to land cut off from the main body, with
// their bounding boxes packed four numbers apiece (minX, minY, maxX, maxY).
interface SeveredCandidates {
  clusters: TileRef[][];
  boxes: number[];
}

// Border tiles in the running for the main body, as above, and whether each
// touches coast, map edge or open land.
interface MainBodyPieces extends SeveredCandidates {
  open: boolean[];
}

// A border cluster's parts that each lie in a single territory, as above,
// with each part's class judged on its own tiles: CLUSTER_OPEN,
// CLUSTER_SEVERED_CANDIDATE or 0.
interface TerritoryParts extends SeveredCandidates {
  classes: number[];
}

// The main body's border tiles, in pieces, and the land that may be cut
// off from it.
interface SeveredLand {
  mainTiles: TileRef[][];
  candidates: SeveredCandidates;
}

export class PlayerExecution implements Execution {
  private ticksPerClusterCalc = TICKS_PER_CLUSTER_CALC;

  private config: EngineConfig;
  private lastCalc = 0;
  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;
  private active = true;
  // Reusable neighbor buffer to avoid closures/allocation in cluster checks.
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf8: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.map = mg.map();
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.id()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    for (const u of this.player.units()) {
      if (!Structures.has(u.type())) {
        continue;
      }

      const owner = this.mg!.owner(u.tile());
      if (!owner?.isPlayer()) {
        u.delete();
        continue;
      }
      if (owner === this.player) {
        continue;
      }

      const captor = this.mg!.player(owner.id());
      if (u.type() === UnitType.DefensePost) {
        u.delete(true, captor);
      } else {
        captor.captureUnit(u);
      }
    }

    if (!this.player.isAlive()) {
      this.removeOnDeath();
      this.active = false;
      // OFM live standings: finishing place = non-bot players still standing when
      // we fell, + 1 (we are the last of them). players() is alive-only and we
      // just dropped to zero tiles, so it already excludes us. Bots are fill, not
      // competitors, so they don't count. Deterministic (same on every client).
      // Fallback path: conquest deaths are stamped in GameImpl.conquerPlayer (so a
      // game-ending tick still records it); recordDeathPosition is first-write-wins.
      const stillStanding = this.mg
        .players()
        .filter((p) => p.type() !== PlayerType.Bot).length;
      this.mg.stats().recordDeathPosition(this.player, stillStanding + 1);
      this.mg.stats().playerKilled(this.player, ticks);
      return;
    }

    const troopInc = this.config.troopIncreaseRate(this.player);
    this.player.addTroops(troopInc);
    const goldFromWorkers = this.config.goldAdditionRate(this.player);
    this.player.addGold(goldFromWorkers);

    // Record stats
    this.mg.stats().goldWork(this.player, goldFromWorkers);

    for (const alliance of this.player.alliances()) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    for (const embargo of this.player.getEmbargoes()) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    if (
      ticks - this.lastCalc > this.ticksPerClusterCalc ||
      this.player.numTilesOwned() < 100
    ) {
      if (this.player.lastTileChange() >= this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  private removeClusters() {
    // Perf: We fuse bounds calculations into the initial DFS flood, returning packed Int32Array bounds
    // instead of scanning every TileRef and allocating hundreds of Object {min, max} Cells.
    const { clusters, boxes } = this.calculateClusters();

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    if (clusters.length === 1) {
      this.player.largestClusterBoundingBox = {
        min: new Cell(boxes[0], boxes[1]),
        max: new Cell(boxes[2], boxes[3]),
      };
      const surroundedBy = this.surroundedBySamePlayer(
        clusters[0],
        boxes[0],
        boxes[1],
        boxes[2],
        boxes[3],
      );
      const severedLand = this.severedLand(clusters[0], boxes, 0, null, null);
      if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
        this.removeCluster(clusters[0]);
      }
      if (severedLand !== null) {
        this.annexSeveredClusters(
          severedLand.candidates,
          severedLand.mainTiles,
        );
      }
      return;
    }

    // The cluster with the most border tiles is where the surrounded checks
    // start, and nothing more. Border length is no measure of size: a long
    // thin arm has more border than a compact body. The main body that
    // severed land is judged against is the piece with the largest
    // territory, never the longest border (severedLand picks it).
    let largestIndex = 0;
    for (let i = 1; i < clusters.length; i++) {
      if (clusters[i].length > clusters[largestIndex].length) {
        largestIndex = i;
      }
    }

    const tMinX = boxes[largestIndex * 4];
    const tMinY = boxes[largestIndex * 4 + 1];
    const tMaxX = boxes[largestIndex * 4 + 2];
    const tMaxY = boxes[largestIndex * 4 + 3];

    // Fix: Doughnut borders. Prevents a heavily deformed crater (hole) from having more border tiles
    // and falsely claiming primary cluster. A cluster is a hole if it is completely enclosed by another
    // cluster of the SAME contiguous territory. Bbox containment alone is insufficient (disjoint C-shapes).
    let clusterTerritoryIds: Int32Array | null = null;
    let nextTerritoryId = 1;

    let isLargestHole = false;
    for (let j = 0; j < clusters.length; j++) {
      if (j !== largestIndex) {
        const jIdx = j * 4;
        if (
          boxes[jIdx] <= tMinX &&
          boxes[jIdx + 1] <= tMinY &&
          boxes[jIdx + 2] >= tMaxX &&
          boxes[jIdx + 3] >= tMaxY
        ) {
          if (!clusterTerritoryIds) {
            clusterTerritoryIds = new Int32Array(clusters.length);
            const scratch = this.traversalState();
            for (let c = 0; c < clusters.length; c++) {
              const cl = clusters[c];
              for (let k = 0; k < cl.length; k++) {
                scratch.clusterIndexMap[cl[k]] = c + 1;
              }
            }
          }
          nextTerritoryId = this.checkAndAssignTerritory(
            clusters,
            largestIndex,
            j,
            clusterTerritoryIds,
            nextTerritoryId,
          );
          if (clusterTerritoryIds[largestIndex] === clusterTerritoryIds[j]) {
            isLargestHole = true;
            break;
          }
        }
      }
    }

    if (isLargestHole) {
      let bestIndex = -1;
      let bestLength = -1;
      for (let i = 0; i < clusters.length; i++) {
        if (i === largestIndex || clusters[i].length <= bestLength) continue;
        let isHole = false;
        const iIdx = i * 4;
        const iMinX = boxes[iIdx];
        const iMinY = boxes[iIdx + 1];
        const iMaxX = boxes[iIdx + 2];
        const iMaxY = boxes[iIdx + 3];

        for (let j = 0; j < clusters.length; j++) {
          if (j !== i) {
            const jIdx = j * 4;
            if (
              boxes[jIdx] <= iMinX &&
              boxes[jIdx + 1] <= iMinY &&
              boxes[jIdx + 2] >= iMaxX &&
              boxes[jIdx + 3] >= iMaxY
            ) {
              nextTerritoryId = this.checkAndAssignTerritory(
                clusters,
                i,
                j,
                clusterTerritoryIds!,
                nextTerritoryId,
              );
              if (clusterTerritoryIds![i] === clusterTerritoryIds![j]) {
                isHole = true;
                break;
              }
            }
          }
        }
        if (!isHole) {
          bestLength = clusters[i].length;
          bestIndex = i;
        }
      }
      if (bestIndex !== -1) {
        largestIndex = bestIndex;
      }
    }

    if (clusterTerritoryIds) {
      const scratch = this.traversalState();
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        for (let k = 0; k < cl.length; k++) {
          scratch.clusterIndexMap[cl[k]] = 0;
        }
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const lIdx = largestIndex * 4;
    this.player.largestClusterBoundingBox = {
      min: new Cell(boxes[lIdx], boxes[lIdx + 1]),
      max: new Cell(boxes[lIdx + 2], boxes[lIdx + 3]),
    };

    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      boxes[lIdx],
      boxes[lIdx + 1],
      boxes[lIdx + 2],
      boxes[lIdx + 3],
    );

    // Classify the remaining clusters, and pick the main body, before the
    // surrounded checks hand any land over: severed land is judged against
    // the main body as this pass found it, even if that body is taken. The
    // class of each single-territory part (see splitCluster) reads only its
    // own side-by-side neighbours, none of them ours, so taking other land
    // leaves it the same before as after.
    const classes = new Uint8Array(clusters.length);
    let severed: SeveredCandidates | null = null;
    let open: SeveredCandidates | null = null;
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      const idx = i * 4;
      const result = this.classifyCluster(
        cluster,
        boxes[idx],
        boxes[idx + 1],
        boxes[idx + 2],
        boxes[idx + 3],
      );
      classes[i] = result;
      if (result & CLUSTER_SEVERED_CANDIDATE) {
        severed ??= { clusters: [], boxes: [] };
        severed.clusters.push(cluster);
        severed.boxes.push(
          boxes[idx],
          boxes[idx + 1],
          boxes[idx + 2],
          boxes[idx + 3],
        );
      }
      if (result & CLUSTER_OPEN) {
        open ??= { clusters: [], boxes: [] };
        open.clusters.push(cluster);
        open.boxes.push(
          boxes[idx],
          boxes[idx + 1],
          boxes[idx + 2],
          boxes[idx + 3],
        );
      }
    }

    const severedLand = this.severedLand(
      largestCluster,
      boxes,
      lIdx,
      severed,
      open,
    );

    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(largestCluster);
    }
    for (let i = 0; i < clusters.length; i++) {
      if (classes[i] & CLUSTER_SURROUNDED) this.removeCluster(clusters[i]);
    }
    if (severedLand !== null) {
      this.annexSeveredClusters(severedLand.candidates, severedLand.mainTiles);
    }
  }

  /**
   * Picks the main body, and returns it with the land that may be cut off
   * from it, or null when no land can be.
   *
   * The main body is the piece with the largest territory, never the one
   * with the most border tiles: when a crater cuts a long thin arm off a
   * compact body, the arm has the longer border. Nor does a way out (coast,
   * map edge or open land) make a piece the main body: such a piece is
   * never annexed, but an arm reaching the coast must not hand over a
   * larger landlocked body.
   *
   * Every piece is the border of exactly one territory. Border clusters
   * join tiles that touch only at a corner, so one cluster can span several
   * territories; each cluster that has a piece here is split into its
   * single-territory parts first (see splitCluster), and every part is
   * classed on its own tiles. So a flood measures one territory, never two
   * that touch at a corner; the main body's stamp covers its own territory
   * only; a candidate's box bounds the territory it borders; and land with
   * no way out is a candidate even where it touches land with one at a
   * corner.
   *
   * The pieces are all of the largest cluster's parts; the parts of other
   * clusters that are candidates on their own; and, when no part of the
   * largest cluster has a way out but one could be cut off, the parts that
   * have a way out: the largest cluster may then be the cut-off piece, and
   * the body it was cut from the one with a way out. Pieces the main body
   * beats are candidates unless they have a way out. Nothing is raced
   * unless some piece could be annexed.
   */
  private severedLand(
    largestCluster: TileRef[],
    boxes: Int32Array,
    boxOffset: number,
    severed: SeveredCandidates | null,
    openClusters: SeveredCandidates | null,
  ): SeveredLand | null {
    // Only fallout can cut land off, so skip all of this in games without it.
    if (this.map.numTilesWithFallout() === 0) return null;

    let largest = this.splitCluster(largestCluster);
    if (largest === null) {
      // On its own, the largest cluster is the main body.
      if (severed === null && openClusters === null) return null;
      largest = wholeCluster(
        largestCluster,
        boxes,
        boxOffset,
        this.classifyCluster(
          largestCluster,
          boxes[boxOffset],
          boxes[boxOffset + 1],
          boxes[boxOffset + 2],
          boxes[boxOffset + 3],
        ),
      );
    }
    // Land with a way out races only when the largest cluster could itself
    // be the cut-off piece: none of its parts has a way out, and one is a
    // candidate. Without fallout round it, it is no land cut off by a nuke,
    // and racing the open land would walk its whole territory on every pass.
    const addOpen =
      !largest.classes.some((c) => (c & CLUSTER_OPEN) !== 0) &&
      largest.classes.some((c) => (c & CLUSTER_SEVERED_CANDIDATE) !== 0);

    const pieces: MainBodyPieces = { clusters: [], boxes: [], open: [] };
    addRacePieces(pieces, largest, true, true);
    const largestParts = pieces.clusters.length;
    if (severed !== null) {
      for (let c = 0; c < severed.clusters.length; c++) {
        const cluster = severed.clusters[c];
        const parts =
          this.splitCluster(cluster) ??
          wholeCluster(
            cluster,
            severed.boxes,
            c * 4,
            CLUSTER_SEVERED_CANDIDATE,
          );
        addRacePieces(pieces, parts, false, false);
      }
    }
    if (openClusters !== null) {
      for (let c = 0; c < openClusters.clusters.length; c++) {
        const cluster = openClusters.clusters[c];
        // A cluster with a way out can still hold land with none, touching
        // the rest only at a corner: that part is a candidate like any
        // other, and races even when land with a way out does not. Unsplit,
        // the cluster is a single territory with a way out.
        const split = this.splitCluster(cluster, !addOpen);
        if (split !== null) {
          addRacePieces(pieces, split, false, addOpen);
        } else if (addOpen) {
          const whole = wholeCluster(
            cluster,
            openClusters.boxes,
            c * 4,
            CLUSTER_OPEN,
          );
          addRacePieces(pieces, whole, false, true);
        }
      }
    }
    if (pieces.clusters.length < 2 || !pieces.open.includes(false)) {
      return null;
    }

    const count = pieces.clusters.length;
    const roots = new Int32Array(count);
    const main = this.largestTerritoryPart(
      pieces.clusters,
      roots,
      pieces.boxes,
    );
    if (main === -1) return null;

    // Pieces in the main body's territory are attached, not candidates.
    const mainTiles: TileRef[][] = [];
    const candidates: SeveredCandidates = { clusters: [], boxes: [] };
    // The other clusters' parts first, then the largest cluster's.
    for (let k = 0; k < count; k++) {
      const i = (k + largestParts) % count;
      if (rootOf(roots, i) === main) {
        mainTiles.push(pieces.clusters[i]);
        continue;
      }
      if (pieces.open[i]) continue;
      candidates.clusters.push(pieces.clusters[i]);
      candidates.boxes.push(
        pieces.boxes[i * 4],
        pieces.boxes[i * 4 + 1],
        pieces.boxes[i * 4 + 2],
        pieces.boxes[i * 4 + 3],
      );
    }
    return candidates.clusters.length > 0 ? { mainTiles, candidates } : null;
  }

  /**
   * Border clusters join tiles that touch only at a corner, but territories
   * join only side by side, so one cluster can span several territories,
   * such as land a nuke cuts off across a diagonal and the body it was cut
   * from. Splits a cluster into parts whose tiles are side by side or meet
   * at a corner beside one of our tiles; each part then lies in a single
   * territory. Returns the parts with their bounding boxes and their
   * classes, judged on each part's own tiles as classifyCluster judges a
   * cluster (without CLUSTER_SURROUNDED).
   *
   * A territory's outer border always lies within one part, unless the
   * territory reaches the map edge: walking round it, each step is side by
   * side or across a corner beside one of the territory's own tiles. So a
   * territory that fits in no box of its parts is the land round a hole.
   *
   * Returns null when the cluster does not split: it then lies in a single
   * territory and classifyCluster judges it as it is. With `candidatesOnly`
   * the caller wants only the candidate parts, so it also returns null,
   * without splitting, when the cluster borders no fallout: then none of its
   * parts is a candidate.
   */
  private splitCluster(
    cluster: readonly TileRef[],
    candidatesOnly = false,
  ): TerritoryParts | null {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const w = map.width();
    const h = map.height();
    if (cluster.length === 0 || map.ownerID(cluster[0]) !== mySmallID) {
      return null;
    }

    // Only two of our tiles meeting at a corner with neither tile between
    // them ours can split it. Look for one before doing the full split.
    // Both such tiles are border tiles, so they share a cluster.
    let pinched = false;
    for (let j = 0; j < cluster.length && !pinched; j++) {
      const t = cluster[j];
      if (t >= (h - 1) * w) continue;
      const below = t + w;
      if (map.ownerID(below) === mySmallID) continue;
      const x = t % w;
      pinched =
        (x < w - 1 &&
          map.ownerID(below + 1) === mySmallID &&
          map.ownerID(t + 1) !== mySmallID) ||
        (x > 0 &&
          map.ownerID(below - 1) === mySmallID &&
          map.ownerID(t - 1) !== mySmallID);
    }
    if (!pinched) return null;
    if (candidatesOnly) {
      let fallout = false;
      for (let j = 0; j < cluster.length && !fallout; j++) {
        const numNeighbors = map.neighbors4(cluster[j], this.nbuf);
        for (let i = 0; i < numNeighbors; i++) {
          const n = this.nbuf[i];
          if (map.ownerID(n) === 0 && map.hasFallout(n)) fallout = true;
        }
      }
      if (!fallout) return null;
    }

    const state = this.traversalState();
    const visited = state.visited;
    const memberGen = this.bumpGenerations(2);
    const doneGen = memberGen + 1;
    for (const t of cluster) visited[t] = memberGen;

    const stack = state.stack;
    const parts: TileRef[][] = [];
    const partBoxes: number[] = [];
    const classes: number[] = [];
    for (const start of cluster) {
      if (visited[start] !== memberGen) continue;
      if (map.ownerID(start) !== mySmallID) continue;
      visited[start] = doneGen;
      stack.length = 0;
      stack.push(start);
      const part: TileRef[] = [];
      let touchesOpen = false;
      let hasEnemy = false;
      let hasFallout = false;
      let minX = w,
        minY = h,
        maxX = -1,
        maxY = -1;
      while (stack.length > 0) {
        const t = stack.pop()!;
        part.push(t);
        const x = t % w;
        const y = (t - x) / w;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (map.isShore(t) || map.isOnEdgeOfMap(t)) touchesOpen = true;
        const numNeighbors = map.neighbors8(t, this.nbuf8);
        for (let i = 0; i < numNeighbors; i++) {
          const n = this.nbuf8[i];
          const ownerId = map.ownerID(n);
          const dx = (n % w) - x;
          const diagonal = dx !== 0 && n - dx !== t;
          if (!diagonal && ownerId !== mySmallID) {
            if (ownerId !== 0) hasEnemy = true;
            else if (map.hasFallout(n)) hasFallout = true;
            else touchesOpen = true;
          }
          if (visited[n] !== memberGen || ownerId !== mySmallID) continue;
          if (
            diagonal &&
            map.ownerID(t + dx) !== mySmallID &&
            map.ownerID(n - dx) !== mySmallID
          ) {
            continue;
          }
          visited[n] = doneGen;
          stack.push(n);
        }
      }
      parts.push(part);
      partBoxes.push(minX, minY, maxX, maxY);
      classes.push(
        touchesOpen
          ? CLUSTER_OPEN
          : hasEnemy && hasFallout
            ? CLUSTER_SEVERED_CANDIDATE
            : 0,
      );
    }
    if (parts.length < 2) return null;
    return { clusters: parts, boxes: partBoxes, classes };
  }

  /**
   * Returns the index of the piece whose territory is largest; ties go to
   * the lowest index. Each piece floods its territory, all in step, one tile
   * each per round. Floods that meet share a territory and merge; `roots`
   * maps each piece to the flood it merged into. The race stops once a
   * single flood is still growing and already outsizes every finished one,
   * so it need not walk the whole of the largest territory, which here is
   * often the whole empire: it walks about the number of pieces times the
   * second-largest, plus whatever the largest territory's own pieces walk
   * before they meet.
   *
   * With `boxes` (four numbers per piece, as in SeveredCandidates), a flood
   * that leaves the bounding boxes of all its pieces drops out. That
   * territory never fits the box of any of its pieces, so none of them is
   * its outer border and severedTerritory never annexes it through them;
   * they are rings round holes in it, and a ring round an ally's enclave
   * would otherwise walk the empire round it on every pass. A flood that
   * reaches one that dropped out takes it over and carries on. Returns -1
   * when every flood drops out.
   *
   * The map edge has no border tiles, so a territory on it can outrun the
   * boxes of all its pieces without being a ring: a piece whose box
   * reaches the map edge is not bounded. A piece without a way out never
   * reaches it.
   */
  private largestTerritoryPart(
    parts: readonly TileRef[][],
    roots: Int32Array,
    boxes?: readonly number[],
  ): number {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const visited = this.traversalState().visited;
    const w = map.width();
    const h = map.height();
    const count = parts.length;
    // Piece i's flood stamps `base + i`.
    const base = this.bumpGenerations(count);
    // Each flood's box: the union of its pieces' boxes.
    const bounds = boxes === undefined ? null : boxes.slice(0, count * 4);
    for (let b = 0; bounds !== null && b < bounds.length; b += 4) {
      if (
        bounds[b] === 0 ||
        bounds[b + 1] === 0 ||
        bounds[b + 2] === w - 1 ||
        bounds[b + 3] === h - 1
      ) {
        bounds[b] = 0;
        bounds[b + 1] = 0;
        bounds[b + 2] = w - 1;
        bounds[b + 3] = h - 1;
      }
    }
    const stacks: TileRef[][] = [];
    const sizes: number[] = [];
    const dropped: boolean[] = [];
    for (let i = 0; i < count; i++) {
      roots[i] = i;
      for (const t of parts[i]) visited[t] = base + i;
      stacks.push(parts[i].slice());
      sizes.push(parts[i].length);
      dropped.push(false);
    }

    let growing = count;
    let best = -1;
    for (;;) {
      for (let i = 0; i < count; i++) {
        const stack = stacks[i];
        if (roots[i] !== i || dropped[i] || stack.length === 0) continue;
        const t = stack.pop()!;
        if (bounds !== null) {
          const x = t % w;
          const y = (t - x) / w;
          const b = i * 4;
          if (
            x < bounds[b] ||
            y < bounds[b + 1] ||
            x > bounds[b + 2] ||
            y > bounds[b + 3]
          ) {
            // Kept for a flood that takes this one over.
            stack.push(t);
            dropped[i] = true;
            growing--;
            continue;
          }
        }
        const numNeighbors = map.neighbors4(t, this.nbuf);
        for (let k = 0; k < numNeighbors; k++) {
          const n = this.nbuf[k];
          if (map.ownerID(n) !== mySmallID) continue;
          const part = visited[n] - base;
          if (part < 0 || part >= count) {
            visited[n] = base + i;
            sizes[i]++;
            stack.push(n);
            continue;
          }
          const other = rootOf(roots, part);
          if (other === i) continue;
          // A flood that finished never meets another, so `other` is still
          // growing or has dropped out.
          roots[other] = i;
          sizes[i] += sizes[other];
          for (const s of stacks[other]) stack.push(s);
          stacks[other].length = 0;
          if (!dropped[other]) growing--;
          if (bounds !== null) {
            const b = i * 4;
            const o = other * 4;
            if (bounds[o] < bounds[b]) bounds[b] = bounds[o];
            if (bounds[o + 1] < bounds[b + 1]) bounds[b + 1] = bounds[o + 1];
            if (bounds[o + 2] > bounds[b + 2]) bounds[b + 2] = bounds[o + 2];
            if (bounds[o + 3] > bounds[b + 3]) bounds[b + 3] = bounds[o + 3];
          }
        }
        if (stack.length === 0) {
          growing--;
          if (
            best === -1 ||
            sizes[i] > sizes[best] ||
            (sizes[i] === sizes[best] && i < best)
          ) {
            best = i;
          }
        }
      }
      if (growing === 0) return best;
      if (growing === 1) {
        let last = 0;
        while (
          roots[last] !== last ||
          dropped[last] ||
          stacks[last].length === 0
        ) {
          last++;
        }
        if (best === -1 || sizes[last] > sizes[best]) return last;
      }
    }
  }

  /**
   * Hands land a nuke has cut off from the main body to the enemy around it.
   *
   * isEnclosed walks through fallout, so a crater that touches both a
   * severed piece and the main body links the two, and the piece is never
   * annexed whenever the main body reaches the coast or the map edge. Judge
   * the piece on its own instead: a territory not connected to the main body,
   * with no coast or map edge of its own, whose only neighbours are enemies
   * and fallout, has no way out and goes to the surrounding enemy.
   */
  private annexSeveredClusters(
    candidates: SeveredCandidates,
    mainTiles: readonly (readonly TileRef[])[],
  ) {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const visited = this.traversalState().visited;

    for (let c = 0; c < candidates.clusters.length; c++) {
      // Each candidate lies in a single territory (see splitCluster): the
      // first of its tiles still ours floods it, and the stamps or the
      // annex then rule out the rest.
      let mainGen = this.stampMainBody(mainTiles);
      for (const start of candidates.clusters[c]) {
        // An earlier annex in this pass may already have taken it.
        if (map.ownerID(start) !== mySmallID) continue;
        const mark = visited[start];
        if (mark >= mainGen && mark <= mainGen + 2) continue;

        const territory = this.severedTerritory(
          start,
          mainGen,
          mainGen + 1,
          mainGen + 2,
          candidates.boxes,
          c * 4,
        );
        if (territory === null) continue;

        const capturing = this.getCapturingPlayer(territory);
        if (capturing === null) continue;
        // The surrounded checks may already have taken the main body, and
        // earlier annexes the rest, in this pass.
        if (this.player.numTilesOwned() === territory.length) {
          this.mg.conquerPlayer(capturing, this.player);
        }
        for (const t of territory) capturing.conquer(t);
        // Conquering runs other code, which may start passes of its own on
        // the shared scratch and overwrite the stamps.
        mainGen = this.stampMainBody(mainTiles);
      }
    }
  }

  /**
   * Starts three passes for judging severed land: the main body's border
   * pieces are stamped with the returned generation, so a flood that
   * reaches them stops (that land is still attached); the next two are for
   * the floods.
   */
  private stampMainBody(mainTiles: readonly (readonly TileRef[])[]): number {
    const mainGen = this.bumpGenerations(3);
    const visited = this.traversalState().visited;
    for (const piece of mainTiles) for (const t of piece) visited[t] = mainGen;
    return mainGen;
  }

  /**
   * Flood-fills our territory from `start`, stamping it with `seenGen`, and
   * returns it if it is severed: it never reaches a tile stamped `mainGen`
   * (the main body), never touches the coast or the map edge, and borders
   * only other players and fallout, with at least one of each. Returns null
   * otherwise.
   *
   * The check that made it a candidate read only one part of the
   * territory's border (a hole in the territory has a border of its own,
   * and the largest cluster's parts are candidates whatever their class),
   * so every condition is checked again here on the whole territory.
   *
   * Every row and column of a severed territory starts and ends on its
   * outer border, and that border lies within one part (see splitCluster),
   * so the territory fits in that candidate's bounding box (`box` at
   * `boxOffset`).
   * A flood that leaves the box started on the ring round a hole in a larger
   * territory, which is attached or has its outer border judged as another
   * candidate, so it stops there. Without that bound a ring that stays a
   * candidate, such as one round an ally's enclave, would flood the whole
   * empire around it on every pass.
   */
  private severedTerritory(
    start: TileRef,
    mainGen: number,
    seenGen: number,
    failGen: number,
    box: readonly number[],
    boxOffset: number,
  ): TileRef[] | null {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const state = this.traversalState();
    const visited = state.visited;
    const stack = state.stack;
    const minX = box[boxOffset];
    const minY = box[boxOffset + 1];
    const maxX = box[boxOffset + 2];
    const maxY = box[boxOffset + 3];
    stack.length = 0;
    const tiles: TileRef[] = [start];
    visited[start] = seenGen;
    stack.push(start);
    let hasEnemy = false;
    let hasFallout = false;

    while (stack.length > 0) {
      const tile = stack.pop()!;
      const x = map.x(tile);
      const y = map.y(tile);
      if (
        x < minX ||
        x > maxX ||
        y < minY ||
        y > maxY ||
        map.isShore(tile) ||
        map.isOnEdgeOfMap(tile)
      ) {
        return this.stampAll(tiles, failGen);
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId === mySmallID) {
          const mark = visited[n];
          if (mark === mainGen) return this.stampAll(tiles, mainGen);
          if (mark === failGen) return this.stampAll(tiles, failGen);
          if (mark === seenGen) continue;
          visited[n] = seenGen;
          tiles.push(n);
          stack.push(n);
        } else if (ownerId !== 0) {
          hasEnemy = true;
        } else if (map.hasFallout(n)) {
          hasFallout = true;
        } else {
          return this.stampAll(tiles, failGen);
        }
      }
    }
    return hasEnemy && hasFallout ? tiles : null;
  }

  private stampAll(tiles: readonly TileRef[], gen: number): null {
    const visited = this.traversalState().visited;
    for (const t of tiles) visited[t] = gen;
    return null;
  }

  private checkAndAssignTerritory(
    clusters: TileRef[][],
    cIdxA: number,
    cIdxB: number,
    clusterTerritoryIds: Int32Array,
    nextTerritoryId: number,
  ): number {
    if (
      clusterTerritoryIds[cIdxA] !== 0 &&
      clusterTerritoryIds[cIdxA] === clusterTerritoryIds[cIdxB]
    ) {
      return nextTerritoryId;
    }
    if (clusterTerritoryIds[cIdxA] !== 0 && clusterTerritoryIds[cIdxB] !== 0) {
      return nextTerritoryId;
    }

    const startIdx = clusterTerritoryIds[cIdxB] === 0 ? cIdxB : cIdxA;
    const territoryId = nextTerritoryId++;

    const state = this.traversalState();
    const visited = state.visited;
    const floodGen = this.bumpGeneration();
    const stack = state.stack;
    stack.length = 0;

    const start = clusters[startIdx][0];
    visited[start] = floodGen;
    stack.push(start);

    const map = this.map;
    const myOwner = this.player.smallID();
    clusterTerritoryIds[startIdx] = territoryId;

    while (stack.length > 0) {
      const tile = stack.pop()!;
      const numNeighbors = map.neighbors8(tile, this.nbuf8);
      for (let nIdx = 0; nIdx < numNeighbors; nIdx++) {
        const n = this.nbuf8[nIdx];
        if (visited[n] === floodGen) continue;
        if (map.ownerID(n) === myOwner) {
          visited[n] = floodGen;
          stack.push(n);
          const cIdxPlusOne = state.clusterIndexMap[n];
          if (cIdxPlusOne > 0) {
            clusterTerritoryIds[cIdxPlusOne - 1] = territoryId;
          }
        }
      }
    }
    return nextTerritoryId;
  }

  // Perf: Accepts raw bounds to skip allocating {min, max} Box objects for every target evaluated.
  private surroundedBySamePlayer(
    cluster: readonly TileRef[],
    clusterBoxMinX: number,
    clusterBoxMinY: number,
    clusterBoxMaxX: number,
    clusterBoxMaxY: number,
  ): false | Player {
    const enemies = new Set<number>();

    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;

    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let j = 0; j < cluster.length; j++) {
      const tile = cluster[j];
      if (map.isOceanShore(tile) || map.isOnEdgeOfMap(tile)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId === 0) {
          // Unowned neighbor: the cluster is not fully surrounded.
          return false;
        }
        if (ownerId !== mySmallID) {
          enemies.add(ownerId);
          const px = map.x(n);
          const py = map.y(n);
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      }
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }

    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    if (
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    ) {
      return enemy;
    }
    return false;
  }

  /**
   * The enemy box test ignores unclaimed land, but only fallout leaves the
   * cluster a severed-land candidate: open land rules that out. Coast or map
   * edge rules out both. Coast, map edge or open land make it CLUSTER_OPEN.
   */
  // Perf: Accepts raw bounds to skip allocating {min, max} Box objects.
  private classifyCluster(
    cluster: readonly TileRef[],
    clusterBoxMinX: number,
    clusterBoxMinY: number,
    clusterBoxMaxX: number,
    clusterBoxMaxY: number,
  ): number {
    let hasEnemy = false;
    let hasFallout = false;
    let hasOpenLand = false;
    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let j = 0; j < cluster.length; j++) {
      const tr = cluster[j];
      if (map.isShore(tr) || map.isOnEdgeOfMap(tr)) {
        return CLUSTER_OPEN;
      }
      const numNeighbors = map.neighbors4(tr, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId !== 0 && ownerId !== mySmallID) {
          hasEnemy = true;
          const x = map.x(n);
          const y = map.y(n);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        } else if (ownerId === 0) {
          if (map.hasFallout(n)) hasFallout = true;
          else hasOpenLand = true;
        }
      }
    }
    if (!hasEnemy) {
      return hasOpenLand ? CLUSTER_OPEN : 0;
    }
    let result = hasOpenLand ? CLUSTER_OPEN : 0;
    if (
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    ) {
      result |= CLUSTER_SURROUNDED;
    }
    if (hasFallout && !hasOpenLand) {
      result |= CLUSTER_SEVERED_CANDIDATE;
    }
    return result;
  }

  private removeCluster(cluster: readonly TileRef[]) {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster[0];
    if (firstTile === undefined) {
      return;
    }

    // The checks above only ever looked at this one cluster of border tiles,
    // but the fill below hands over the whole territory the cluster sits on.
    // Those are different sets: every hole in a territory — an enemy enclave,
    // a nuke crater — gives it another border cluster, so a cluster that
    // passes can be wrapped around a hole in the middle of a wide open
    // empire. Verify the land actually changing hands is sealed in.
    if (!this.isEnclosed(firstTile)) {
      return;
    }

    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      [firstTile],
      false,
      (tile) => this.mg.ownerID(tile) === this.player.smallID(),
    );

    if (this.player.numTilesOwned() === tiles.length) {
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  /**
   * Whether the player's territory reachable from `start` is walled in by
   * other players: walking from it through our own tiles and any unclaimed
   * land can never reach water or the edge of the map, so the only way out
   * is across someone else's territory.
   *
   * Unclaimed land is walked through rather than treated as a way out — a
   * crater inside our own land is a hole, not an exit — but water and the
   * map edge end it, matching what the cluster checks already require of the
   * tiles they inspect.
   */
  private isEnclosed(start: TileRef): boolean {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const state = this.traversalState();
    const gen = bumpTraversalGeneration(state);
    const visited = state.visited;
    const stack = state.stack;
    stack.length = 0;
    visited[start] = gen;
    stack.push(start);

    while (stack.length > 0) {
      const tile = stack.pop()!;
      if (map.isOnEdgeOfMap(tile)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        if (visited[n] === gen) {
          continue;
        }
        const ownerId = map.ownerID(n);
        if (ownerId !== 0 && ownerId !== mySmallID) {
          // Someone else's tile — part of the wall, so stop here.
          continue;
        }
        if (ownerId === 0 && !map.isLand(n)) {
          // Open water is a way out.
          return false;
        }
        visited[n] = gen;
        stack.push(n);
      }
    }
    return true;
  }

  private getCapturingPlayer(cluster: readonly TileRef[]): Player | null {
    const neighbors = new Map<Player, number>();
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const t of cluster) {
      const numNeighbors = map.neighbors4(t, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const ownerId = map.ownerID(this.nbuf[i]);
        if (ownerId === 0 || ownerId === mySmallID) {
          continue;
        }
        const owner = this.mg.playerBySmallID(ownerId) as Player;
        if (!owner.isFriendly(this.player)) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      }
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const [neighbor] of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // There are no ongoing attacks, so find the enemy with the largest border.
    return getMode(neighbors);
  }

  private calculateClusters(): { clusters: TileRef[][]; boxes: Int32Array } {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0)
      return { clusters: [], boxes: new Int32Array(0) };

    const state = this.traversalState();
    const visited = state.visited;
    // Two generation stamps on the one scratch array: first stamp every
    // border tile with `borderGen`, then flood with `currentGen`. Membership
    // becomes a single typed-array read instead of a hash probe for each of
    // the 8 neighbours of every border tile (this fill was ~15 % of a
    // headless game's CPU).
    const borderGen = this.bumpGenerations(2);
    const currentGen = borderGen + 1;
    borderTiles.forEach((tile) => {
      visited[tile] = borderGen;
    });

    const clusters: TileRef[][] = [];
    let boxes = new Int32Array(64);
    let clusterIdx = 0;

    // Set.forEach instead of for..of: iterating a large Set allocates an
    // iterator-result object per element, and border sets can be huge.
    const includeFn = (tile: TileRef) => visited[tile] === borderGen;
    borderTiles.forEach((startTile) => {
      if (visited[startTile] === currentGen) return;

      if (clusterIdx * 4 >= boxes.length) {
        const newBoxes = new Int32Array(boxes.length * 2);
        newBoxes.set(boxes);
        boxes = newBoxes;
      }

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        true,
        includeFn,
        boxes,
        clusterIdx * 4,
      );
      clusters.push(cluster);
      clusterIdx++;
    });
    return { clusters, boxes };
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  private traversalState(): TileTraversalScratch {
    return tileTraversalScratch(this.mg);
  }

  private bumpGeneration(): number {
    return bumpTraversalGeneration(this.traversalState());
  }

  /**
   * Starts `count` passes at once and returns the first generation; the
   * others follow it in order. Use it for stamps that must stay live
   * together: if the counter wraps, which clears every stamp, it takes a
   * fresh run after the wrap.
   */
  private bumpGenerations(count: number): number {
    const first = this.bumpGeneration();
    let last = first;
    for (let i = 1; i < count; i++) last = this.bumpGeneration();
    return last - first === count - 1 ? first : this.bumpGenerations(count);
  }

  // Perf: Replaced `neighborFn` closure parameter with a native 1D loop via `GameMap.neighbors8/4`.
  // Computes cluster boundary extremes natively inside `outBox` without requiring a secondary iterator pass.
  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    diag: boolean,
    includeFn: (tile: TileRef) => boolean,
    outBox?: Int32Array,
    outBoxOffset?: number,
  ): TileRef[] {
    // The visited generation array already deduplicates, so the result can be
    // a plain array (in mark order) — far cheaper than a Set of the same
    // size. The DFS stack is reused across fills via the traversal state.
    const result: TileRef[] = [];
    const stack = this.traversalState().stack;
    stack.length = 0;

    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    const map = this.map;

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.push(start);
      stack.push(start);
      if (outBox !== undefined) {
        const x = map.x(start);
        const y = map.y(start);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    const nbuf = diag ? this.nbuf8 : this.nbuf;

    while (stack.length > 0) {
      const tile = stack.pop()!;
      const numNeighbors = diag
        ? map.neighbors8(tile, nbuf)
        : map.neighbors4(tile, nbuf);

      for (let i = 0; i < numNeighbors; i++) {
        const neighbor = nbuf[i];
        if (visited[neighbor] === currentGen) continue;
        if (!includeFn(neighbor)) continue;

        visited[neighbor] = currentGen;
        result.push(neighbor);
        stack.push(neighbor);

        if (outBox !== undefined) {
          const x = map.x(neighbor);
          const y = map.y(neighbor);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Perf: Commit the cluster's boundary extremes directly into the pre-allocated flat Int32Array.
    // The array stores consecutive [minX, minY, maxX, maxY] structs linearly via `outBoxOffset`.
    // By passing outBox down to the DFS, we completely sidestep allocating and returning temporary `Box` or `Cell` objects.
    if (outBox !== undefined && outBoxOffset !== undefined) {
      outBox[outBoxOffset] = minX;
      outBox[outBoxOffset + 1] = minY;
      outBox[outBoxOffset + 2] = maxX;
      outBox[outBoxOffset + 3] = maxY;
    }

    return result;
  }

  private removeOnDeath(): void {
    // Player (bot, human, nation) has no tiles
    // Delete any remaining gold, non-nuke units and alliances
    const gold = this.player.gold();
    this.player.removeGold(gold);

    this.player.units().forEach((u) => {
      if (
        u.type() !== UnitType.AtomBomb &&
        u.type() !== UnitType.HydrogenBomb &&
        u.type() !== UnitType.MIRVWarhead &&
        u.type() !== UnitType.MIRV
      ) {
        u.delete();
      }
    });

    this.player.removeAllAlliances();
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return PlayerExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      lastCalc: this.lastCalc,
      player: w.player(this.player),
    });
  }

  restoreSnapshot(s: PlayerExecState, r: SnapshotReader): void {
    this.ticksPerClusterCalc = TICKS_PER_CLUSTER_CALC;
    this.active = s.active;
    if (s.initialized) {
      this.mg = r.game;
      this.map = r.game.map();
      this.config = r.game.config();
    }
    this.lastCalc = s.lastCalc;
    // Scratch neighbor buffers: always written before they are read.
    this.nbuf = [0, 0, 0, 0];
    this.nbuf8 = [0, 0, 0, 0, 0, 0, 0, 0];
    this.player = r.player(s.player);
  }
}

// A cluster that splitCluster leaves whole, as its one part: it lies in a
// single territory, so its class as a cluster is that part's class.
function wholeCluster(
  cluster: TileRef[],
  boxes: ArrayLike<number>,
  boxOffset: number,
  cls: number,
): TerritoryParts {
  return {
    clusters: [cluster],
    boxes: [
      boxes[boxOffset],
      boxes[boxOffset + 1],
      boxes[boxOffset + 2],
      boxes[boxOffset + 3],
    ],
    classes: [cls],
  };
}

// Adds the parts that race for the main body: every part with `all`, else
// the candidates and, with `withOpen`, the parts with a way out.
function addRacePieces(
  pieces: MainBodyPieces,
  parts: TerritoryParts,
  all: boolean,
  withOpen: boolean,
): void {
  for (let k = 0; k < parts.clusters.length; k++) {
    const cls = parts.classes[k];
    const open = (cls & CLUSTER_OPEN) !== 0;
    if (
      !all &&
      (cls & CLUSTER_SEVERED_CANDIDATE) === 0 &&
      !(withOpen && open)
    ) {
      continue;
    }
    pieces.clusters.push(parts.clusters[k]);
    pieces.open.push(open);
    pieces.boxes.push(
      parts.boxes[k * 4],
      parts.boxes[k * 4 + 1],
      parts.boxes[k * 4 + 2],
      parts.boxes[k * 4 + 3],
    );
  }
}

// The flood that `part` has merged into, following `roots` to the end.
function rootOf(roots: Int32Array, part: number): number {
  while (roots[part] !== part) part = roots[part];
  return part;
}

const PlayerExecStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  lastCalc: zInt(),
  player: zPlayerRef(),
});
type PlayerExecState = z.infer<typeof PlayerExecStateSchema>;

export const PlayerExecutionSnapshot = execSnapshotType({
  name: "Player",
  version: 1,
  schema: PlayerExecStateSchema,
  cls: () => PlayerExecution,
});
