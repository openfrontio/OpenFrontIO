/**
 * NamePass — GPU-rendered player names + troop counts using MSDF text.
 *
 * All text layout, interpolation, and sizing runs on the GPU via instanced
 * rendering. CPU cost per frame is effectively zero: one uniform update and
 * one instanced draw call. Data changes (position/size targets, troop counts)
 * are pushed as tiny texture sub-updates.
 *
 * Submodules:
 *   - text-program   — MSDF text shader (names + troop counts)
 *   - icon-program   — instanced flag + emoji icons
 *   - debug-program  — wireframe bounding boxes for layout debugging
 *   - atlas-data     — font/atlas parsing + glyph lookup tables
 *   - text-layout    — pure CPU text shaping (cursor positions)
 *   - data-textures  — GL data texture factories
 *   - types          — shared interfaces + constants
 */

import type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  PlayerStatusData,
  RendererConfig,
} from "../../../types";
import { PlayerTypeEnum } from "../../../types";
import type { RenderSettings } from "../../RenderSettings";
import { createFullscreenQuad } from "../../utils/GlUtils";

import type { GlyphTables } from "./AtlasData";
import {
  buildEmojiLookup,
  buildFlagLookup,
  buildGlyphTables,
  buildKernTable,
  parseAtlasData,
} from "./AtlasData";
import {
  buildCursorTex,
  buildGlyphMetricsTex,
  buildPlayerDataTex,
  buildStringTex,
} from "./DataTextures";
import { DebugProgram } from "./DebugProgram";
import { IconProgram } from "./IconProgram";
import { StatusIconProgram } from "./StatusIconProgram";
import { formatTroops, layoutString } from "./TextLayout";
import { TextProgram } from "./TextProgram";
import type { PlayerSlot } from "./Types";
import { LINES_PER_PLAYER, MAX_CHARS } from "./Types";

export class NamePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  // Shared geometry
  private vao: WebGLVertexArrayObject;

  // Shared data textures
  private glyphMetricsTex: WebGLTexture;
  private cursorTex: WebGLTexture;
  private stringTex: WebGLTexture;
  private playerDataTex: WebGLTexture;

  // Sub-programs
  private textProgram: TextProgram;
  private iconProgram: IconProgram;
  private statusIconProgram: StatusIconProgram;
  private debugProgram: DebugProgram;

  // Atlas + glyph data
  private glyph: GlyphTables;
  private kernTable: Int8Array;

  // Player management
  private playerByID: Map<string, PlayerStatic>;
  private smallIDToPlayerID: Map<number, string>;
  private slots: Map<string, PlayerSlot> = new Map();
  private maxPlayers: number;
  private playerColors: Map<string, [number, number, number]> = new Map();
  private flagCodeToIndex: Map<string, number>;
  private emojiCharToIndex: Map<string, number>;

  // CPU-side mirrors — batched upload in draw()
  private cpuPlayerData: Float32Array;
  private cpuStringData: Uint8Array;
  private cpuCursorData: Float32Array;
  private playerDataDirty = false;
  private stringDataDirty = false;
  private cursorDataDirty = false;

  // Reusable buffers for text layout
  private stringRow: Uint8Array;
  private cursorRow: Float32Array;

  // Reusable per-tick lookup maps (avoid allocation + GC)
  private alivePlayerIDs = new Set<string>();
  private troopsByPlayerID = new Map<string, number>();
  private playerStateByID = new Map<string, PlayerState>();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    paletteData: Float32Array,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.maxPlayers = header.maxPlayers ?? header.players.length;

    // Parse atlas + build CPU lookup tables
    const atlas = parseAtlasData();
    this.glyph = buildGlyphTables(atlas.chars);
    this.kernTable = buildKernTable(atlas.kernings);
    this.flagCodeToIndex = buildFlagLookup();
    this.emojiCharToIndex = buildEmojiLookup();

    // Build player lookups and extract territory colors from palette
    this.playerByID = new Map();
    this.smallIDToPlayerID = new Map();
    for (const p of header.players) {
      this.playerByID.set(p.id, p);
      this.smallIDToPlayerID.set(p.smallID, p.id);
      const off = p.smallID * 4;
      this.playerColors.set(p.id, [
        paletteData[off],
        paletteData[off + 1],
        paletteData[off + 2],
      ]);
    }

    // CPU-side texture mirrors + reusable layout buffers
    const textRows = this.maxPlayers * LINES_PER_PLAYER;
    this.cpuPlayerData = new Float32Array(8 * this.maxPlayers * 4);
    this.cpuStringData = new Uint8Array(MAX_CHARS * textRows);
    this.cpuCursorData = new Float32Array(MAX_CHARS * textRows);
    this.stringRow = new Uint8Array(MAX_CHARS);
    this.cursorRow = new Float32Array(MAX_CHARS);

    // Shared VAO (unit [0,1]² quad)
    this.vao = createFullscreenQuad(gl);

    // Data textures
    this.glyphMetricsTex = buildGlyphMetricsTex(gl, atlas);
    this.cursorTex = buildCursorTex(gl, this.maxPlayers);
    this.stringTex = buildStringTex(gl, this.maxPlayers);
    this.playerDataTex = buildPlayerDataTex(gl, this.maxPlayers);

    // Sub-programs
    this.textProgram = new TextProgram(gl, atlas, {
      glyphMetrics: this.glyphMetricsTex,
      cursor: this.cursorTex,
      strings: this.stringTex,
      playerData: this.playerDataTex,
    });
    this.iconProgram = new IconProgram(
      gl,
      atlas,
      this.playerDataTex,
      this.maxPlayers,
    );
    this.statusIconProgram = new StatusIconProgram(
      gl,
      atlas,
      this.playerDataTex,
      this.maxPlayers,
    );
    this.debugProgram = new DebugProgram(
      gl,
      atlas,
      this.playerDataTex,
      this.maxPlayers,
    );
  }

  // -------------------------------------------------------------------------
  // Late player registration (bots arrive on tick 1)
  // -------------------------------------------------------------------------

  /** Register players that arrived after construction (palette already updated). */
  addPlayers(players: PlayerStatic[], paletteData: Float32Array): void {
    for (const p of players) {
      if (this.playerByID.has(p.id)) continue;
      this.playerByID.set(p.id, p);
      this.smallIDToPlayerID.set(p.smallID, p.id);
      const off = p.smallID * 4;
      this.playerColors.set(p.id, [
        paletteData[off],
        paletteData[off + 1],
        paletteData[off + 2],
      ]);
    }
  }

  // -------------------------------------------------------------------------
  // Name updates — called by GPURenderer
  // -------------------------------------------------------------------------

  updateNames(
    names: Map<string, NameEntry>,
    players: Map<number, PlayerState>,
    snap: boolean,
    statusData?: Map<number, PlayerStatusData>,
  ): void {
    const now = performance.now() / 1000;

    // Build alive set and emoji lookup from smallID → playerID
    const alivePlayerIDs = this.alivePlayerIDs;
    alivePlayerIDs.clear();
    const troopsByPlayerID = this.troopsByPlayerID;
    troopsByPlayerID.clear();
    const playerStateByID = this.playerStateByID;
    playerStateByID.clear();
    for (const [, ps] of players) {
      const pid = this.smallIDToPlayerID.get(ps.smallID);
      if (!pid) continue;
      if (ps.isAlive) alivePlayerIDs.add(pid);
      troopsByPlayerID.set(pid, ps.troops ?? 0);
      playerStateByID.set(pid, ps);
    }

    // Assign slot indices to players (stable ordering by header index)
    let nextSlotIndex = 0;
    for (const p of this.playerByID.values()) {
      if (!this.slots.has(p.id)) {
        const flagCode = p.flag;
        this.slots.set(p.id, {
          index: nextSlotIndex++,
          playerID: p.id,
          static: p,
          srcX: 0,
          srcY: 0,
          srcScale: 0,
          tgtX: 0,
          tgtY: 0,
          tgtScale: 0,
          startTime: now,
          alive: false,
          nameLen: 0,
          troopLen: 0,
          lastTroopStr: "",
          flagAtlasIdx: flagCode
            ? (this.flagCodeToIndex.get(flagCode) ?? -1)
            : -1,
          emojiAtlasIdx: -1,
          nameHalfWidth: 0,
          crown: false,
          traitor: false,
          disconnected: false,
          alliance: false,
          allianceReq: false,
          target: false,
          embargo: false,
          nukeActive: false,
          nukeTargetsMe: false,
          traitorRemainingTicks: 0,
          allianceFraction: 0,
        });
      } else {
        nextSlotIndex = Math.max(
          nextSlotIndex,
          this.slots.get(p.id)!.index + 1,
        );
      }
    }

    for (const [playerID, entry] of names) {
      const slot = this.slots.get(playerID);
      if (!slot) continue;

      const alive = alivePlayerIDs.has(playerID);

      // Skip dead players already marked dead — no work needed
      if (!alive && !slot.alive) continue;

      // Newly dead: mark and write once, then skip expensive work
      if (!alive && slot.alive) {
        slot.alive = false;
        this.writePlayerDataRow(slot);
        continue;
      }

      // Track whether anything changed that requires a GPU write
      let dirty = !slot.alive; // first time alive → must write
      slot.alive = alive;

      // Write name string (only on first encounter)
      if (slot.nameLen === 0) {
        const name = slot.static.displayName;
        slot.nameLen = Math.min(name.length, MAX_CHARS);
        slot.nameHalfWidth = this.uploadStringRow(
          slot.index * LINES_PER_PLAYER,
          name,
        );
        dirty = true;
      }

      // Write troop count string (only if changed)
      const troops = troopsByPlayerID.get(playerID) ?? 0;
      const troopStr = formatTroops(troops);
      if (troopStr !== slot.lastTroopStr) {
        slot.troopLen = Math.min(troopStr.length, MAX_CHARS);
        slot.lastTroopStr = troopStr;
        this.uploadStringRow(slot.index * LINES_PER_PLAYER + 1, troopStr);
        dirty = true;
      }

      // Check if target position changed — only then recompute lerp source
      if (
        entry.x !== slot.tgtX ||
        entry.y !== slot.tgtY ||
        entry.size !== slot.tgtScale
      ) {
        if (!snap) {
          const elapsed = now - slot.startTime;
          const t = Math.min(
            1 - Math.exp(-this.settings.name.lerpSpeed * elapsed),
            1,
          );
          slot.srcX = slot.srcX + (slot.tgtX - slot.srcX) * t;
          slot.srcY = slot.srcY + (slot.tgtY - slot.srcY) * t;
          slot.srcScale = slot.srcScale + (slot.tgtScale - slot.srcScale) * t;
        } else {
          slot.srcX = entry.x;
          slot.srcY = entry.y;
          slot.srcScale = entry.size;
        }
        slot.tgtX = entry.x;
        slot.tgtY = entry.y;
        slot.tgtScale = entry.size;
        slot.startTime = now;
        dirty = true;
      }

      // Resolve active broadcast emoji for this player
      let newEmoji = -1;
      const ps = playerStateByID.get(playerID);
      if (ps?.outgoingEmojis && ps.outgoingEmojis.length > 0) {
        for (const e of ps.outgoingEmojis) {
          if (e.recipientID === "AllPlayers") {
            const idx = this.emojiCharToIndex.get(e.message);
            if (idx !== undefined) {
              newEmoji = idx;
              break;
            }
          }
        }
      }
      if (newEmoji !== slot.emojiAtlasIdx) {
        slot.emojiAtlasIdx = newEmoji;
        dirty = true;
      }

      // Resolve status data from per-player map — diff each field
      const sd = statusData?.get(slot.static.smallID);
      const crown = sd?.crown ?? false;
      const traitor = sd?.traitor ?? false;
      const disconnected = sd?.disconnected ?? false;
      const alliance = sd?.alliance ?? false;
      const allianceReq = sd?.allianceReq ?? false;
      const target = sd?.target ?? false;
      const embargo = sd?.embargo ?? false;
      const nukeActive = sd?.nukeActive ?? false;
      const nukeTargetsMe = sd?.nukeTargetsMe ?? false;
      const traitorRemainingTicks = sd?.traitorRemainingTicks ?? 0;
      const allianceFraction = sd?.allianceFraction ?? 0;

      if (
        crown !== slot.crown ||
        traitor !== slot.traitor ||
        disconnected !== slot.disconnected ||
        alliance !== slot.alliance ||
        allianceReq !== slot.allianceReq ||
        target !== slot.target ||
        embargo !== slot.embargo ||
        nukeActive !== slot.nukeActive ||
        nukeTargetsMe !== slot.nukeTargetsMe ||
        traitorRemainingTicks !== slot.traitorRemainingTicks ||
        allianceFraction !== slot.allianceFraction
      ) {
        slot.crown = crown;
        slot.traitor = traitor;
        slot.disconnected = disconnected;
        slot.alliance = alliance;
        slot.allianceReq = allianceReq;
        slot.target = target;
        slot.embargo = embargo;
        slot.nukeActive = nukeActive;
        slot.nukeTargetsMe = nukeTargetsMe;
        slot.traitorRemainingTicks = traitorRemainingTicks;
        slot.allianceFraction = allianceFraction;
        dirty = true;
      }

      if (dirty) this.writePlayerDataRow(slot);
    }

    // Update alive/dead status for players not in the names map
    for (const [pid, slot] of this.slots) {
      if (!names.has(pid) && slot.alive) {
        slot.alive = false;
        this.writePlayerDataRow(slot);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Texture sub-update helpers
  // -------------------------------------------------------------------------

  /** Lay out a string into CPU buffers (flushed to GPU in draw). Returns halfWidth. */
  private uploadStringRow(row: number, text: string): number {
    const halfWidth = layoutString(
      text,
      this.glyph,
      this.kernTable,
      this.stringRow,
      this.cursorRow,
    );

    const off = row * MAX_CHARS;
    this.cpuStringData.set(this.stringRow, off);
    this.cpuCursorData.set(this.cursorRow, off);
    this.stringDataDirty = true;
    this.cursorDataDirty = true;

    return halfWidth;
  }

  /** Pack player data into the CPU buffer (flushed to GPU in draw). */
  private writePlayerDataRow(slot: PlayerSlot): void {
    const d = this.cpuPlayerData;
    const off = slot.index * 32; // 8 columns × 4 floats per RGBA texel

    // Column 0: srcX, srcY, srcScale, startTime
    d[off + 0] = slot.srcX;
    d[off + 1] = slot.srcY;
    d[off + 2] = slot.srcScale;
    d[off + 3] = slot.startTime;

    // Column 1: tgtX, tgtY, tgtScale, alive
    d[off + 4] = slot.tgtX;
    d[off + 5] = slot.tgtY;
    d[off + 6] = slot.tgtScale;
    d[off + 7] = slot.alive ? 1.0 : 0.0;

    // Column 2: player territory color (r, g, b) + alpha
    const color = this.playerColors.get(slot.playerID) ?? [0, 0, 0];
    d[off + 8] = color[0];
    d[off + 9] = color[1];
    d[off + 10] = color[2];
    d[off + 11] = 1.0;

    // Column 3: nameLen, troopLen, isHuman, nameHalfWidth
    d[off + 12] = slot.nameLen;
    d[off + 13] = slot.troopLen;
    d[off + 14] = slot.static.playerType === PlayerTypeEnum.Human ? 1.0 : 0.0;
    d[off + 15] = slot.nameHalfWidth;

    // Column 4: flagAtlasIdx, emojiAtlasIdx, [free], [free]
    d[off + 16] = slot.flagAtlasIdx;
    d[off + 17] = slot.emojiAtlasIdx;
    d[off + 18] = 0;
    d[off + 19] = 0;

    // Column 5: crown, traitor, disconnected, alliance
    d[off + 20] = slot.crown ? 1.0 : 0.0;
    d[off + 21] = slot.traitor ? 1.0 : 0.0;
    d[off + 22] = slot.disconnected ? 1.0 : 0.0;
    d[off + 23] = slot.alliance ? 1.0 : 0.0;

    // Column 6: allianceReq, target, embargo, nukeActive
    d[off + 24] = slot.allianceReq ? 1.0 : 0.0;
    d[off + 25] = slot.target ? 1.0 : 0.0;
    d[off + 26] = slot.embargo ? 1.0 : 0.0;
    d[off + 27] = slot.nukeActive ? 1.0 : 0.0;

    // Column 7: nukeTargetsMe, traitorRemainingTicks, allianceFraction, [free]
    d[off + 28] = slot.nukeTargetsMe ? 1.0 : 0.0;
    d[off + 29] = slot.traitorRemainingTicks;
    d[off + 30] = slot.allianceFraction;
    d[off + 31] = 0;

    this.playerDataDirty = true;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  draw(cameraMatrix: Float32Array, ambient: number): void {
    if (!this.textProgram.ready) return;
    if (this.slots.size === 0) return;

    const gl = this.gl;
    if (this.stringDataDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.stringTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        MAX_CHARS,
        this.maxPlayers * LINES_PER_PLAYER,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.cpuStringData,
      );
      this.stringDataDirty = false;
    }
    if (this.cursorDataDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.cursorTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        MAX_CHARS,
        this.maxPlayers * LINES_PER_PLAYER,
        gl.RED,
        gl.FLOAT,
        this.cpuCursorData,
      );
      this.cursorDataDirty = false;
    }
    if (this.playerDataDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.playerDataTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        8,
        this.maxPlayers,
        gl.RGBA,
        gl.FLOAT,
        this.cpuPlayerData,
      );
      this.playerDataDirty = false;
    }

    this.textProgram.draw(
      cameraMatrix,
      this.settings,
      this.vao,
      this.maxPlayers,
      ambient,
    );
    this.iconProgram.draw(cameraMatrix, this.settings, this.vao);
    this.statusIconProgram.draw(cameraMatrix, this.settings, this.vao);

    if (this.settings.passEnabled.nameDebug) {
      this.debugProgram.draw(cameraMatrix, this.settings, this.vao);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(): void {
    const gl = this.gl;
    this.textProgram.dispose();
    this.iconProgram.dispose();
    this.statusIconProgram.dispose();
    this.debugProgram.dispose();
    gl.deleteTexture(this.glyphMetricsTex);
    gl.deleteTexture(this.cursorTex);
    gl.deleteTexture(this.stringTex);
    gl.deleteTexture(this.playerDataTex);
    gl.deleteVertexArray(this.vao);
  }
}
