import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { Controller } from "../../Controller";
import {
  InputHandler,
  ToggleStructureEvent,
  TouchGhostPlacementSelectEvent,
  highlightTypesForUnit,
  isForwardedTouchClick,
} from "../../InputHandler";
import { KeyboardLayoutController } from "../../KeyboardLayout";
import { KEYBOARD_DETECTED_EVENT, Platform } from "../../Platform";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { resolveKeybindLabel, translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  atomBombIcon,
  cityIcon,
  defensePostIcon,
  factoryIcon,
  goldCoinIcon,
  hydrogenBombIcon,
  mirvIcon,
  missileSiloIcon,
  portIcon,
  samLauncherIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";

/** How long a build button has to be held before it shows its details (cost etc.) */
const PEEK_HOLD_MS = 450;
/** How long the details stay up after the browser cancels the touch itself. */
const PEEK_GRACE_MS = 1200;

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public inputHandler: InputHandler;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private keyboardLayout = new KeyboardLayoutController(this);
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private allDisabled = false;
  private enabledUnitCount = 0;
  private tutorialMode = false;
  private _hoveredUnitTooltip: {
    unitType: PlayerBuildableUnitType;
    structureKey: string;
    hotkey: string;
    element: HTMLElement;
  } | null = null;
  /**
   * The unit the player is holding down. A touch device has no hover, so a
   * press-and-hold is how the cost and description are read before the unit
   * is picked.
   */
  private _peekedUnitTooltip: {
    unitType: PlayerBuildableUnitType;
    structureKey: string;
    hotkey: string; //touch device may still have a keyboard
    element: HTMLElement;
  } | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  private peekGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressNextClick = false;
  // Keep the hold's release click suppressed, but not a later physical click.
  private suppressReleaseClick = false;
  private lastTouchClickItem: HTMLElement | null = null;
  private peekPointerId: number | null = null;
  private peekTouchIdentifier: number | null = null;
  private activeTouchIdentifiers = new Set<number>();
  // Where the tooltip is centred along the bar, in the bar's own coordinates:
  // x for the bottom row, y for the side column. Kept for the clamp after the
  // render, since the tooltip cannot be measured before it exists.
  private _tooltipCenter: number | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;
  // Whether the build bar has actions hidden off either edge. The fade on that
  // edge tells the player there is more to scroll to.
  private moreActionsStart = false;
  private moreActionsEnd = false;
  private observedScroller: HTMLElement | null = null;
  private windowListenersAttached = false;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.tutorialMode = config.gameConfig().tutorial ?? false;
    // The bar is hidden on small screens, where the radial menu builds, but
    // the onboarding tutorial fires its atom bomb from here on every screen.
    if (this.tutorialMode) this.classList.remove("hidden");

    this.enabledUnitCount = BuildMenus.types.filter((unitType) =>
      this.isUnitDisplayed(unitType),
    ).length;
    this.allDisabled = this.enabledUnitCount === 0;

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.windowListenersAttached) return;
    window.addEventListener("resize", this.onLayoutChange);
    window.addEventListener(
      KEYBOARD_DETECTED_EVENT,
      this.handleKeyboardDetected,
    );
    document.addEventListener("pointerdown", this.handleDocumentPointerDown);
    document.addEventListener("pointerup", this.handleDocumentPointerUp);
    document.addEventListener(
      "pointercancel",
      this.handleDocumentPointerCancel,
    );
    document.addEventListener("touchstart", this.handlePeekTouchEvent, true);
    document.addEventListener("touchend", this.handlePeekTouchEvent, true);
    document.addEventListener("touchcancel", this.handlePeekTouchEvent, true);
    this.windowListenersAttached = true;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.onLayoutChange);
    window.removeEventListener(
      KEYBOARD_DETECTED_EVENT,
      this.handleKeyboardDetected,
    );
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown);
    document.removeEventListener("pointerup", this.handleDocumentPointerUp);
    document.removeEventListener(
      "pointercancel",
      this.handleDocumentPointerCancel,
    );
    document.removeEventListener("touchstart", this.handlePeekTouchEvent, true);
    document.removeEventListener("touchend", this.handlePeekTouchEvent, true);
    document.removeEventListener(
      "touchcancel",
      this.handlePeekTouchEvent,
      true,
    );
    this.dismissPeek();
    this.activeTouchIdentifiers.clear();
    this.suppressNextClick = false;
    this.suppressReleaseClick = false;
    this.clearTouchClickTarget();
    this.windowListenersAttached = false;
  }

  /** The bar moved or resized: the tooltip and the edge fades have to follow. */
  private onLayoutChange = () => {
    this.requestUpdate();
  };

  /**
   * A keyboard can show up after the page loaded (a tablet with a Bluetooth
   * keyboard, a desktop user who only now typed). Show the hotkeys from then on.
   */
  private handleKeyboardDetected = () => {
    this.requestUpdate();
  };

  /**
   * Holding a build button shows its cost and description. Touch devices have
   * no hover, and a tap selects the unit right away, so the details need a
   * press of their own.
   */
  private startPeek = (
    event: PointerEvent,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) => {
    if (event.pointerType !== "touch") return;
    // A new press replaces the peek of the previous one.
    this.dismissPeek();
    this.peekPointerId = event.pointerId;
    // The press that follows is a new gesture: it may select the unit.
    this.suppressNextClick = false;
    const element = event.currentTarget as HTMLElement;
    this.peekTimer = setTimeout(() => {
      this.peekTimer = null;
      // The hold becomes a peek: releasing it must not select the unit.
      this.suppressNextClick = true;
      this._peekedUnitTooltip = { unitType, structureKey, hotkey, element };
      this.requestUpdate();
    }, PEEK_HOLD_MS);
  };

  private cancelPeekTimer() {
    if (this.peekTimer === null) return;
    clearTimeout(this.peekTimer);
    this.peekTimer = null;
  }

  private dismissPeek() {
    this.cancelPeekTimer();
    this.peekPointerId = null;
    this.peekTouchIdentifier = null;
    if (this.peekGraceTimer !== null) {
      clearTimeout(this.peekGraceTimer);
      this.peekGraceTimer = null;
    }
    if (this._peekedUnitTooltip === null) return;
    this._peekedUnitTooltip = null;
    this.requestUpdate();
  }

  /** A press outside the bar dismisses the peek it opened. */
  private handleDocumentPointerDown = (event: PointerEvent) => {
    this.suppressReleaseClick = false;
    if (event.pointerType !== "touch") this.clearTouchClickTarget();
    if (this._peekedUnitTooltip === null) return;
    const root = this.querySelector(".unit-display-root");
    if (root && event.target instanceof Node && root.contains(event.target)) {
      return;
    }
    this.dismissPeek();
  };

  /** Releasing anywhere ends the hold, wherever the finger ended up. */
  private handleDocumentPointerUp = (event: PointerEvent) => {
    if (this.peekPointerId !== event.pointerId) return;
    this.suppressReleaseClick = this.suppressNextClick;
    this.suppressNextClick = false;
    this.cancelPeekTimer();
    this.peekPointerId = null;
    this.peekTouchIdentifier = null;
    // The details are only useful while the button is held down.
    if (this._peekedUnitTooltip !== null) this.dismissPeek();
  };

  /** Pointer cancellation can precede touchend; the touch event ends the peek. */
  private handleDocumentPointerCancel = (event: PointerEvent) => {
    if (this.peekPointerId !== event.pointerId) return;
    this.cancelPeekTimer();
    if (
      this._peekedUnitTooltip !== null &&
      this.activeTouchIdentifiers.size > 1
    ) {
      this.startPeekGraceTimer();
    }
  };

  private handlePeekTouchEvent = (event: TouchEvent) => {
    const root = this.querySelector(".unit-display-root");
    const isInBuildBar =
      event.target instanceof Node && root?.contains(event.target);
    const changedTouches = Array.from(event.changedTouches);

    if (event.type === "touchstart") {
      this.clearTouchClickTarget();
      for (const touch of changedTouches) {
        this.activeTouchIdentifiers.add(touch.identifier);
      }
      if (isInBuildBar && this.peekTouchIdentifier === null) {
        this.peekTouchIdentifier = changedTouches[0]?.identifier ?? null;
      }
    } else {
      if (event.type === "touchend" && isInBuildBar) {
        this.lastTouchClickItem =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>(".unit-display-grid > div")
            : null;
      }
      const trackedTouchEnded = changedTouches.some(
        (touch) => touch.identifier === this.peekTouchIdentifier,
      );
      for (const touch of changedTouches) {
        this.activeTouchIdentifiers.delete(touch.identifier);
      }

      if (!trackedTouchEnded) return;
      this.peekTouchIdentifier = null;
      this.peekPointerId = null;
      this.cancelPeekTimer();
      if (event.type === "touchend") {
        this.suppressReleaseClick ||= this.suppressNextClick;
        this.suppressNextClick = false;
        if (this._peekedUnitTooltip !== null) this.dismissPeek();
      } else {
        this.clearTouchClickTarget();
        this.suppressNextClick = false;
        this.suppressReleaseClick = false;
        if (this._peekedUnitTooltip !== null) {
          this.startPeekGraceTimer();
        }
      }
    }
  };

  private clearTouchClickTarget() {
    this.lastTouchClickItem = null;
  }

  private isTouchClick(event: Event, item: Element | null): boolean {
    const isTouch =
      (event instanceof PointerEvent && event.pointerType === "touch") ||
      isForwardedTouchClick(event) ||
      (event instanceof MouseEvent &&
        event.detail > 0 &&
        item === this.lastTouchClickItem);
    this.clearTouchClickTarget();
    return isTouch;
  }

  private startPeekGraceTimer() {
    if (this.peekGraceTimer !== null) clearTimeout(this.peekGraceTimer);
    this.peekGraceTimer = setTimeout(() => {
      this.peekGraceTimer = null;
      if (this._peekedUnitTooltip !== null) this.dismissPeek();
    }, PEEK_GRACE_MS);
  }

  private onScroll = () => {
    this.requestUpdate();
  };

  /**
   * Below lg in portrait the bar is a column on the right edge of the
   * screen, scrolling up and down; everywhere else it is a row in the bottom
   * panel. Matches the `side-bar:` variant (styles.css) used by the bar and
   * its host in index.html.
   */
  private isSideBar(): boolean {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(width < 64rem) and (orientation: portrait)").matches
    );
  }

  /**
   * Track which end of the build bar still hides actions, so the fade can
   * point at it. The bar only scrolls where it does not fit, so on a big
   * screen neither end is marked.
   */
  private measureScrollState() {
    const scroller = this.getScroller();
    if (!scroller) return;
    const [scrolled, visible, total] = this.isSideBar()
      ? [scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight]
      : [scroller.scrollLeft, scroller.clientWidth, scroller.scrollWidth];
    this.moreActionsStart = scrolled > 1;
    this.moreActionsEnd = scrolled + visible < total - 1;
  }

  private getScroller(): HTMLElement | null {
    return this.querySelector<HTMLElement>(".unit-display-scroll");
  }

  willUpdate() {
    this.measureScrollState();
  }

  updated() {
    const scroller = this.getScroller();
    if (scroller !== this.observedScroller) {
      this.observedScroller?.removeEventListener("scroll", this.onScroll);
      this.observedScroller = scroller;
      scroller?.addEventListener("scroll", this.onScroll);
    }
    this.clampTooltipToViewport();
  }

  /**
   * Keep the tooltip on the mobile screen: next to an edge it would
   * otherwise hang off. The bottom row clamps it sideways, the side column
   * up and down.
   */
  private clampTooltipToViewport() {
    const tooltip = this.querySelector<HTMLElement>(".unit-display-tooltip");
    const root = this.querySelector<HTMLElement>(".unit-display-root");
    if (!tooltip || !root || this._tooltipCenter === null) return;
    const rootBounds = root.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const margin = 8;
    if (this.isSideBar()) {
      let top = rootBounds.top + this._tooltipCenter - tooltipBounds.height / 2;
      const maxTop = window.innerHeight - margin - tooltipBounds.height;
      if (top > maxTop) top = maxTop;
      if (top < margin) top = margin;
      tooltip.style.top = `${top - rootBounds.top + tooltipBounds.height / 2}px`;
      return;
    }
    // The tooltip is centred on the item, so its left edge sits half its
    // width to the left of that centre.
    let left = rootBounds.left + this._tooltipCenter - tooltipBounds.width / 2;
    const max = window.innerWidth - margin - tooltipBounds.width;
    if (left < margin) left = margin;
    else if (left > max) left = max;
    // The tooltip is pulled left by half its width with the transform, so the
    // style has to put that half back, or the box ends up twice shifted.
    tooltip.style.left = `${left - rootBounds.left + tooltipBounds.width / 2}px`;
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  private isUnitDisplayed(unitType: PlayerBuildableUnitType): boolean {
    return (
      !this.game.config().isUnitDisabled(unitType) &&
      (!this.tutorialMode || unitType === UnitType.AtomBomb)
    );
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player
      .buildables(undefined, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
      })
      .catch((error) => console.warn("Failed to refresh unit costs", error));
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }
    // The onboarding tutorial's one build is the atom bomb, fired from the
    // nation's silo once captured.
    if (
      this.tutorialMode &&
      myPlayer.units(UnitType.MissileSilo).length === 0
    ) {
      return null;
    }
    // A row in the bottom panel: below the control panel from lg up, above
    // it on landscape phones (index.html orders it), spread over the panel's
    // width there. Below lg in portrait (side-bar) it is a column on the
    // right edge of the screen, where index.html fixes the host.
    return html`
      <div
        class="unit-display-root relative p-0.5 border-white/10 w-full lg:border-t max-lg:landscape:border-b side-bar:w-auto side-bar:rounded-l-lg side-bar:hud-panel
          ${this.moreActionsStart ? "unit-display-more-start" : ""}
          ${this.moreActionsEnd ? "unit-display-more-end" : ""}"
        data-radial-click-through
        @contextmenu=${(event: Event) => event.preventDefault()}
      >
        <div
          class="unit-display-scroll overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x lg:overflow-visible side-bar:overflow-x-hidden side-bar:overflow-y-auto side-bar:overscroll-y-contain side-bar:touch-pan-y side-bar:max-h-[calc(100dvh-5.5rem)]"
          @scroll=${this.onScroll}
        >
          <div
            class="unit-display-grid grid gap-0.5 grid-rows-1 grid-flow-col auto-cols-fr lg:auto-cols-max lg:w-fit lg:mx-auto side-bar:grid-rows-none side-bar:grid-flow-row side-bar:grid-cols-1"
          >
            ${this.renderUnitItem(
              cityIcon,
              this._cities,
              UnitType.City,
              "city",
              this.getHotkey("buildCity", "Digit1"),
            )}
            ${this.renderUnitItem(
              factoryIcon,
              this._factories,
              UnitType.Factory,
              "factory",
              this.getHotkey("buildFactory", "Digit2"),
            )}
            ${this.renderUnitItem(
              portIcon,
              this._port,
              UnitType.Port,
              "port",
              this.getHotkey("buildPort", "Digit3"),
            )}
            ${this.renderUnitItem(
              defensePostIcon,
              this._defensePost,
              UnitType.DefensePost,
              "defense_post",
              this.getHotkey("buildDefensePost", "Digit4"),
            )}
            ${this.renderUnitItem(
              missileSiloIcon,
              this._missileSilo,
              UnitType.MissileSilo,
              "missile_silo",
              this.getHotkey("buildMissileSilo", "Digit5"),
            )}
            ${this.renderUnitItem(
              samLauncherIcon,
              this._samLauncher,
              UnitType.SAMLauncher,
              "sam_launcher",
              this.getHotkey("buildSamLauncher", "Digit6"),
            )}
            ${this.renderUnitItem(
              warshipIcon,
              this._warships,
              UnitType.Warship,
              "warship",
              this.getHotkey("buildWarship", "Digit7"),
            )}
            ${this.renderUnitItem(
              atomBombIcon,
              null,
              UnitType.AtomBomb,
              "atom_bomb",
              this.getHotkey("buildAtomBomb", "Digit8"),
            )}
            ${this.renderUnitItem(
              hydrogenBombIcon,
              null,
              UnitType.HydrogenBomb,
              "hydrogen_bomb",
              this.getHotkey("buildHydrogenBomb", "Digit9"),
            )}
            ${this.renderUnitItem(
              mirvIcon,
              null,
              UnitType.MIRV,
              "mirv",
              this.getHotkey("buildMIRV", "Digit0"),
            )}
          </div>
        </div>
        ${this.renderUnitTooltip()}
      </div>
    `;
  }

  private getHotkey(action: string, defaultCode: string): string {
    // Without a keyboard the hotkeys cannot be used, so don't resolve them
    // (or the keyboard layout behind them) and don't show them.
    if (!Platform.hasKeyboard) return "";
    return resolveKeybindLabel(
      this.keybinds[action],
      defaultCode,
      this.keyboardLayout.map,
    );
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (!this.isUnitDisplayed(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${(event: MouseEvent) => {
          const item = event.currentTarget as HTMLElement;
          this._hoveredUnitTooltip = {
            unitType,
            structureKey,
            hotkey,
            element: item,
          };
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnitTooltip = null;
          this.requestUpdate();
        }}
        @pointerdown=${(event: PointerEvent) =>
          this.startPeek(event, unitType, structureKey, hotkey)}
      >
        <div
          class="${
            this.canBuild(unitType) ? "" : "opacity-40"
          } border border-slate-500 rounded-sm max-lg:landscape:h-7.5 side-bar:h-12 side-bar:min-w-6.5 w-full px-0.5 side-bar:px-0 pb-0.5 flex items-center justify-center gap-0.5 cursor-pointer lg:justify-start
             ${
            selected
              ? "pointer-fine:hover:bg-gray-400/10"
              : "pointer-fine:hover:bg-gray-800"
          }
             rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}
             ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          @click=${(event: Event) =>
            this.onUnitClick(event, unitType, selected)}
          @pointerenter=${(event: PointerEvent) =>
            this.onUnitPointerEnter(event, unitType)}
          @pointerleave=${(event: PointerEvent) =>
            this.onUnitPointerLeave(event)}
        >
          ${
            hotkey
              ? html`<div
                  class="unit-display-hotkey ml-0.5 text-[10px] relative -top-1 text-gray-400"
                >
                  ${displayHotkey}
                </div>`
              : nothing
          }
          <div
            class="flex flex-col items-center gap-0 pt-0.5 lg:flex-row lg:gap-0.5"
          >
            <img
              src=${icon}
              alt=${translateText("unit_type." + structureKey)}
              class="align-middle size-6 lg:size-5 max-lg:landscape:size-5"
            />
            ${
              number !== null
                ? html`<span class="hidden lg:inline text-xs leading-none"
                    >${renderNumber(number)}</span
                  >`
                : null
            }
          </div>
        </div>
      </div>
    `;
  }

  private onUnitClick(
    event: Event,
    unitType: PlayerBuildableUnitType,
    selected: boolean,
  ) {
    const item = (event.currentTarget as HTMLElement).closest(
      ".unit-display-grid > div",
    );
    const fromTouch = this.isTouchClick(event, item);
    // A press that turned into a peek shows the details instead of
    // selecting the unit
    if (this.suppressNextClick || this.suppressReleaseClick) {
      this.suppressNextClick = false;
      this.suppressReleaseClick = false;
      return;
    }
    if (selected) {
      this.inputHandler.setGhostStructure(null, "GUIclick");
    } else if (this.canBuild(unitType)) {
      this.inputHandler.setGhostStructure(unitType, "GUIclick");
      if (fromTouch) {
        this.eventBus?.emit(new TouchGhostPlacementSelectEvent());
        this.eventBus?.emit(
          new ToggleStructureEvent(highlightTypesForUnit(unitType)),
        );
      }
    } else {
      const selectedGhost = this.uiState.ghostStructure;
      this.eventBus?.emit(
        new ToggleStructureEvent(
          selectedGhost === null ? null : highlightTypesForUnit(selectedGhost),
        ),
      );
    }
    this.requestUpdate();
  }

  private onUnitPointerEnter(
    event: PointerEvent,
    unitType: PlayerBuildableUnitType,
  ) {
    if (event.pointerType === "touch") return;
    this.eventBus?.emit(
      new ToggleStructureEvent(highlightTypesForUnit(unitType)),
    );
  }

  private onUnitPointerLeave(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    const selectedGhost = this.uiState.ghostStructure;
    this.eventBus?.emit(
      new ToggleStructureEvent(
        selectedGhost === null ? null : highlightTypesForUnit(selectedGhost),
      ),
    );
  }

  private renderUnitTooltip() {
    // A peek wins over a hover: it is the one the player asked for by
    // holding the button.
    const peek = this._peekedUnitTooltip;
    const tooltip = peek ?? this._hoveredUnitTooltip;
    if (!tooltip) return nothing;
    // The item can go away (a unit gets disabled) while it is hovered.
    if (!tooltip.element.isConnected) return nothing;
    const displayHotkey = tooltip.hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();
    // Measured at render time so the tooltip follows the item when the bar
    // scrolls or the layout changes, instead of staying where it was hovered.
    const root = this.querySelector<HTMLElement>(".unit-display-root");
    const itemBounds = tooltip.element.getBoundingClientRect();
    const rootBounds = root?.getBoundingClientRect();
    const sideBar = this.isSideBar();
    let left: number;
    let top: number;
    let placement: string;
    if (sideBar) {
      // Left of the item, centred on it, so it doesn't cover the bar.
      left = itemBounds.left - (rootBounds?.left ?? 0) - 6;
      top = itemBounds.top + itemBounds.height / 2 - (rootBounds?.top ?? 0);
      placement =
        "-translate-x-full -translate-y-1/2 max-w-[min(16rem,100vw_-_5rem)]";
      this._tooltipCenter = top;
    } else {
      left = itemBounds.left + itemBounds.width / 2 - (rootBounds?.left ?? 0);
      top = itemBounds.top - (rootBounds?.top ?? 0) - 4;
      placement =
        "-translate-x-1/2 -translate-y-full max-w-[min(100%_-_1rem,100vw_-_1rem)]";
      this._tooltipCenter = left;
    }

    return html`
      <div
        class="unit-display-tooltip ${peek ? "block" : "hidden pointer-fine:block"} absolute ${placement} text-gray-200 text-center w-max break-words text-xs hud-panel rounded-sm p-1 z-[100] pointer-events-none"
        style=${`left: ${left}px; top: ${top}px;`}
      >
        <div class="font-bold text-sm mb-1">
          ${translateText("unit_type." + tooltip.structureKey)}${
            tooltip.hotkey ? ` [${displayHotkey}]` : ""
          }
        </div>
        <div class="p-2">
          ${translateText("build_menu.desc." + tooltip.structureKey)}
        </div>
        ${
          tooltip.unitType === UnitType.Warship && Platform.hasKeyboard
            ? html`<div
                class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
              >
                ⇧ ${translateText("build_menu.warship_shift_hint")}
              </div>`
            : null
        }
        <div class="flex items-center justify-center gap-1">
          <img src=${goldCoinIcon} width="13" height="13" />
          <span class="text-yellow-300"
            >${renderNumber(this.cost(tooltip.unitType))}</span
          >
        </div>
      </div>
    `;
  }
}
