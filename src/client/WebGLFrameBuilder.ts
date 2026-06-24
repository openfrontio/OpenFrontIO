import { Colord } from "colord";
import { base64url } from "jose";
import { assetUrl } from "../core/AssetUrls";
import { decodePatternData } from "../core/PatternDecoder";
import { PlayerType } from "../core/game/Game";
import { uploadFrameData } from "./render/frame/Upload";
// Type-only: a value import would pull GPURenderer and its `.glsl?raw` shader
// imports into any non-Vite consumer (e.g. the Node perf harness).
import type { MapRenderer, PlayerStatic, SpawnCenter } from "./render/gl";
import type { GameView } from "./view";

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
  /**
   * Last spawn tile pushed to the renderer per smallID. Players can re-pick
   * spawn during the spawn phase, so this tracks the latest value rather than
   * just first-seen — re-uploads only when the tile actually changes.
   */
  private readonly lastSpawnTile = new Map<number, number>();
  /** Skin atlas allocated once on first syncPlayers — player set is locked at game start. */
  private skinsInitialized = false;
  // The renderer needs to know which player is "me" so affiliation tint,
  // unit colors, and SAM-radius perspective work. Push it once the local
  // player's update arrives (may take several ticks during join).
  private localPlayerSmallID = 0;
  // Scratch buffer for terrain-delta uploads (parallel to the refs list).
  private terrainDeltaBytes: Uint8Array = new Uint8Array(0);

  constructor(private readonly view: MapRenderer) {
    this.palette = new Float32Array(PALETTE_SIZE * 2 * 4);
    this.patternMeta = new Float32Array(PALETTE_SIZE * 4);
    this.patternData = new Uint8Array(PALETTE_SIZE * 1024);
  }

  /** Drop internal caches to force a full re-upload of state on the next update(). */
  clearCaches(): void {
    this.knownSmallIDs.clear();
    this.lastSpawnTile.clear();
    this.localPlayerSmallID = 0;
    this.skinsInitialized = false;
  }

  /**
   * Re-write every player's palette entry from their current (possibly re-themed)
   * colors and re-upload just the palette texture. Used after a mid-game theme
   * change (e.g. toggling colorblind mode) so existing territories re-color
   * without re-syncing players, skins, or spawns.
   */
  refreshPalette(gameView: GameView): void {
    for (const p of gameView.players()) {
      this.writePaletteEntry(p.smallID(), p.territoryColor(), p.borderColor());
    }
    this.view.updatePalette(this.palette);
  }

  /**
   * Re-resolve every player's display name (e.g. after toggling the
   * anonymous-names setting) and push it to the renderer so the names drawn on
   * the map switch live, matching the leaderboard.
   */
  refreshNames(gameView: GameView): void {
    const displayNames = new Map<string, string>();
    for (const p of gameView.players()) {
      displayNames.set(p.id(), p.displayName());
    }
    this.view.refreshNames(displayNames);
  }

  update(gameView: GameView): void {
    this.syncPlayers(gameView);
    this.syncPlayerSpawns(gameView);
    this.syncLocalPlayer(gameView);
    this.syncSpawnOverlay(gameView);
    this.syncTerrainDeltas(gameView);
    uploadFrameData(this.view, gameView.frameData());
  }

  /**
   * Push each player's current spawn tile to the renderer as the skin anchor
   * (image center lines up with this tile). Players re-pick spawn during the
   * spawn phase, so we re-upload whenever the tile changes, not just on first
   * sighting. Once spawn phase ends, spawnTile is locked and this becomes a
   * no-op via the cache check.
   */
  private syncPlayerSpawns(gameView: GameView): void {
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      const spawnTile = p.state.spawnTile;
      if (spawnTile === undefined) continue;
      if (this.lastSpawnTile.get(smallID) === spawnTile) continue;
      this.lastSpawnTile.set(smallID, spawnTile);
      this.view.setPlayerSpawn(
        smallID,
        gameView.x(spawnTile),
        gameView.y(spawnTile),
      );
    }
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
    const me = gameView.myPlayer();
    const sid = me?.smallID() ?? 0;
    if (sid === this.localPlayerSmallID) return;
    this.localPlayerSmallID = sid;
    this.view.setLocalPlayerID(sid);
    if (me) {
      const rail = me.railColor().toRgb();
      this.view.setLocalRailColor(rail.r / 255, rail.g / 255, rail.b / 255);
    }
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
      const spawnTile = p.state.spawnTile;
      if (spawnTile === undefined) continue;
      const isSelf = me !== null && p.smallID() === me.smallID();
      // myPlayer's ring pulses white→this color in SpawnOverlayPass: gold
      // when teamless, own territory tint in team games (matches teammates'
      // rings). Everyone else uses their territory tint directly.
      const c = p.territoryColor().toRgb();
      const useGold = isSelf && myTeam === null;
      centers.push({
        // spawnTile tracks the player's currently-selected spawn directly —
        // updates the same tick the player picks a new location (faster than
        // the nameData centroid which only refreshes every 2 ticks).
        x: gameView.x(spawnTile),
        y: gameView.y(spawnTile),
        r: useGold ? 1 : c.r / 255,
        g: useGold ? 0.84 : c.g / 255,
        b: useGold ? 0 : c.b / 255,
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
    if (!this.skinsInitialized) {
      this.skinsInitialized = true;
      const urls = new Set<string>();
      for (const p of gameView.players()) {
        const url = p.cosmetics.skin?.url;
        if (url) urls.add(assetUrl(url));
      }
      this.view.initSkinAtlas([...urls]);
    }
    const newPlayers: PlayerStatic[] = [];
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      if (this.knownSmallIDs.has(smallID)) continue;
      this.knownSmallIDs.add(smallID);

      this.writePaletteEntry(smallID, p.territoryColor(), p.borderColor());

      // p.cosmetics.flag has already been server-resolved to either a full URL
      // or a relative asset path (e.g. "/flags/US.svg" or a CDN URL for a
      // custom flag). assetUrl() passes URLs through and rewrites paths.
      const flagRef = p.cosmetics.flag;
      const flagUrl = flagRef ? assetUrl(flagRef) : undefined;

      const skin = p.cosmetics.skin;
      if (skin?.url) {
        this.view.setPlayerSkin(smallID, assetUrl(skin.url));
      }

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
        // displayName() honors the anonymous-names setting; static.displayName
        // is always the real name.
        displayName: p.displayName(),
        flag: flagUrl,
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
