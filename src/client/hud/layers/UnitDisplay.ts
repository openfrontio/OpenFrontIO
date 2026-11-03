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
import { Platform } from "../../Platform";
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
  // Where the tooltip is centred, in the bar's own coordinates.
  private _tooltipCenter: number | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;
  // Whether the build bar has actions hidden off either edge. The fade on that
  // edge tells the player there is more to swipe to.
  private moreActionsLeft = false;
  private moreActionsRight = false;
  private observedScroller: HTMLElement | null = null;
  private windowListenersAttached = false;
  private lastHasKeyboard = Platform.hasKeyboard;

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
    window.addEventListener("keydown", this.handleKeyboardDetection);
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
    window.removeEventListener("keydown", this.handleKeyboardDetection);
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
  private handleKeyboardDetection = () => {
    if (Platform.hasKeyboard && !this.lastHasKeyboard) {
      this.lastHasKeyboard = true;
      this.requestUpdate();
    }
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
   * Track which edge of the build bar still hides actions, so the fade can
   * point at it. The bar only scrolls where it does not fit, so on a wide
   * screen neither side is marked.
   */
  private measureScrollState() {
    const scroller = this.getScroller();
    if (!scroller) return;
    this.moreActionsLeft = scroller.scrollLeft > 1;
    this.moreActionsRight =
      scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
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
   * Keep the tooltip on the mobile screen: next to the left or right edge it would
   * otherwise hang off.
   */
  private clampTooltipToViewport() {
    const tooltip = this.querySelector<HTMLElement>(".unit-display-tooltip");
    const root = this.querySelector<HTMLElement>(".unit-display-root");
    if (!tooltip || !root || this._tooltipCenter === null) return;
    const rootBounds = root.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const margin = 8;
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
    return html`
      <div
        class="unit-display-root relative border-t border-white/10 p-0.5 w-full
          ${this.moreActionsLeft ? "unit-display-more-left" : ""}
          ${this.moreActionsRight ? "unit-display-more-right" : ""}"
        data-radial-click-through
        @contextmenu=${(event: Event) => event.preventDefault()}
      >
        <div
          class="unit-display-scroll w-full overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x lg:overflow-visible"
          @scroll=${this.onScroll}
        >
          <div
            class="unit-display-grid grid grid-cols-[repeat(var(--unit-display-columns),minmax(0,1fr))] gap-0.5 w-full mx-auto lg:grid-rows-1 lg:grid-flow-col lg:grid-cols-none lg:auto-cols-max lg:w-fit max-lg:landscape:grid-rows-1 max-lg:landscape:grid-flow-col max-lg:landscape:grid-cols-none max-lg:landscape:auto-cols-[47px] max-lg:landscape:w-max max-[360px]:grid-cols-none max-[360px]:grid-flow-col max-[360px]:auto-cols-[44px] max-[360px]:w-max"
            style=${`--unit-display-columns: ${this.enabledUnitCount}`}
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
          } border border-slate-500 rounded-sm min-h-11 w-full px-1 pb-0.5 flex items-center justify-center gap-0.5 cursor-pointer lg:min-h-0 lg:px-0.5 lg:justify-start landscape:px-0.5
             ${
            selected
              ? "pointer-fine:hover:bg-gray-400/10"
              : "pointer-fine:hover:bg-gray-800"
          }
             rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}
             ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          @click=${(event: Event) => {
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
                  selectedGhost === null
                    ? null
                    : highlightTypesForUnit(selectedGhost),
                ),
              );
            }
            this.requestUpdate();
          }}
          @pointerenter=${(event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            this.eventBus?.emit(
              new ToggleStructureEvent(highlightTypesForUnit(unitType)),
            );
          }}
          @pointerleave=${(event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            const selectedGhost = this.uiState.ghostStructure;
            this.eventBus?.emit(
              new ToggleStructureEvent(
                selectedGhost === null
                  ? null
                  : highlightTypesForUnit(selectedGhost),
              ),
            );
          }}
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
            class="flex flex-col items-center gap-0 pt-0.5 lg:flex-row lg:gap-0.5 max-lg:landscape:flex-row max-lg:landscape:gap-0.5"
          >
            <img
              src=${icon}
              alt=${translateText("unit_type." + structureKey)}
              class="align-middle size-7 lg:size-5 max-lg:landscape:size-6"
            />
            ${
              number !== null
                ? html`<span class="text-[10px] leading-none lg:text-xs"
                    >${renderNumber(number)}</span
                  >`
                : null
            }
          </div>
        </div>
      </div>
    `;
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
    const left =
      itemBounds.left + itemBounds.width / 2 - (rootBounds?.left ?? 0);
    const top = itemBounds.top - (rootBounds?.top ?? 0) - 4;
    // Kept for the clamp after the render: the tooltip cannot be measured
    // before it exists.
    this._tooltipCenter = left;

    return html`
      <div
        class="unit-display-tooltip ${peek ? "block" : "hidden pointer-fine:block"} absolute -translate-x-1/2 -translate-y-full text-gray-200 text-center w-max max-w-[min(100%_-_1rem,100vw_-_1rem)] break-words text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
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
