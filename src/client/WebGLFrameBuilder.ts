import { Colord, colord } from "colord";
import { base64url } from "jose";
import { assetUrl } from "../core/AssetUrls";
import {
  findEffect,
  findEffectForSlot,
  isNukeExplosionEffect,
  isTrailEffect,
  type NukeExplosionAttributes,
  type NukeExplosionType,
  type StructuresEffectAttributes,
  TRAIL_EFFECT_TYPES,
  type TrailEffectAttributes,
} from "../core/CosmeticSchemas";
import { decodePatternData } from "../core/PatternDecoder";
import { PlayerType } from "../core/game/Game";
import { getCachedCosmetics } from "./Cosmetics";
import { uploadFrameData } from "./render/frame/Upload";
// Type-only: a value import would pull GPURenderer and its `.glsl?raw` shader
// imports into any non-Vite consumer (e.g. the Node perf harness).
import type { MapRenderer, PlayerStatic, SpawnCenter } from "./render/gl";
import {
  DEFAULT_NUKE_EXPLOSION_COLOR,
  MAX_NUKE_EXPLOSION_COLORS,
  type NukeExplosionRenderParams,
} from "./render/types";
// Value import from the leaf module (not the ./render/gl barrel) so non-Vite
// consumers don't pull in GPURenderer and its shaders — see note above.
import {
  EFFECT_PALETTE_BLOCKS,
  MAX_TRAIL_COLORS,
  STRUCTURES_EFFECT_BLOCK,
  WARSHIP_EFFECT_BLOCK,
} from "./render/gl/utils/ColorUtils";
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV_WARHEAD,
} from "./render/types/UnitType";
import type { GameView } from "./view";

const PALETTE_SIZE = 4096;

// A human player counts as "small" (and glows) at or below this fraction of the
// map; the glow is suppressed for a grace window after the game starts.
const SMALL_PLAYER_MAX_MAP_FRACTION = 0.002; // 0.2%
const SMALL_PLAYER_GLOW_GRACE_SECONDS = 60;
// The set is a visual aid, not tick-critical, so rescan ~once a second
// (10 ticks) instead of every tick.
const SMALL_PLAYER_GLOW_RESCAN_TICKS = 10;

// The effect-palette block order: index = block (rows block·MAX_TRAIL_COLORS …).
// trail.frag.glsl picks its block from the trail tile's nuke bit — block 0 =
// transportShipTrail (nuke bit 0), block 1 = nukeTrail (nuke bit 1, set by
// NUKE_TRAIL_BIT in TrailManager) — structure.frag.glsl reads block
// STRUCTURES_EFFECT_BLOCK (2), and unit.frag.glsl reads block
// WARSHIP_EFFECT_BLOCK (3). Reordering TRAIL_EFFECT_TYPES in CosmeticSchemas
// (or moving the structures/warship blocks) would silently swap effect colors,
// so these guards fail the build if the shader-coupled order ever drifts.
const _EFFECT_BLOCK_ORDER: readonly ["transportShipTrail", "nukeTrail"] =
  TRAIL_EFFECT_TYPES;
void _EFFECT_BLOCK_ORDER;
const _STRUCTURES_BLOCK_IS_2: 2 = STRUCTURES_EFFECT_BLOCK;
void _STRUCTURES_BLOCK_IS_2;
const _WARSHIP_BLOCK_IS_3: 3 = WARSHIP_EFFECT_BLOCK;
void _WARSHIP_BLOCK_IS_3;

// Attribute → render-param mappings:
//   size      = the ring's final WIDTH (diameter) in world tiles when it fades
//               out — absolute, so maxRadius = size / 2 regardless of bomb type.
//   speed     = world tiles/s the ring's width grows, so the effect lasts
//               size / speed seconds (the pass clamps the duration).
//   thickness = the ring band's thickness in world tiles.
//   transitionSpeed passes through as the palette step rate (colors/s).

// Detonating bomb → nuke-explosion slot.
// Only these unit types produce a shockwave; plain MIRV splits and never detonates.
const UNIT_TYPE_TO_NUKE_TYPE: Readonly<Record<string, NukeExplosionType>> = {
  [UT_ATOM_BOMB]: "atom",
  [UT_HYDROGEN_BOMB]: "hydro",
  [UT_MIRV_WARHEAD]: "mirvWarhead",
};

function toRgb01(s: string): [number, number, number] | null {
  const c = colord(s);
  if (!c.isValid()) return null;
  const { r, g, b } = c.toRgb();
  return [r / 255, g / 255, b / 255];
}

/** Resolve a nuke-explosion cosmetic's catalog attributes into render params. */
function attributesToExplosionParams(
  attrs: NukeExplosionAttributes,
): NukeExplosionRenderParams {
  // The shader cycles through the whole palette; the instance layout carries
  // at most MAX_NUKE_EXPLOSION_COLORS, extras are dropped.
  const colors = attrs.colors
    .map(toRgb01)
    .filter((c): c is [number, number, number] => c !== null)
    .slice(0, MAX_NUKE_EXPLOSION_COLORS);
  const base = {
    colors: colors.length > 0 ? colors : [DEFAULT_NUKE_EXPLOSION_COLOR],
    maxRadius: attrs.size / 2,
    speed: attrs.speed,
    thickness: attrs.thickness,
    transitionSpeed: attrs.transitionSpeed,
  };
  return attrs.type === "sparkles"
    ? { ...base, type: "sparkles", density: attrs.density }
    : { ...base, type: "shockwave" };
}

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
  // Per-player effect palette, keyed by smallID. Layout is
  // 4096×(MAX_TRAIL_COLORS·EFFECT_PALETTE_BLOCKS): block 0 (rows 0–7) =
  // transportShipTrail, block 1 (rows 8–15) = nukeTrail, block 2 (rows 16–23)
  // = structures, block 3 (rows 24–31) = warship. Consumed by TrailPass (block
  // from the trail tile's nuke bit), StructurePass (block 2), and UnitPass
  // (block 3).
  private readonly effectPalette: Float32Array;
  private readonly patternMeta: Float32Array;
  private readonly patternData: Uint8Array;

  private readonly knownSmallIDs = new Set<number>();
  /**
   * smallIDs whose trail effect has been resolved into the effect palette.
   * Separate from knownSmallIDs because effect resolution depends on the
   * cosmetics catalog, which may not be loaded the tick a player is first seen
   * — keeping it separate lets us retry next tick instead of skipping forever.
   */
  private readonly effectResolved = new Set<number>();
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
    this.effectPalette = new Float32Array(
      PALETTE_SIZE * MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS * 4,
    );
    this.patternMeta = new Float32Array(PALETTE_SIZE * 4);
    this.patternData = new Uint8Array(PALETTE_SIZE * 1024);
  }

  /** Drop internal caches to force a full re-upload of state on the next update(). */
  clearCaches(): void {
    this.knownSmallIDs.clear();
    this.effectResolved.clear();
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

  private readonly highlightSetBuf = new Uint8Array(PALETTE_SIZE);
  private glowRescanTick = 0;

  update(gameView: GameView): void {
    this.syncPlayers(gameView);
    this.syncPlayerEffects(gameView);
    this.syncPlayerSpawns(gameView);
    this.syncLocalPlayer(gameView);
    this.syncSpawnOverlay(gameView);
    this.syncSmallPlayerGlow(gameView);
    this.syncTerrainDeltas(gameView);
    this.syncNukeImpacts(gameView);
    this.resolveDeadUnitExplosions(gameView);
    uploadFrameData(this.view, gameView.frameData());
  }

  /**
   * Attach the firing player's resolved nuke-explosion cosmetic to each dead
   * nuke event, so every client renders the shockwave in the owner's colors.
   * The effect is per-bomb-type: the detonating unit maps to a nukeType slot
   * (atom / hydro / mirvWarhead) and we resolve the player's selection for THAT
   * slot, so an atom effect only shows on atom bombs, etc. Runs before
   * uploadFrameData so the FX pass sees the params on the event; a player with no
   * selection for that bomb is left undefined (the shockwave falls back to default).
   */
  private resolveDeadUnitExplosions(gameView: GameView): void {
    const deadUnits = gameView.frameData().events.deadUnits;
    if (deadUnits.length === 0) return;
    const catalog = getCachedCosmetics();
    if (!catalog) return; // Catalog not loaded yet — default FX this frame.
    for (const du of deadUnits) {
      if (!du.reachedTarget) continue; // SAM interceptions have no explosion cosmetic
      const nukeType = UNIT_TYPE_TO_NUKE_TYPE[du.unitType];
      if (!nukeType) continue; // not a shockwave-producing bomb
      // playerBySmallID throws on an unknown smallID; a stale/bad event must
      // not kill the frame builder — skip it (default FX).
      let player: ReturnType<GameView["playerBySmallID"]>;
      try {
        player = gameView.playerBySmallID(du.ownerSmallID);
      } catch {
        continue;
      }
      if (!player.isPlayer()) continue;
      const name = player.cosmetics.effects?.[nukeType]?.name;
      if (!name) continue;
      const effect = findEffectForSlot(catalog, nukeType, name);
      if (!effect || !isNukeExplosionEffect(effect)) continue;
      du.explosion = attributesToExplosionParams(effect.attributes);
    }
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

  /**
   * Mark nukeable layer tiles as destroyed from this tick's nuke impacts.
   * Uses the full blast radius (both land and water tiles), not just the
   * terrain-changed subset.
   */
  private syncNukeImpacts(gameView: GameView): void {
    const nukedTiles = gameView.recentlyNukedTiles();
    if (nukedTiles.length === 0) return;
    const layers = gameView.layers();
    for (const layer of layers) {
      if (!layer.nukeable) continue;
      for (const ref of nukedTiles) {
        this.view.markLayerTileDestroyed(layer.id, ref);
      }
    }
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

  /**
   * Small-player glow: when the client "Highlight small players" setting is on,
   * collect the alive human players holding <=0.2% of the map and push their
   * smallIDs so the glow pass radiates around their territory. Skips the first
   * minute of play so everyone's tiny starting territory doesn't glow.
   * Client-only view — toggle it live in the settings.
   */
  private syncSmallPlayerGlow(gameView: GameView): void {
    // Strength (incl. off at 0) is read live in the glow pass; here we only
    // decide who qualifies. Skip spawn + the first minute.
    if (
      gameView.inSpawnPhase() ||
      gameView.elapsedGameSeconds() < SMALL_PLAYER_GLOW_GRACE_SECONDS
    ) {
      this.view.updateSmallPlayerGlow(null);
      return;
    }
    // Throttle the per-player scan + upload; the glow keeps rendering the last
    // set between rescans. The off/spawn/grace checks above run every tick, so
    // toggling off takes effect on the next tick (deferred while the game is
    // paused, since ticks stop; it clears on unpause).
    if (this.glowRescanTick++ % SMALL_PLAYER_GLOW_RESCAN_TICKS !== 0) return;
    // "% of the map" uses the same denominator the leaderboard/win-check use.
    const denom = gameView.numLandTiles() - gameView.numTilesWithFallout();
    if (denom <= 0) {
      this.view.updateSmallPlayerGlow(null);
      return;
    }
    const set = this.highlightSetBuf;
    set.fill(0);
    let any = false;
    for (const p of gameView.players()) {
      if (!p.isPlayer() || p.type() !== PlayerType.Human || !p.isAlive()) {
        continue;
      }
      if (p.numTilesOwned() / denom <= SMALL_PLAYER_MAX_MAP_FRACTION) {
        set[p.smallID()] = 1;
        any = true;
      }
    }
    this.view.updateSmallPlayerGlow(any ? set : null);
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

      // Crown cosmetic: already server-resolved to the catalog image URL.
      const crownRef = p.cosmetics.crown?.url;
      const crownUrl = crownRef ? assetUrl(crownRef) : undefined;

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
        crown: crownUrl,
        verified: p.cosmetics.verified === true,
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

  /**
   * Resolve each player's transport-ship-trail effect into the effect palette.
   * A player's resolved cosmetic is just { name, effectType }; the style and
   * colors live in the catalog, so we look them up via the cached cosmetics.
   * Decoupled from syncPlayers' first-seen guard: if the catalog isn't loaded
   * yet we leave the player unresolved and retry next tick (the trail keeps its
   * territory color meanwhile). Re-uploads the effect texture only when a
   * recognized style was actually written.
   */
  private syncPlayerEffects(gameView: GameView): void {
    const catalog = getCachedCosmetics();
    if (!catalog) return; // Catalog not loaded yet — retry on a later tick.
    let dirty = false;
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      if (this.effectResolved.has(smallID)) continue;
      this.effectResolved.add(smallID);

      // Resolve each trail-styled effectType into its own block of the effect
      // palette. rowBase block*MAX_TRAIL_COLORS must match the consumer
      // shaders' block layout (ship=0, nuke=1 in trail.frag.glsl; structures=2
      // in structure.frag.glsl; warship=3 in unit.frag.glsl) — see
      // _EFFECT_BLOCK_ORDER above. nukeExplosion is not trail-styled and
      // renders through the FX pass instead.
      const blockOrder = [
        ...TRAIL_EFFECT_TYPES,
        "structures",
        "warship",
      ] as const;
      blockOrder.forEach((effectType, block) => {
        const selected = p.cosmetics.effects?.[effectType];
        if (!selected) return;
        const effect = findEffect(catalog, effectType, selected.name);
        if (!effect || effect.effectType !== effectType) return;
        // Narrows attributes to trail attrs (structures/warship share the shape).
        if (
          !isTrailEffect(effect) &&
          effect.effectType !== "structures" &&
          effect.effectType !== "warship"
        ) {
          return;
        }
        // Spiral vortexes render as ribbon geometry (SpiralRibbonPass) —
        // hand the geometry + palette to the view's SpiralTrails. Colors are
        // parsed here so a fully unparseable list degrades to the plain
        // stamped trail instead of an uncolored vortex.
        if (effectType === "nukeTrail" && effect.attributes.type === "spiral") {
          const colors = effect.attributes.colors
            .map((s) => colord(s))
            .filter((c) => c.isValid())
            .slice(0, MAX_TRAIL_COLORS)
            .map((c) => {
              const { r, g, b } = c.toRgb();
              return [r / 255, g / 255, b / 255] as [number, number, number];
            });
          if (colors.length > 0) {
            gameView.setNukeTrailSpiral(smallID, {
              radius: effect.attributes.radius,
              strands: effect.attributes.strands,
              rotationSpeed: effect.attributes.rotationSpeed,
              colors,
            });
          }
        }
        const rowBase = block * MAX_TRAIL_COLORS;
        if (this.writeEffectEntry(smallID, effect.attributes, rowBase)) {
          dirty = true;
        }
      });
    }
    if (dirty) this.view.updateEffectPalette(this.effectPalette);
  }

  /**
   * Encode a player's trail-styled effect into one block of the effect palette.
   * The block starts at row `rowBase` (block · MAX_TRAIL_COLORS; see
   * _EFFECT_BLOCK_ORDER). Within the block, row r holds color r's rgb, and the spare alpha
   * channels (rows rowBase+0..3 always exist) carry the scalar params —
   *   row 0.a = color count (0 → the shader falls back to the territory color),
   *   row 1.a = styleId (0 = gradient, 1 = transition, 2 = spiral),
   *   row 2.a = scalar0 (gradient: colorSize; transition: frequency;
   *     spiral: rotationSpeed),
   *   row 3.a = scalar1 (gradient: movementSpeed; others: unused).
   * colord doesn't throw on a bad color string (it returns black), so unparseable
   * colors are dropped — leaving an empty list, which falls back to the territory
   * color rather than rendering black. Returns whether any color was written.
   */
  private writeEffectEntry(
    smallID: number,
    attrs: TrailEffectAttributes | StructuresEffectAttributes,
    rowBase: number,
  ): boolean {
    const colors = attrs.colors
      .map((s) => colord(s))
      .filter((c) => c.isValid())
      .slice(0, MAX_TRAIL_COLORS)
      .map((c) => c.toRgb());
    for (let r = 0; r < MAX_TRAIL_COLORS; r++) {
      const off = ((rowBase + r) * PALETTE_SIZE + smallID) * 4;
      const c = colors[r] ?? { r: 0, g: 0, b: 0 };
      this.effectPalette[off] = c.r / 255;
      this.effectPalette[off + 1] = c.g / 255;
      this.effectPalette[off + 2] = c.b / 255;
      this.effectPalette[off + 3] = 0;
    }
    let styleId: number;
    let scalar0: number;
    let scalar1: number;
    if (attrs.type === "transition") {
      styleId = 1;
      scalar0 = attrs.frequency;
      scalar1 = 0;
    } else if (attrs.type === "spiral") {
      styleId = 2;
      scalar0 = attrs.rotationSpeed;
      scalar1 = 0;
    } else {
      styleId = 0;
      scalar0 = attrs.colorSize;
      scalar1 = attrs.movementSpeed;
    }
    const alpha = (row: number) =>
      ((rowBase + row) * PALETTE_SIZE + smallID) * 4 + 3;
    this.effectPalette[alpha(0)] = colors.length;
    this.effectPalette[alpha(1)] = styleId;
    this.effectPalette[alpha(2)] = scalar0;
    this.effectPalette[alpha(3)] = scalar1;
    return colors.length > 0;
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
