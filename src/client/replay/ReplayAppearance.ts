/**
 * How the replay's players look on the map: colours, patterns, skins and
 * cosmetic effects. This is what WebGLFrameBuilder.syncPlayers and
 * ClientGameRunner's onGraphicsChanged do for a live game.
 *
 * The cosmetics are the ones players had equipped when the game started
 * (the game start info). Which of them are shown, and with which theme,
 * depends on the viewer's graphics settings, so everything is resolved
 * again when those change.
 */

import { assetUrl } from "../../core/AssetUrls";
import type { UserSettings } from "../../core/game/UserSettings";
import type { GameStartInfo, PlayerCosmetics } from "../../core/Schemas";
import { fetchCosmetics, getCachedCosmetics } from "../Cosmetics";
import type { MapRenderer } from "../render/gl";
import type { SpiralSink } from "../render/gl/utils/PlayerPalette";
import type { PlayerStatic } from "../render/types";
import { themeProvider } from "../theme/ThemeProvider";
import { applyReplayEffects } from "./ReplayEffects";
import type { ReplayGameView } from "./ReplayGameAdapter";
import {
  buildReplayPalette,
  visibleReplayCosmetics,
  type ReplayPalette,
} from "./ReplayPalette";

export class ReplayAppearance {
  /** Equipped cosmetics by clientID. */
  private readonly equipped: Map<string, PlayerCosmetics>;
  /** The equipped cosmetics the viewer's settings show. */
  private cosmetics = new Map<string, PlayerCosmetics>();
  private _palette!: ReplayPalette;
  /** Players the renderer has been given. */
  private drawn = 0;
  private view: MapRenderer | null = null;

  constructor(
    /** The replay's player dictionary. Grows as appends arrive. */
    private readonly players: readonly PlayerStatic[],
    gameStartInfo: GameStartInfo,
    private readonly userSettings: UserSettings,
    private readonly spirals: SpiralSink,
  ) {
    this.equipped = new Map(
      (gameStartInfo.players ?? []).flatMap((p) =>
        p.cosmetics === undefined ? [] : [[p.clientID, p.cosmetics] as const],
      ),
    );
    this.resolve();
  }

  /** The palette and styled player info, as of the last resolve. */
  get palette(): ReplayPalette {
    return this._palette;
  }

  /**
   * Give the renderer every player so far, and draw effects once the
   * cosmetics catalog is in. Called again after a GL context restore.
   */
  attach(view: MapRenderer): void {
    this.view = view;
    // Register skins before the players that use them, like
    // WebGLFrameBuilder.syncPlayers.
    view.initSkinAtlas([...this.skinUrls()]);
    const p = this._palette;
    view.addPlayers(p.players, p.palette, p.patternMeta, p.patternData);
    this.drawn = this.players.length;
    this.applySkins();
    this.applyEffects();
    void fetchCosmetics().then(
      () => this.applyEffects(),
      () => {
        // Without the catalog, trails just use the player colours.
      },
    );
  }

  /** Draw the players an append brought in, and add them to the HUD. */
  addAppended(adapter: ReplayGameView): void {
    const view = this.view;
    if (view === null || this.players.length === this.drawn) return;
    this.resolve();
    const added = this._palette.players.slice(this.drawn);
    this.drawn = this.players.length;
    const p = this._palette;
    view.addPlayers(added, p.palette, p.patternMeta, p.patternData);
    this.applySkins();
    this.applyEffects();
    adapter.addPlayers(added);
  }

  /** The graphics settings changed: restyle every player. */
  restyle(adapter: ReplayGameView): void {
    const view = this.view;
    if (view === null) return;
    this.resolve();
    const p = this._palette;
    view.updatePlayerCosmetics(
      p.players,
      p.palette,
      p.patternMeta,
      p.patternData,
    );
    this.applySkins();
    this.applyEffects();
    adapter.restyle(p.players);
  }

  private resolve(): void {
    this.cosmetics = visibleReplayCosmetics(
      this.equipped,
      this.userSettings.graphicsOverrides().cosmetics ?? {},
    );
    // Start from a fresh theme each time like ClientGameRunner does, so
    // the same players in the same order get the same colours.
    themeProvider.reset();
    this._palette = buildReplayPalette(
      this.players,
      this.cosmetics,
      themeProvider.current(),
    );
  }

  /** All equipped skins, including hidden ones, so a settings change can show them. */
  private skinUrls(): Set<string> {
    return new Set(
      [...this.equipped.values()].flatMap((c) =>
        c.skin?.url === undefined ? [] : [assetUrl(c.skin.url)],
      ),
    );
  }

  private applySkins(): void {
    const view = this.view!;
    for (const p of this.players) {
      if (p.clientID === null || !this.equipped.get(p.clientID)?.skin?.url) {
        continue;
      }
      view.setPlayerSkin(p.smallID, this._palette.skins.get(p.smallID) ?? null);
    }
  }

  /** Trail, structure and railroad effects, and spiral nuke trails. */
  private applyEffects(): void {
    const catalog = getCachedCosmetics();
    if (catalog === null || this.view === null) return;
    applyReplayEffects(
      this.view,
      this.spirals,
      this.players,
      this.cosmetics,
      catalog,
    );
  }
}
