import { Colord } from "colord";
import { base64url } from "jose";
import { decodePatternData } from "../core/PatternDecoder";
import { PlayerType } from "../core/game/Game";
import { GameView } from "../core/game/GameView";
import { uploadFrameData } from "./render/frame/Upload";
import {
  PlayerStatic,
  SpawnCenter,
  GameView as WebGLGameView,
} from "./render/gl";

const PALETTE_SIZE = 4096;

/**
 * The renderer-side glue between GameView (which already builds the full
 * FrameData each tick) and the WebGL view. Two responsibilities:
 *
 *   1. Palette management — translate PlayerView colors into a Float32Array
 *      the renderer uploads to a 1D texture, and call view.addPlayers() when
 *      new players appear (this is a renderer-side lifecycle event, not part
 *      of FrameData).
 *   2. Per-tick upload — pass the FrameData to the renderer's uploadFrameData
 *      helper, which dispatches to all the view.update*() methods.
 */
export class WebGLFrameBuilder {
  private readonly palette: Float32Array;
  private readonly patternMeta: Float32Array;
  private readonly patternData: Uint8Array;

  private readonly knownSmallIDs = new Set<number>();
  // The renderer needs to know which player is "me" so affiliation tint,
  // unit colors, and SAM-radius perspective work. Push it once the local
  // player's update arrives (may take several ticks during join).
  private localPlayerSmallID = 0;
  // Scratch buffer for terrain-delta uploads (parallel to the refs list).
  private terrainDeltaBytes: Uint8Array = new Uint8Array(0);

  constructor(private readonly view: WebGLGameView) {
    this.palette = new Float32Array(PALETTE_SIZE * 2 * 4);
    this.patternMeta = new Float32Array(PALETTE_SIZE * 4);
    this.patternData = new Uint8Array(PALETTE_SIZE * 1024);
  }

  update(gameView: GameView): void {
    this.syncPlayers(gameView);
    this.syncLocalPlayer(gameView);
    this.syncSpawnOverlay(gameView);
    this.syncTerrainDeltas(gameView);
    uploadFrameData(this.view, gameView.frameData());
  }

  /**
   * Water-nuke conversions (land → water) mutate the underlying terrain.
   * Forward this tick's terrain-changed refs to the renderer so it can
   * re-upload those texels in both the RGBA color texture and the R8UI
   * water-detection texture used by railroads/bridges.
   */
  private syncTerrainDeltas(gameView: GameView): void {
    const refs = gameView.recentlyUpdatedTerrainTiles();
    if (refs.length === 0) return;
    if (this.terrainDeltaBytes.length < refs.length) {
      this.terrainDeltaBytes = new Uint8Array(refs.length);
    }
    for (let i = 0; i < refs.length; i++) {
      this.terrainDeltaBytes[i] = gameView.terrainByte(refs[i]);
    }
    this.view.applyTerrainDelta(refs, this.terrainDeltaBytes);
  }

  private syncLocalPlayer(gameView: GameView): void {
    const sid = gameView.myPlayer()?.smallID() ?? 0;
    if (sid === this.localPlayerSmallID) return;
    this.localPlayerSmallID = sid;
    this.view.setLocalPlayerID(sid);
  }

  /**
   * Spawn-phase highlights: each already-spawned human player gets a colored
   * ring + tile glow around their starting territory. Pushed every tick
   * during spawn phase; the pass animates locally from the snapshot.
   */
  private syncSpawnOverlay(gameView: GameView): void {
    const inSpawnPhase = gameView.inSpawnPhase();
    if (!inSpawnPhase) {
      this.view.updateSpawnOverlay(false, []);
      return;
    }
    const me = gameView.myPlayer();
    const myTeam = me?.team() ?? null;
    const centers: SpawnCenter[] = [];
    for (const p of gameView.players()) {
      if (!p.isPlayer() || p.type() !== PlayerType.Human) continue;
      if (!p.hasSpawned()) continue;
      const isSelf = me !== null && p.smallID() === me.smallID();
      // myPlayer reads as plain white so the local-player ring is visually
      // distinct from any team color; everyone else uses their territory tint.
      const c = isSelf
        ? { r: 255, g: 255, b: 255 }
        : p.territoryColor().toRgb();
      centers.push({
        x: p.nameData?.x ?? 0,
        y: p.nameData?.y ?? 0,
        r: c.r / 255,
        g: c.g / 255,
        b: c.b / 255,
        isSelf,
        isTeammate:
          myTeam !== null &&
          p.team() === myTeam &&
          p.smallID() !== me?.smallID(),
      });
    }
    this.view.updateSpawnOverlay(true, centers);
  }

  private syncPlayers(gameView: GameView): void {
    const newPlayers: PlayerStatic[] = [];
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      if (this.knownSmallIDs.has(smallID)) continue;
      this.knownSmallIDs.add(smallID);

      this.writePaletteEntry(smallID, p.territoryColor(), p.borderColor());

      const pattern = p.cosmetics.pattern;
      if (pattern && pattern.patternData) {
        try {
          const decoded = decodePatternData(
            pattern.patternData,
            base64url.decode,
          );
          const metaOff = smallID * 4;
          this.patternMeta[metaOff] = 1.0; // hasPattern = true
          this.patternMeta[metaOff + 1] = decoded.width;
          this.patternMeta[metaOff + 2] = decoded.height;
          this.patternMeta[metaOff + 3] = decoded.scale;

          this.patternData.set(decoded.bytes.slice(3), smallID * 1024);
        } catch (e) {
          console.warn("Failed to decode territory pattern", e);
        }
      }

      newPlayers.push({
        ...p.static,
        flag: p.cosmetics.flag,
        color: p.territoryColor().toHex(),
      });
    }
    if (newPlayers.length > 0) {
      this.view.addPlayers(
        newPlayers,
        this.palette,
        this.patternMeta,
        this.patternData,
      );
    }
  }

  private writePaletteEntry(
    smallID: number,
    fill: Colord,
    border: Colord,
  ): void {
    const fillRgba = fill.toRgb();
    const fillOff = smallID * 4;
    this.palette[fillOff] = fillRgba.r / 255;
    this.palette[fillOff + 1] = fillRgba.g / 255;
    this.palette[fillOff + 2] = fillRgba.b / 255;
    this.palette[fillOff + 3] = 150 / 255;

    const borderRgba = border.toRgb();
    const borderOff = PALETTE_SIZE * 4 + smallID * 4;
    this.palette[borderOff] = borderRgba.r / 255;
    this.palette[borderOff + 1] = borderRgba.g / 255;
    this.palette[borderOff + 2] = borderRgba.b / 255;
    this.palette[borderOff + 3] = 1.0;
  }
}
