import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  PlayerProfile,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { AllianceView } from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import {
  ContextMenuEvent,
  MouseMoveEvent,
  TouchEvent,
} from "../../InputHandler";
import { themeProvider } from "../../theme/ThemeProvider";
import { TransformHandler } from "../../TransformHandler";
import {
  getTranslatedPlayerTeamLabel,
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { GameView, PlayerView, UnitView } from "../../view";
import {
  EMOJI_ICON_KIND,
  getFirstPlacePlayer,
  getPlayerIcons,
  IMAGE_ICON_KIND,
} from "../PlayerIcons";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { CloseRadialMenuEvent } from "./RadialMenu";
import "./RelationSmiley";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
const allianceIcon = assetUrl("images/AllianceIcon.svg");
const traitorIcon = assetUrl("images/TraitorIcon.svg");
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const soldierIcon = assetUrl("images/SoldierIcon.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");

// The unit chips rendered under the player name. The name column is sized to
// this row, so getNameFontSize() counts the enabled entries here to work out
// how much room the name actually has.
const UNIT_CHIPS: readonly (readonly [UnitType, string])[] = [
  [UnitType.City, cityIcon],
  [UnitType.Factory, factoryIcon],
  [UnitType.Port, portIcon],
  [UnitType.MissileSilo, missileSiloIcon],
  [UnitType.SAMLauncher, samLauncherIcon],
  [UnitType.Warship, warshipIcon],
];

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(coord: { x: number; y: number }, game: GameView) {
  return (a: Unit | UnitView, b: Unit | UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends LitElement implements Controller {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private _isInfoVisible: boolean = false;

  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;

  private _isActive = false;

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private lastMouseUpdate = 0;

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(TouchEvent, (e: TouchEvent) => this.maybeShow(e.x, e.y));
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    this._isActive = true;
  }

  private onMouseEvent(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.maybeShow(event.x, event.y);
  }

  public hide() {
    this.setVisible(false);
    this.unit = null;
    this.player = null;
  }

  public maybeShow(x: number, y: number) {
    this.hide();
    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      this.player = owner as PlayerView;
      this.player.profile().then((p) => {
        this.playerProfile = p;
      });
      this.setVisible(true);
    } else if (!this.game.isLand(tile)) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        .filter((u) => euclideanDistWorld(worldCoord, u.tile(), this.game) < 50)
        .sort(distSortUnitWorld(worldCoord, this.game));

      if (units.length > 0) {
        this.unit = units[0];
        this.setVisible(true);
      }
    }
  }

  tick() {
    this.requestUpdate();
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
    this.requestUpdate();
  }

  private getPlayerNameColor(isFriendly: boolean): string {
    if (isFriendly) return "text-green-500";
    return "text-white";
  }

  private getRelationSmiley(
    player: PlayerView,
    myPlayer: PlayerView | null | undefined,
  ): TemplateResult | string {
    if (!myPlayer || myPlayer === player || player.type() !== PlayerType.Nation)
      return "";
    const relation =
      this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
    if (relation === Relation.Neutral) return "";
    return html`<relation-smiley .relation=${relation}></relation-smiley>`;
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Neutral:
        return translateText("relation.neutral");
      case Relation.Friendly:
        return translateText("relation.friendly");
      default:
        return translateText("relation.default");
    }
  }

  private displayUnitCount(player: PlayerView, type: UnitType, icon: string) {
    return !this.game.config().isUnitDisabled(type)
      ? html`<div
          class="flex items-center justify-center gap-0.5 lg:gap-1 p-0.5 lg:p-1 border rounded-md border-gray-500 text-[10px] lg:text-xs w-9 lg:w-12 h-6 lg:h-7"
          translate="no"
        >
          <img
            src=${icon}
            class="w-3 h-3 lg:w-4 lg:h-4 object-contain shrink-0"
          />
          <span>${player.totalUnitLevels(type)}</span>
        </div>`
      : "";
  }

  private allianceExpirationText(alliance: AllianceView) {
    const { expiresAt } = alliance;
    const remainingTicks = expiresAt - this.game.ticks();
    let remainingSeconds = 0;
    if (remainingTicks > 0) {
      remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second
    }
    return renderDuration(remainingSeconds);
  }

  private renderPlayerNameIcons(icons: ReturnType<typeof getPlayerIcons>) {
    if (icons.length === 0) {
      return html``;
    }

    return html`<span class="flex items-center gap-1 shrink-0">
      ${icons.map((icon) =>
        icon.kind === EMOJI_ICON_KIND && icon.text
          ? html`<span class="h-4 w-4 font-mono text-sm shrink-0" translate="no"
              >${icon.text}</span
            >`
          : icon.kind === IMAGE_ICON_KIND && icon.src
            ? html`<img src=${icon.src} alt="" class="w-4 h-4 shrink-0" />`
            : html``,
      )}
    </span>`;
  }

  /**
   * Returns a CSS font-size value for the player name that scales down when
   * icon pressure + name length would overflow the available row width.
   * Uses calc(var(--text-lg) * scale) so the result always respects the
   * CSS variable; min is var(--text-lg)/2, max is var(--text-lg).
   */
  private getNameFontSize(params: {
    nameLength: number;
    iconCount: number;
    hasFlag: boolean;
    hasBetrayal: boolean;
    hasAlliance: boolean;
    hasTeam: boolean;
    unitChipCount: number;
  }): { fontSize: string; isAllianceWrapped: boolean } {
    const {
      nameLength,
      iconCount,
      hasFlag,
      hasBetrayal,
      hasAlliance,
      hasTeam,
      unitChipCount,
    } = params;

    // Approximate char-widths each element occupies at --text-lg.
    // playerType allows for the surrounding parentheses.
    const DESKTOP_PRESSURE = {
      playerType: 4.8,
      perIcon: 2.0,
      icon: 0.5,
      flag: 3.5,
      betrayal: 4.2,
      alliance: 6.7,
      allianceWrapped: 3.9,
      team: 1.0,
    } as const;

    const MOBILE_PRESSURE = {
      playerType: 5.2,
      perIcon: 2.2,
      icon: 0.5,
      flag: 4.2,
      betrayal: 4.6,
      alliance: 8.6,
      allianceWrapped: 4.8,
      team: 1.0,
    } as const;

    const width = window.innerWidth;
    const isDesktop = width >= 1024;

    const PRESSURE = isDesktop ? DESKTOP_PRESSURE : MOBILE_PRESSURE;

    const basePressure =
      PRESSURE.playerType +
      iconCount * PRESSURE.perIcon +
      (iconCount ? PRESSURE.icon : 0) +
      (hasFlag ? PRESSURE.flag : 0) +
      (hasBetrayal ? PRESSURE.betrayal : 0) +
      (hasTeam ? PRESSURE.team : 0);

    // The name sits directly above the unit-chip row and shares its width, so
    // capacity follows the chips rather than the viewport. Chips are w-9 with
    // gap-0.5 below lg, and w-12 with gap-1 from lg up; the name is text-sm
    // (14px, 8.4px/char) below lg and text-lg (18px, 10.8px/char) from lg up.
    const chipWidth = isDesktop ? 48 : 36;
    const chipGap = isDesktop ? 4 : 2;
    const charWidth = isDesktop ? 10.8 : 8.4;
    const chipRowWidth =
      unitChipCount > 0
        ? unitChipCount * chipWidth + (unitChipCount - 1) * chipGap
        : 0;
    const capacity = chipRowWidth / charWidth;

    let isAllianceWrapped = false;
    let alliancePressure = hasAlliance ? PRESSURE.alliance : 0;
    let scale = (capacity - (basePressure + alliancePressure)) / nameLength;

    // If alliance active and font scale < 0.85
    // word-wrap alliance (icon & duration) to reduce width.
    if (hasAlliance && scale < 0.85) {
      isAllianceWrapped = true;
      alliancePressure = PRESSURE.allianceWrapped;
      scale = (capacity - (basePressure + alliancePressure)) / nameLength;
    }

    const textSize = isDesktop ? "lg" : "sm";
    const fontSize = `clamp(var(--text-${textSize}) * .65, var(--text-${textSize}) * ${scale.toFixed(3)}, var(--text-${textSize}))`;

    return { fontSize, isAllianceWrapped };
  }

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    const isAllied = myPlayer?.isAlliedWith(player);
    const traitorTicks = player.getTraitorRemainingTicks();
    let allianceHtml: TemplateResult | null = null;
    let betrayalHtml: TemplateResult | null = null;
    const firstPlace = getFirstPlacePlayer(this.game);
    const playerIcons = getPlayerIcons({ game: this.game, player, firstPlace });
    const maxTroops = this.game.config().maxTroops(player);
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    const totalTroops = player.troops();

    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_type.bot");
        break;
      case PlayerType.Nation:
        playerType = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_type.player");
        break;
    }
    // Parenthesised so the type reads as an aside next to the player name.
    const playerTypeLabel = playerType === "" ? "" : `(${playerType})`;
    const playerTeam = getTranslatedPlayerTeamLabel(player.team());

    const unitChipCount = UNIT_CHIPS.filter(
      ([type]) => !this.game.config().isUnitDisabled(type),
    ).length;

    const { fontSize, isAllianceWrapped } = this.getNameFontSize({
      nameLength: player.displayName().length,
      iconCount: playerIcons.length,
      hasFlag: !!player.cosmetics.flag,
      hasBetrayal: traitorTicks > 0,
      hasAlliance: isAllied ?? false,
      hasTeam: playerTeam !== "" && player.type() !== PlayerType.Bot,
      unitChipCount,
    });

    if (isAllied) {
      const alliance = myPlayer
        ?.alliances()
        .find((alliance) => alliance.other === player.id());
      if (alliance !== undefined) {
        allianceHtml = isAllianceWrapped
          ? html`<div
              class="${traitorTicks === 0
                ? "ml-auto"
                : ""} flex flex-col items-center gap-0 text-xs font-bold leading-none shrink-0"
            >
              <img
                src=${allianceIcon}
                width="14"
                height="14"
                class="shrink-0"
              />
              <span class="text-[10px] leading-tight"
                >${this.allianceExpirationText(alliance)}</span
              >
            </div>`
          : html`<div
              class="${traitorTicks === 0
                ? "ml-auto"
                : ""} flex items-center mr-0 gap-1 text-xs font-bold leading-tight shrink-0"
            >
              <img
                src=${allianceIcon}
                width="18"
                height="18"
                class="shrink-0"
              />
              <span>${this.allianceExpirationText(alliance)}</span>
            </div>`;
      }
    }

    if (traitorTicks > 0) {
      betrayalHtml = html`<span class="flex ml-auto items-center shrink-0 "
        ><img src=${traitorIcon} alt="" class="w-4 h-4 shrink-0" />
        <span
          class="text-sm text-red-900 
          drop-shadow-[-.2px_-.2px_.8px_rgba(0,0,0,.7),.2px_.2px_.8px_rgba(0,0,0,.7)]"
        >
          ${renderDuration(Math.floor(traitorTicks / 10))} </span
        ><span></span
      ></span>`;
    }

    return html`
      <div class="flex items-start gap-1 lg:gap-2 p-1 lg:p-1.5">
        <!-- Left: Gold, outgoing attack & Troop bar -->
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <div class="flex items-center gap-1">
            <div
              class="flex flex-1 min-w-0 overflow-hidden items-center justify-center px-0.5 lg:px-1 py-0.5 border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm lg:gap-1"
              translate="no"
            >
              <img
                src=${goldCoinIcon}
                width="13"
                height="13"
                class="shrink-0"
              />
              <span class="px-0.5 truncate"
                >${renderNumber(player.gold())}</span
              >
            </div>
            <div
              class="flex flex-1 min-w-0 overflow-hidden items-center justify-center px-0.5 lg:px-1 py-0.5 border rounded-md font-bold text-sm lg:gap-1 ${attackingTroops >
              0
                ? "border-aquarius text-aquarius"
                : "border-gray-500 text-white/40"}"
              translate="no"
            >
              <img
                src=${swordIcon}
                width="13"
                height="13"
                alt=""
                aria-hidden="true"
                class="shrink-0 ${attackingTroops > 0 ? "" : "opacity-40"}"
              />
              <span class="px-0.5 truncate tabular-nums"
                >${renderTroops(attackingTroops)}</span
              >
            </div>
          </div>
          <div class="w-full" translate="no">
            ${this.renderTroopBar(totalTroops, attackingTroops, maxTroops)}
          </div>
        </div>
        <!-- Right: Player identity + Units below -->
        <div class="flex flex-col justify-between self-stretch shrink-0">
          <div
            class="flex items-center gap-1 lg:gap-2 font-bold text-sm lg:text-lg ${this.getPlayerNameColor(
              isFriendly ?? false,
            )}"
          >
            ${player.cosmetics.flag
              ? html`<img
                  class="h-6 object-contain shrink-0"
                  src=${assetUrl(player.cosmetics.flag!)}
                />`
              : html``}
            <div class="shrink min-w-0">
              <span
                class="font-mono inline-block leading-[1.2] wrap-anywhere"
                style="font-size: ${fontSize}"
                >${player.displayName()}</span
              >
            </div>
            ${this.getRelationSmiley(player, myPlayer)}
            ${playerTeam !== "" && player.type() !== PlayerType.Bot
              ? html`<div class="flex flex-col leading-tight shrink-0">
                  <span class="text-gray-400 text-xs font-normal"
                    >${playerTypeLabel}</span
                  >
                  <span class="text-xs font-normal text-gray-400"
                    >[<span
                      style="color: ${themeProvider
                        .current()
                        .teamColor(player.team()!)
                        .toHex()}"
                      >${playerTeam}</span
                    >]</span
                  >
                </div>`
              : html`<span class="text-gray-400 text-xs font-normal shrink-0"
                  >${playerTypeLabel}</span
                >`}
            ${this.renderPlayerNameIcons(playerIcons)} ${betrayalHtml ?? ""}
            ${allianceHtml ?? ""}
          </div>
          <div class="flex gap-0.5 lg:gap-1 items-center mt-0.5">
            ${UNIT_CHIPS.map(([type, icon]) =>
              this.displayUnitCount(player, type, icon),
            )}
          </div>
        </div>
      </div>
    `;
  }

  private renderTroopBar(
    totalTroops: number,
    attackingTroops: number,
    maxTroops: number,
  ) {
    const base = Math.max(maxTroops, 1);
    const greenPercentRaw = (totalTroops / base) * 100;
    const orangePercentRaw = (attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return html`
      <div
        class="w-full h-5 lg:h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="relative h-full">
          <div
            class="absolute inset-y-0 left-0 w-full origin-left bg-sky-700 transition-transform duration-200 ease-out"
            style="transform: scaleX(${greenPercent / 100});"
          ></div>
          <div
            class="absolute inset-y-0 left-0 w-full origin-left bg-malibu-blue transition-transform duration-200 ease-out"
            style="transform: translateX(${greenPercent}%) scaleX(${orangePercent /
            100});"
          ></div>
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(totalTroops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(maxTroops)}</span
          >
        </div>
        <img
          src=${soldierIcon}
          alt=""
          aria-hidden="true"
          width="14"
          height="14"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] pointer-events-none"
        />
      </div>
    `;
  }

  private renderUnitInfo(unit: UnitView) {
    const isAlly =
      (unit.owner() === this.game.myPlayer() ||
        this.game.myPlayer()?.isFriendly(unit.owner())) ??
      false;

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${isAlly ? "text-green-500" : "text-white"}">
          ${unit.owner().displayName()}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unit.type()}</div>
          ${unit.hasHealth()
            ? html` <div class="text-sm">Health: ${unit.health()}</div> `
            : ""}
          ${unit.type() === UnitType.TransportShip
            ? html`
                <div class="text-sm">
                  Troops: ${renderTroops(unit.troops())}
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  render() {
    if (!this._isActive) {
      return html``;
    }

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible"
      : "opacity-0 invisible pointer-events-none";

    return html`
      <div
        class="fixed top-0 left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[1001]"
        style="margin-top: ${this.barOffset}px;"
        @click=${() => this.hide()}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg sm:rounded-b-lg shadow-lg text-white text-lg lg:text-base w-full sm:w-[500px] overflow-hidden ${containerClasses}"
        >
          ${this.player !== null ? this.renderPlayerInfo(this.player) : ""}
          ${this.unit !== null ? this.renderUnitInfo(this.unit) : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
