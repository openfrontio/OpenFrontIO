/**
 * Advanced in-game layer bridges consolidated in one module.
 */

import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  Gold,
  MessageType,
  PlayerActions,
  PlayerProfile,
  PlayerType,
  Relation,
  Tick,
  Unit,
  UnitType,
  getMessageCategory,
  MessageCategory,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  AllianceView,
  AttackUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { TileRef } from "../../../core/game/GameMap";
import { UserSettings } from "../../../core/game/UserSettings";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";
import { ClientID } from "../../../core/Schemas";
import { Emoji, flattenedEmojiTable, onlyImages } from "../../../core/Util";
import Countries from "resources/countries.json" with { type: "json" };
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { CloseRadialMenuEvent } from "../../GameActionBridges";
import {
  DioxusSendResourceModal,
  ShowChatModalEvent,
  ShowPlayerModerationModalEvent,
} from "../../InGameModalBridges";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  initDioxusRuntime,
} from "../../UiRuntimeBridge";
import {
  AttackRatioEvent,
  AlternateViewEvent,
  CloseViewEvent,
  ContextMenuEvent,
  GhostStructureChangedEvent,
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
  MouseMoveEvent,
  MouseUpEvent,
  RefreshGraphicsEvent,
  ShowEmojiMenuEvent,
  ShowSettingsModalEvent,
  SwapRocketDirectionEvent,
  ToggleStructureEvent,
} from "../../InputHandler";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  PauseGameIntentEvent,
  SendAllianceExtensionIntentEvent,
  SendAllianceReplyIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendEmbargoAllIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import {
  getMessageTypeClasses,
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import {
  ensureUiSessionRuntimeStarted,
  readUiSessionStorage,
  reportUiModalState,
  requestUiModalClose,
  UI_SESSION_RUNTIME_EVENTS,
  type UiSessionModalCloseDetail,
} from "../../runtime/UiSessionRuntime";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_SNAPSHOTS,
} from "../../runtime/UiRuntimeProtocol";
import { subscribeUiRuntimeEvents } from "../../runtime/UiRuntimeEventRouter";
import { parseUiRuntimePayload } from "../../runtime/UiRuntimeParsing";
import SoundManager from "../../sound/SoundManager";
import { getFirstPlacePlayer, getPlayerIcons } from "../PlayerIcons";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

import allianceIcon from "/images/AllianceIconWhite.svg?url";
import allianceIconInfo from "/images/AllianceIcon.svg?url";
import chatIcon from "/images/ChatIconWhite.svg?url";
import cityIcon from "/images/CityIconWhite.svg?url";
import cursorPriceIcon from "/images/CursorPriceIconWhite.svg?url";
import darkModeIcon from "/images/DarkModeIconWhite.svg?url";
import defensePostIcon from "/images/ShieldIconWhite.svg?url";
import donateGoldIcon from "/images/DonateGoldIconWhite.svg?url";
import donateTroopIcon from "/images/DonateTroopIconWhite.svg?url";
import emojiIcon from "/images/EmojiIconWhite.svg?url";
import exitIcon from "/images/ExitIconWhite.svg?url";
import explosionIcon from "/images/ExplosionIconWhite.svg?url";
import factoryIcon from "/images/FactoryIconWhite.svg?url";
import goldCoinIcon from "/images/GoldCoinIcon.svg?url";
import hydrogenBombIcon from "/images/MushroomCloudIconWhite.svg?url";
import atomBombIcon from "/images/NukeIconWhite.svg?url";
import mirvIcon from "/images/MIRVIcon.svg?url";
import musicIcon from "/images/music.svg?url";
import missileSiloIcon from "/images/MissileSiloIconWhite.svg?url";
import mouseIcon from "/images/MouseIconWhite.svg?url";
import ninjaIcon from "/images/NinjaIconWhite.svg?url";
import nukeIcon from "/images/NukeIconWhite.svg?url";
import portIcon from "/images/PortIcon.svg?url";
import samLauncherIcon from "/images/SamLauncherIconWhite.svg?url";
import settingsIcon from "/images/SettingIconWhite.svg?url";
import shieldIcon from "/images/ShieldIconWhite.svg?url";
import sirenIcon from "/images/SirenIconWhite.svg?url";
import startTradingIcon from "/images/TradingIconWhite.png?url";
import stopTradingIcon from "/images/StopIconWhite.png?url";
import structureIcon from "/images/CityIconWhite.svg?url";
import swordIcon from "/images/SwordIconWhite.svg?url";
import targetIcon from "/images/TargetIconWhite.svg?url";
import traitorIcon from "/images/TraitorIconLightRed.svg?url";
import breakAllianceIcon from "/images/TraitorIconWhite.svg?url";
import treeIcon from "/images/TreeIconWhite.svg?url";
import warshipIcon from "/images/BattleshipIconWhite.svg?url";

interface GameEvent {
  description: string;
  unsafeDescription?: boolean;
  buttons?: {
    text: string;
    className: string;
    action: () => void;
    preventClose?: boolean;
  }[];
  type: MessageType;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  priority?: number;
  duration?: Tick;
  focusID?: number;
  unitView?: UnitView;
  shouldDelete?: (game: GameView) => boolean;
  allianceID?: number;
}

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  if (!dispatchUiAction({ type: actionType, payload })) {
    console.warn(
      "[AdvancedLayerBridges] Failed to dispatch runtime action:",
      actionType,
    );
  }
}

const SETTINGS_ATTACK_RATIO_STORAGE_KEY = "settings.attackRatio";
const SETTINGS_KEYBINDS_STORAGE_KEY = "settings.keybinds";

@customElement("dioxus-events-display")
export class DioxusEventsDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private events: GameEvent[] = [];
  private alliancesCheckedAt = new Map<number, Tick>();
  private incomingAttacks: AttackUpdate[] = [];
  private outgoingAttacks: AttackUpdate[] = [];
  private outgoingLandAttacks: AttackUpdate[] = [];
  private outgoingBoats: UnitView[] = [];
  private _hidden: boolean = false;
  private _isVisible: boolean = false;
  private newEvents: number = 0;
  private latestGoldAmount: bigint | null = null;
  private goldAmountAnimating: boolean = false;
  private goldAmountTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.NUKE, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
  ]);

  // Map button actionIds to their handler functions
  private buttonActions: Map<string, () => void> = new Map();
  private nextButtonId = 0;

  @state() private isLaunched = false;

  private runtimeUnsubscribe?: () => void;

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [GameUpdateType.AllianceRequest, this.onAllianceRequestEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
    [GameUpdateType.AllianceExpired, this.onAllianceExpiredEvent.bind(this)],
  ] as const;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    if (this.goldAmountTimeoutId !== null) {
      clearTimeout(this.goldAmountTimeoutId);
      this.goldAmountTimeoutId = null;
    }
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameEventsDisplayLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayToggleHidden,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayToggleFilter,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayFocusPlayer,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayFocusUnit,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayButtonClick,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayAttackClick,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayRetaliate,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayCancelAttack,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayFocusBoat,
          UI_RUNTIME_EVENTS.uiInGameEventsDisplayCancelBoat,
        ],
        (event) => {
          const payload = parseUiRuntimePayload(event.payload);
          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayToggleHidden) {
            this._hidden = !this._hidden;
            if (this._hidden) {
              this.newEvents = 0;
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayToggleFilter) {
            const category = payload.category;
            if (typeof category !== "string") {
              return;
            }
            const categoryMap: Record<string, MessageCategory> = {
              attack: MessageCategory.ATTACK,
              nuke: MessageCategory.NUKE,
              trade: MessageCategory.TRADE,
              alliance: MessageCategory.ALLIANCE,
              chat: MessageCategory.CHAT,
            };
            const cat = categoryMap[category];
            if (cat !== undefined) {
              const current = this.eventsFilters.get(cat) ?? false;
              this.eventsFilters.set(cat, !current);
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayFocusPlayer) {
            const id = payload.playerId;
            if (typeof id === "number") {
              this.emitGoToPlayerEvent(id);
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayFocusUnit) {
            const id = payload.unitId;
            if (typeof id === "number") {
              const unitView = this.game.unit(id);
              if (unitView) {
                this.eventBus.emit(new GoToUnitEvent(unitView));
              }
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayButtonClick) {
            const actionId = payload.actionId;
            if (typeof actionId !== "string") {
              return;
            }
            const action = this.buttonActions.get(actionId);
            if (action) {
              action();
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayAttackClick) {
            const attackId = payload.attackId;
            if (typeof attackId !== "string") {
              return;
            }
            const attack =
              this.incomingAttacks.find((a) => a.id === attackId) ??
              this.outgoingAttacks.find((a) => a.id === attackId);
            if (attack) {
              this.attackWarningOnClick(attack);
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayRetaliate) {
            const attackId = payload.attackId;
            if (typeof attackId !== "string") {
              return;
            }
            const attack = this.incomingAttacks.find((a) => a.id === attackId);
            if (attack) {
              this.handleRetaliate(attack);
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayCancelAttack) {
            const attackId = payload.attackId;
            if (typeof attackId === "string") {
              this.emitCancelAttackIntent(attackId);
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayFocusBoat) {
            const boatId = payload.boatId;
            if (typeof boatId !== "number") {
              return;
            }
            const boat = this.outgoingBoats.find((b) => b.id() === boatId);
            if (boat) {
              this.emitGoToUnitEvent(boat);
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameEventsDisplayCancelBoat) {
            const boatId = payload.boatId;
            if (typeof boatId === "number") {
              this.emitBoatCancelIntent(boatId);
            }
          }
        },
      );
    } catch (err) {
      console.error("[DioxusEventsDisplay] Failed to launch:", err);
    }
  }

  init() {}

  tick() {
    if (!this.isLaunched || !this.game) return;
    this.active = true;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
      }
      this.sendState();
      return;
    }

    this.checkForAllianceExpirations();

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    let remainingEvents = this.events.filter((event) => {
      const shouldKeep =
        this.game.ticks() - event.createdAt < (event.duration ?? 600) &&
        !event.shouldDelete?.(this.game);
      if (!shouldKeep && event.onDelete) {
        event.onDelete();
      }
      return shouldKeep;
    });

    if (remainingEvents.length > 30) {
      remainingEvents = remainingEvents.slice(-30);
    }

    this.events = remainingEvents;

    // Update attacks
    this.incomingAttacks = myPlayer.incomingAttacks().filter((a) => {
      const t = (this.game.playerBySmallID(a.attackerID) as PlayerView).type();
      return t !== PlayerType.Bot;
    });

    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    this.outgoingLandAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    this.outgoingBoats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);

    this.sendState();
  }

  // --- Event handlers (same as original) ---

  private checkForAllianceExpirations() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer?.isAlive()) return;

    for (const alliance of myPlayer.alliances()) {
      if (
        alliance.expiresAt >
        this.game.ticks() + this.game.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }

      if (
        (this.alliancesCheckedAt.get(alliance.id) ?? 0) >=
        this.game.ticks() - this.game.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }

      this.alliancesCheckedAt.set(alliance.id, this.game.ticks());

      const other = this.game.player(alliance.other) as PlayerView;
      if (!other.isAlive()) continue;

      this.addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.name(),
        }),
        type: MessageType.RENEW_ALLIANCE,
        duration:
          this.game.config().allianceExtensionPromptOffset() - 3 * 10,
        buttons: [
          {
            text: translateText("events_display.focus"),
            className: "btn-gray",
            action: () => this.eventBus.emit(new GoToPlayerEvent(other)),
            preventClose: true,
          },
          {
            text: translateText("events_display.renew_alliance", {
              name: other.name(),
            }),
            className: "btn",
            action: () =>
              this.eventBus.emit(new SendAllianceExtensionIntentEvent(other)),
          },
          {
            text: translateText("events_display.ignore"),
            className: "btn-info",
            action: () => {},
          },
        ],
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: other.smallID(),
        allianceID: alliance.id,
      });
    }
  }

  private addEvent(event: GameEvent) {
    this.events = [...this.events, event];
    if (this._hidden) {
      this.newEvents++;
    }
  }

  private removeEvent(index: number) {
    this.events = [
      ...this.events.slice(0, index),
      ...this.events.slice(index + 1),
    ];
  }

  private removeAllianceRenewalEvents(allianceID: number) {
    this.events = this.events.filter(
      (event) =>
        !(
          event.type === MessageType.RENEW_ALLIANCE &&
          event.allianceID === allianceID
        ),
    );
  }

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    if (event.goldAmount !== undefined) {
      const hasChanged = this.latestGoldAmount !== event.goldAmount;
      this.latestGoldAmount = event.goldAmount;

      if (this.goldAmountTimeoutId !== null) {
        clearTimeout(this.goldAmountTimeoutId);
      }

      this.goldAmountTimeoutId = setTimeout(() => {
        this.latestGoldAmount = null;
        this.goldAmountTimeoutId = null;
      }, 5000);

      if (hasChanged) {
        this.goldAmountAnimating = true;
        setTimeout(() => {
          this.goldAmountAnimating = false;
        }, 600);
      }
    }

    let description: string = event.message;
    if (event.message.startsWith("events_display.")) {
      description = translateText(event.message, event.params ?? {});
    }

    this.addEvent({
      description: description,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
    });
  }

  onDisplayChatEvent(event: DisplayChatMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID === null ||
      !myPlayer ||
      myPlayer.smallID() !== event.playerID
    ) {
      return;
    }

    const baseMessage = translateText(`chat.${event.category}.${event.key}`);
    let translatedMessage = baseMessage;
    if (event.target) {
      try {
        const targetPlayer = this.game.player(event.target);
        const targetName = targetPlayer?.displayName() ?? event.target;
        translatedMessage = baseMessage.replace("[P1]", targetName);
      } catch (e) {
        console.warn(
          `Failed to resolve player for target ID '${event.target}'`,
          e,
        );
        return;
      }
    }

    let otherPlayerDisplayName: string = "";
    if (event.recipient !== null) {
      const player = this.game.player(event.recipient);
      otherPlayerDisplayName = player ? player.displayName() : "";
    }

    this.addEvent({
      description: translateText(event.isFrom ? "chat.from" : "chat.to", {
        user: otherPlayerDisplayName,
        msg: translatedMessage,
      }),
      createdAt: this.game.ticks(),
      highlight: true,
      type: MessageType.CHAT,
      unsafeDescription: false,
    });
  }

  onAllianceRequestEvent(update: AllianceRequestUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.recipientID !== myPlayer.smallID()) {
      return;
    }

    const requestor = this.game.playerBySmallID(
      update.requestorID,
    ) as PlayerView;
    const recipient = this.game.playerBySmallID(
      update.recipientID,
    ) as PlayerView;

    this.addEvent({
      description: translateText("events_display.request_alliance", {
        name: requestor.name(),
      }),
      buttons: [
        {
          text: translateText("events_display.focus"),
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(requestor)),
          preventClose: true,
        },
        {
          text: translateText("events_display.accept_alliance"),
          className: "btn",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, true),
            ),
        },
        {
          text: translateText("events_display.reject_alliance"),
          className: "btn-info",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, false),
            ),
        },
      ],
      highlight: true,
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
      priority: 0,
      duration: this.game.config().allianceRequestDuration() - 20,
      shouldDelete: (game) => {
        return requestor.isAlliedWith(recipient);
      },
      focusID: update.requestorID,
    });
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    if (update.request.recipientID === myPlayer.smallID()) {
      this.events = this.events.filter(
        (event) =>
          !(
            event.type === MessageType.ALLIANCE_REQUEST &&
            event.focusID === update.request.requestorID
          ),
      );
      return;
    }
    if (update.request.requestorID !== myPlayer.smallID()) {
      return;
    }

    const recipient = this.game.playerBySmallID(
      update.request.recipientID,
    ) as PlayerView;
    this.addEvent({
      description: translateText("events_display.alliance_request_status", {
        name: recipient.name(),
        status: update.accepted
          ? translateText("events_display.alliance_accepted")
          : translateText("events_display.alliance_rejected"),
      }),
      type: update.accepted
        ? MessageType.ALLIANCE_ACCEPTED
        : MessageType.ALLIANCE_REJECTED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: update.request.recipientID,
    });
  }

  onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    this.removeAllianceRenewalEvents(update.allianceID);

    const betrayed = this.game.playerBySmallID(
      update.betrayedID,
    ) as PlayerView;
    const traitor = this.game.playerBySmallID(update.traitorID) as PlayerView;

    if (betrayed.isDisconnected()) return;

    if (!betrayed.isTraitor() && traitor === myPlayer) {
      const malusPercent = Math.round(
        (1 - this.game.config().traitorDefenseDebuff()) * 100,
      );
      const traitorDuration = Math.floor(
        this.game.config().traitorDuration() * 0.1,
      );
      const durationText =
        traitorDuration === 1
          ? translateText("events_display.duration_second")
          : translateText("events_display.duration_seconds_plural", {
              seconds: traitorDuration,
            });

      this.addEvent({
        description: translateText("events_display.betrayal_description", {
          name: betrayed.name(),
          malusPercent: malusPercent,
          durationText: durationText,
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.name(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.traitorID,
        buttons: [
          {
            text: translateText("events_display.focus"),
            className: "btn-gray",
            action: () => this.eventBus.emit(new GoToPlayerEvent(traitor)),
            preventClose: true,
          },
        ],
      });
    }
  }

  onAllianceExpiredEvent(update: AllianceExpiredUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const otherID =
      update.player1ID === myPlayer.smallID()
        ? update.player2ID
        : update.player2ID === myPlayer.smallID()
          ? update.player1ID
          : null;
    if (otherID === null) return;
    const other = this.game.playerBySmallID(otherID) as PlayerView;
    if (!other || !myPlayer.isAlive() || !other.isAlive()) return;

    this.addEvent({
      description: translateText("events_display.alliance_expired", {
        name: other.name(),
      }),
      type: MessageType.ALLIANCE_EXPIRED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: otherID,
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.myPlayer() as PlayerView;
    if (!myPlayer || !myPlayer.isFriendly(other)) return;

    const target = this.game.playerBySmallID(event.targetID) as PlayerView;

    this.addEvent({
      description: translateText("events_display.attack_request", {
        name: other.name(),
        target: target.name(),
      }),
      type: MessageType.ATTACK_REQUEST,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: event.targetID,
    });
  }

  onEmojiMessageEvent(update: EmojiUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const recipient =
      update.emoji.recipientID === AllPlayers
        ? AllPlayers
        : this.game.playerBySmallID(update.emoji.recipientID);
    const sender = this.game.playerBySmallID(
      update.emoji.senderID,
    ) as PlayerView;

    if (recipient === myPlayer) {
      this.addEvent({
        description: `${sender.displayName()}: ${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        description: translateText("events_display.sent_emoji", {
          name: (recipient as PlayerView).displayName(),
          emoji: update.emoji.message,
        }),
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: recipient.smallID(),
      });
    }
  }

  onUnitIncomingEvent(event: UnitIncomingUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    const unitView = this.game.unit(event.unitID);

    this.addEvent({
      description: event.message,
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView: unitView,
    });
  }

  // --- Helper methods ---

  emitCancelAttackIntent(id: string) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelAttackIntentEvent(id));
  }

  emitBoatCancelIntent(id: number) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelBoatIntentEvent(id));
  }

  emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    if (!attacker) return;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  emitGoToUnitEvent(unit: UnitView) {
    this.eventBus.emit(new GoToUnitEvent(unit));
  }

  private async attackWarningOnClick(attack: AttackUpdate) {
    const playerView = this.game.playerBySmallID(attack.attackerID);
    if (playerView !== undefined) {
      if (playerView instanceof PlayerView) {
        const averagePosition = await playerView.attackAveragePosition(
          attack.attackerID,
          attack.id,
        );
        if (averagePosition === null) {
          this.emitGoToPlayerEvent(attack.attackerID);
        } else {
          this.eventBus.emit(
            new GoToPositionEvent(averagePosition.x, averagePosition.y),
          );
        }
      }
    } else {
      this.emitGoToPlayerEvent(attack.attackerID);
    }
  }

  private handleRetaliate(attack: AttackUpdate) {
    const attacker = this.game.playerBySmallID(
      attack.attackerID,
    ) as PlayerView;
    if (!attacker) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const counterTroops = Math.min(
      attack.troops,
      this.uiState.attackRatio * myPlayer.troops(),
    );
    this.eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
  }

  // --- State serialization ---

  private sendState() {
    if (!this.isLaunched) return;

    // Clear button actions for rebuild
    this.buttonActions.clear();

    // Filter events
    const filteredEvents = this.events.filter((event) => {
      const category = getMessageCategory(event.type);
      return !this.eventsFilters.get(category);
    });

    filteredEvents.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });

    // Serialize events
    const eventEntries = filteredEvents.map((event, index) => {
      const buttons = (event.buttons ?? []).map((btn) => {
        const actionId = `btn_${this.nextButtonId++}`;
        // Store action with close behavior
        this.buttonActions.set(actionId, () => {
          btn.action();
          if (!btn.preventClose) {
            const originalIndex = this.events.findIndex((e) => e === event);
            if (originalIndex !== -1) {
              this.removeEvent(originalIndex);
            }
          }
        });

        let btnClass = "green";
        if (btn.className.includes("btn-info")) {
          btnClass = "blue";
        } else if (btn.className.includes("btn-gray")) {
          btnClass = "gray";
        }

        return {
          text: btn.text,
          btnClass,
          actionId,
          preventClose: btn.preventClose ?? false,
          eventIndex: index,
        };
      });

      const description = event.unsafeDescription
        ? onlyImages(event.description)
        : event.description;

      return {
        description,
        isHtml: event.unsafeDescription ?? false,
        cssClass: getMessageTypeClasses(event.type),
        hasFocus: event.focusID !== undefined && event.focusID !== null,
        focusId: event.focusID ?? null,
        hasUnitFocus: event.unitView !== undefined && event.unitView !== null,
        unitId: event.unitView?.id() ?? null,
        buttons,
        index,
      };
    });

    // Serialize attacks
    const incomingAttacks = this.incomingAttacks.map((atk) => ({
      id: atk.id,
      troops: renderTroops(atk.troops),
      targetName: (
        this.game.playerBySmallID(atk.attackerID) as PlayerView
      )?.name(),
      retreating: atk.retreating,
      attackerId: atk.attackerID,
      isIncoming: true,
    }));

    const outgoingAttacks = this.outgoingAttacks.map((atk) => ({
      id: atk.id,
      troops: renderTroops(atk.troops),
      targetName: (
        this.game.playerBySmallID(atk.targetID) as PlayerView
      )?.name(),
      retreating: atk.retreating,
      attackerId: null,
      isIncoming: false,
    }));

    const outgoingLandAttacks = this.outgoingLandAttacks.map((atk) => ({
      id: atk.id,
      troops: renderTroops(atk.troops),
      targetName: "",
      retreating: atk.retreating,
      attackerId: null,
      isIncoming: false,
    }));

    const outgoingBoats = this.outgoingBoats.map((boat) => ({
      id: boat.id(),
      troops: renderTroops(boat.troops()),
      retreating: boat.retreating(),
    }));

    // Betrayal debuff
    const myPlayer = this.game.myPlayer();
    const showBetrayalDebuff =
      myPlayer !== null &&
      myPlayer.isTraitor() &&
      myPlayer.getTraitorRemainingTicks() > 0;
    const betrayalDebuffText = showBetrayalDebuff
      ? translateText("events_display.betrayal_debuff_ends", {
          time: Math.ceil(myPlayer!.getTraitorRemainingTicks() / 10),
        })
      : "";

    const state = {
      isVisible: this.active && this._isVisible,
      isHidden: this._hidden,
      newEvents: this.newEvents,
      latestGoldAmount:
        this.latestGoldAmount !== null
          ? renderNumber(this.latestGoldAmount)
          : null,
      goldAnimating: this.goldAmountAnimating,
      swordIcon,
      nukeIcon,
      donateGoldIcon,
      allianceIcon,
      chatIcon,
      attackFiltered: this.eventsFilters.get(MessageCategory.ATTACK) ?? false,
      nukeFiltered: this.eventsFilters.get(MessageCategory.NUKE) ?? false,
      tradeFiltered: this.eventsFilters.get(MessageCategory.TRADE) ?? false,
      allianceFiltered:
        this.eventsFilters.get(MessageCategory.ALLIANCE) ?? false,
      chatFiltered: this.eventsFilters.get(MessageCategory.CHAT) ?? false,
      events: eventEntries,
      incomingAttacks,
      outgoingAttacks,
      outgoingLandAttacks,
      outgoingBoats,
      showBetrayalDebuff,
      betrayalDebuffText,
      hideLabel: translateText("leaderboard.hide"),
      retreatingLabel: translateText("events_display.retreating"),
      retaliateLabel: translateText("events_display.retaliate"),
      wildernessLabel: translateText("help_modal.ui_wilderness"),
      boatLabel: translateText("events_display.boat"),
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameEventsDisplay,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: { state },
      })
    ) {
      console.warn("[DioxusEventsDisplay] Failed to dispatch runtime snapshot");
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-events-display-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-events-display": DioxusEventsDisplay;
  }
}

interface ActionButtonJson {
  id: string;
  label: string;
  title: string;
  icon: string;
  iconAlt: string;
  btnType: string;
  disabled: boolean;
}

@customElement("dioxus-player-panel")
export class DioxusPlayerPanel extends LitElement implements Layer {
  public g: GameView;
  public eventBus: EventBus;
  public emojiTable: DioxusEmojiTable;
  public uiState: UIState;

  private actions: PlayerActions | null = null;
  private tile: TileRef | null = null;
  private _profileForPlayerId: number | null = null;
  private kickedPlayerIDs = new Set<string>();
  private otherProfile: PlayerProfile | null = null;
  private suppressNextHide: boolean = false;

  @state() public isVisible: boolean = false;
  @state() private isLaunched = false;

  private dioxusSendResourceModal: DioxusSendResourceModal | null = null;

  // Action handlers
  private actionHandlers: Map<string, (e?: Event) => void> = new Map();

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGamePlayerPanelLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGamePlayerPanelClose,
          UI_RUNTIME_EVENTS.uiInGamePlayerPanelAction,
          UI_RUNTIME_EVENTS.uiInGamePlayerPanelToggleRocket,
          UI_RUNTIME_EVENTS.uiInGameSendResourceCloseRequest,
          UI_RUNTIME_EVENTS.uiInGameSendResourceConfirm,
          UI_RUNTIME_EVENTS.uiInGamePlayerModerationKick,
        ],
        (event) => {
          const payload = parseUiRuntimePayload(event.payload);
          if (event.type === UI_RUNTIME_EVENTS.uiInGamePlayerPanelClose) {
            this.hide();
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGamePlayerPanelAction) {
            const actionId = payload.actionId;
            if (typeof actionId !== "string") {
              return;
            }
            const handler = this.actionHandlers.get(actionId);
            if (handler) {
              handler();
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGamePlayerPanelToggleRocket) {
            const next = !this.uiState.rocketDirectionUp;
            this.eventBus.emit(new SwapRocketDirectionEvent(next));
            return;
          }

          if (
            event.type === UI_RUNTIME_EVENTS.uiInGameSendResourceCloseRequest ||
            event.type === UI_RUNTIME_EVENTS.uiInGameSendResourceConfirm
          ) {
            this.hide();
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGamePlayerModerationKick) {
            const playerId = payload.playerId;
            if (typeof playerId === "string") {
              this.kickedPlayerIDs.add(playerId);
            }
            this.hide();
          }
        },
      );
    } catch (err) {
      console.error("[DioxusPlayerPanel] Failed to launch:", err);
    }
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, () => {
      if (this.isVisible) {
        this.hide();
      }
    });
    eventBus.on(SwapRocketDirectionEvent, (event) => {
      this.uiState.rocketDirectionUp = event.rocketDirectionUp;
    });
  }

  init() {
    this.eventBus.on(MouseUpEvent, () => {
      if (this.suppressNextHide) {
        this.suppressNextHide = false;
        return;
      }
      this.hide();
    });

    this.dioxusSendResourceModal = document.querySelector(
      "dioxus-send-resource-modal",
    ) as DioxusSendResourceModal | null;
  }

  async tick() {
    if (!this.isLaunched) return;

    if (this.isVisible && this.tile) {
      const owner = this.g.owner(this.tile);
      if (owner && owner.isPlayer()) {
        const pv = owner as PlayerView;
        const id = pv.id();
        if (this._profileForPlayerId !== Number(id)) {
          this.otherProfile = await pv.profile();
          this._profileForPlayerId = Number(id);
        }
      }

      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && myPlayer.isAlive()) {
        this.actions = await myPlayer.actions(this.tile);
      }
    }

    this.sendState();
  }

  public show(actions: PlayerActions, tile: TileRef) {
    this.actions = actions;
    this.tile = tile;
    this.isVisible = true;
  }

  public openSendGoldModal(
    actions: PlayerActions,
    tile: TileRef,
    target: PlayerView,
  ) {
    this.suppressNextHide = true;
    this.actions = actions;
    this.tile = tile;
    this.isVisible = true;

    const my = this.g.myPlayer();
    if (my && this.dioxusSendResourceModal) {
      this.dioxusSendResourceModal.show("gold", my, target);
    }
  }

  public hide() {
    this.isVisible = false;
  }

  // --- State serialization ---

  private sendState() {
    if (!this.isLaunched) return;

    this.actionHandlers.clear();

    if (!this.isVisible || !this.tile) {
      if (
        !dispatchUiSnapshot({
          type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePlayerPanel,
          scope: "ingame",
          tick: this.g?.ticks(),
          payload: {
            state: { isVisible: false },
          },
        })
      ) {
        console.warn("[DioxusPlayerPanel] Failed to dispatch runtime snapshot");
      }
      return;
    }

    const my = this.g.myPlayer();
    if (!my) {
      if (
        !dispatchUiSnapshot({
          type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePlayerPanel,
          scope: "ingame",
          tick: this.g?.ticks(),
          payload: {
            state: { isVisible: false },
          },
        })
      ) {
        console.warn("[DioxusPlayerPanel] Failed to dispatch runtime snapshot");
      }
      return;
    }

    const owner = this.g.owner(this.tile);
    if (!owner || !owner.isPlayer()) {
      this.hide();
      return;
    }
    const other = owner as PlayerView;

    const state = this.buildPanelState(my, other);
    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePlayerPanel,
        scope: "ingame",
        tick: this.g?.ticks(),
        payload: { state },
      })
    ) {
      console.warn("[DioxusPlayerPanel] Failed to dispatch runtime snapshot");
    }
  }

  private buildPanelState(my: PlayerView, other: PlayerView) {
    const isSelf = other === my;

    // Identity
    const flagCode = other.cosmetics.flag;
    const country =
      typeof flagCode === "string"
        ? Countries.find((c) => c.code === flagCode)
        : undefined;
    const hasFlag = !!country && typeof flagCode === "string";

    let playerTypeChip: {
      label: string;
      icon: string;
      classes: string;
    } | null = null;
    if (other.type() !== PlayerType.Human) {
      const chip = this.identityChipProps(other.type());
      playerTypeChip = {
        label: translateText(chip.labelKey),
        icon: chip.icon,
        classes: chip.classes,
      };
    }

    // Traitor
    const isTraitor = other.isTraitor();
    let traitorDuration: string | null = null;
    let traitorUrgent = false;
    if (isTraitor) {
      const secs = this.getTraitorRemainingSeconds(other);
      if (secs !== null) {
        traitorDuration = renderDuration(secs);
        traitorUrgent = secs <= 10;
      }
    }

    // Relation
    let showRelation = false;
    let relationClass = "";
    let relationName = "";
    if (
      other.type() === PlayerType.Nation &&
      !isTraitor &&
      !my.isAlliedWith(other) &&
      this.otherProfile &&
      my
    ) {
      const relation =
        this.otherProfile.relations?.[my.smallID()] ?? Relation.Neutral;
      showRelation = true;
      relationClass = this.getRelationClass(relation);
      relationName = this.getRelationName(relation);
    }

    // Alliance expiry
    let showAllianceExpiry = false;
    let allianceExpiryText = "";
    let allianceExpiryColor = "text-white";
    if (this.actions?.interaction?.allianceExpiresAt !== undefined) {
      const expiresAt = this.actions.interaction.allianceExpiresAt;
      const remainingTicks = expiresAt - this.g.ticks();
      const remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10));
      if (remainingTicks > 0) {
        showAllianceExpiry = true;
        allianceExpiryText = renderDuration(remainingSeconds);
        allianceExpiryColor = this.getExpiryColorClass(remainingSeconds);
      }
    }

    // Allies
    const allies = other.allies();
    const nameCollator = new Intl.Collator(undefined, {
      sensitivity: "base",
    });
    const alliesSorted = [...allies].sort((a, b) =>
      nameCollator.compare(a.name(), b.name()),
    );

    // Embargo
    const isEmbargoed = other.hasEmbargoAgainst(my);

    // Actions
    const actions = this.buildActions(my, other, isSelf);
    const secondaryActions = this.buildSecondaryActions(my, other, isSelf);
    const selfTradeActions = isSelf
      ? this.buildSelfTradeActions(my)
      : [];

    // Moderation
    const showModeration = my.isLobbyCreator() && !isSelf;
    let moderationAction: ActionButtonJson | null = null;
    if (showModeration) {
      const modId = "moderation";
      const modLabel = translateText("player_panel.moderation");
      this.actionHandlers.set(modId, () => {
        this.suppressNextHide = true;
        this.eventBus.emit(
          new ShowPlayerModerationModalEvent(
            true,
            my ?? null,
            other,
            this.kickedPlayerIDs.has(String(other.id())),
          ),
        );
      });
      moderationAction = {
        id: modId,
        label: modLabel,
        title: modLabel,
        icon: shieldIcon,
        iconAlt: "Moderation",
        btnType: "red",
        disabled: false,
      };
    }

    return {
      isVisible: true,
      playerName: other.name(),
      playerFlag: flagCode ?? "",
      hasFlag,
      playerTypeChip,
      isTraitor,
      traitorLabel: translateText("player_panel.traitor"),
      traitorIcon,
      traitorDuration,
      traitorUrgent,
      showRelation,
      relationClass,
      relationName,
      gold: renderNumber(other.gold() || 0),
      goldLabel: translateText("player_panel.gold"),
      troops: renderTroops(other.troops() || 0),
      troopsLabel: translateText("player_panel.troops"),
      betrayals: other.data.betrayals ?? 0,
      betrayalsLabel: translateText("player_panel.betrayals"),
      tradingLabel: translateText("player_panel.trading"),
      isEmbargoed,
      tradingStoppedLabel: translateText("player_panel.stopped"),
      tradingActiveLabel: translateText("player_panel.active"),
      showAllianceExpiry,
      allianceTimeRemainingLabel: translateText(
        "player_panel.alliance_time_remaining",
      ),
      allianceExpiryText,
      allianceExpiryColor,
      alliancesLabel: translateText("player_panel.alliances"),
      noneLabel: translateText("common.none"),
      allies: alliesSorted.map((p) => ({ name: p.name() })),
      showRocketToggle: isSelf,
      rocketToggleLabel: translateText(
        "player_panel.flip_rocket_trajectory",
      ),
      rocketDirectionLabel: this.uiState.rocketDirectionUp
        ? translateText("player_panel.arc_up")
        : translateText("player_panel.arc_down"),
      actions,
      secondaryActions,
      selfTradeActions,
      showModeration,
      moderationAction,
      closeLabel: translateText("common.close") || "Close",
    };
  }

  private buildActions(
    my: PlayerView,
    other: PlayerView,
    isSelf: boolean,
  ): ActionButtonJson[] {
    const btns: ActionButtonJson[] = [];

    // Chat
    const chatId = "chat";
    this.actionHandlers.set(chatId, () => {
      this.eventBus.emit(new ShowChatModalEvent(true, my, other));
      this.hide();
    });
    btns.push({
      id: chatId,
      label: translateText("player_panel.chat"),
      title: translateText("player_panel.chat"),
      icon: chatIcon,
      iconAlt: "Chat",
      btnType: "normal",
      disabled: false,
    });

    // Emoji
    const canSendEmoji = isSelf
      ? this.actions?.canSendEmojiAllPlayers
      : this.actions?.interaction?.canSendEmoji;
    if (canSendEmoji) {
      const emojiId = "emoji";
      this.actionHandlers.set(emojiId, () => {
        this.emojiTable.showTable((emoji: string) => {
          if (isSelf) {
            this.eventBus.emit(
              new SendEmojiIntentEvent(
                AllPlayers,
                flattenedEmojiTable.indexOf(emoji as Emoji),
              ),
            );
          } else {
            this.eventBus.emit(
              new SendEmojiIntentEvent(
                other,
                flattenedEmojiTable.indexOf(emoji as Emoji),
              ),
            );
          }
          this.emojiTable.hideTable();
          this.hide();
        });
      });
      btns.push({
        id: emojiId,
        label: translateText("player_panel.emotes"),
        title: translateText("player_panel.emotes"),
        icon: emojiIcon,
        iconAlt: "Emoji",
        btnType: "normal",
        disabled: false,
      });
    }

    // Target
    const canTarget = this.actions?.interaction?.canTarget;
    if (canTarget) {
      const targetId = "target";
      this.actionHandlers.set(targetId, () => {
        this.eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
        this.hide();
      });
      btns.push({
        id: targetId,
        label: translateText("player_panel.target"),
        title: translateText("player_panel.target"),
        icon: targetIcon,
        iconAlt: "Target",
        btnType: "normal",
        disabled: false,
      });
    }

    // Donate troops
    const canDonateTroops = this.actions?.interaction?.canDonateTroops;
    if (canDonateTroops) {
      const donateId = "donate_troops";
      this.actionHandlers.set(donateId, () => {
        this.suppressNextHide = true;
        const myPlayer = this.g.myPlayer();
        if (myPlayer && this.dioxusSendResourceModal) {
          this.dioxusSendResourceModal.show("troops", myPlayer, other);
        }
      });
      btns.push({
        id: donateId,
        label: translateText("player_panel.troops"),
        title: translateText("player_panel.send_troops"),
        icon: donateTroopIcon,
        iconAlt: "Troops",
        btnType: "normal",
        disabled: false,
      });
    }

    // Donate gold
    const canDonateGold = this.actions?.interaction?.canDonateGold;
    if (canDonateGold) {
      const goldId = "donate_gold";
      this.actionHandlers.set(goldId, () => {
        this.suppressNextHide = true;
        const myPlayer = this.g.myPlayer();
        if (myPlayer && this.dioxusSendResourceModal) {
          this.dioxusSendResourceModal.show("gold", myPlayer, other);
        }
      });
      btns.push({
        id: goldId,
        label: translateText("player_panel.gold"),
        title: translateText("player_panel.send_gold"),
        icon: donateGoldIcon,
        iconAlt: "Gold",
        btnType: "normal",
        disabled: false,
      });
    }

    return btns;
  }

  private buildSecondaryActions(
    my: PlayerView,
    other: PlayerView,
    isSelf: boolean,
  ): ActionButtonJson[] {
    if (isSelf) return [];

    const btns: ActionButtonJson[] = [];

    // Embargo
    const canEmbargo = this.actions?.interaction?.canEmbargo;
    if (canEmbargo) {
      const embargoId = "embargo";
      this.actionHandlers.set(embargoId, () => {
        this.eventBus.emit(new SendEmbargoIntentEvent(other, "start"));
        this.hide();
      });
      btns.push({
        id: embargoId,
        label: translateText("player_panel.stop_trade"),
        title: translateText("player_panel.stop_trade"),
        icon: stopTradingIcon,
        iconAlt: "Stop Trading",
        btnType: "yellow",
        disabled: false,
      });
    } else {
      const stopEmbargoId = "stop_embargo";
      this.actionHandlers.set(stopEmbargoId, () => {
        this.eventBus.emit(new SendEmbargoIntentEvent(other, "stop"));
        this.hide();
      });
      btns.push({
        id: stopEmbargoId,
        label: translateText("player_panel.start_trade"),
        title: translateText("player_panel.start_trade"),
        icon: startTradingIcon,
        iconAlt: "Start Trading",
        btnType: "green",
        disabled: false,
      });
    }

    // Break alliance
    const canBreakAlliance = this.actions?.interaction?.canBreakAlliance;
    if (canBreakAlliance) {
      const breakId = "break_alliance";
      this.actionHandlers.set(breakId, () => {
        this.eventBus.emit(new SendBreakAllianceIntentEvent(my, other));
        this.hide();
      });
      btns.push({
        id: breakId,
        label: translateText("player_panel.break_alliance"),
        title: translateText("player_panel.break_alliance"),
        icon: breakAllianceIcon,
        iconAlt: "Break Alliance",
        btnType: "red",
        disabled: false,
      });
    }

    // Send alliance
    const canSendAllianceRequest =
      this.actions?.interaction?.canSendAllianceRequest;
    if (canSendAllianceRequest) {
      const allianceId = "send_alliance";
      this.actionHandlers.set(allianceId, () => {
        this.eventBus.emit(new SendAllianceRequestIntentEvent(my, other));
        this.hide();
      });
      btns.push({
        id: allianceId,
        label: translateText("player_panel.send_alliance"),
        title: translateText("player_panel.send_alliance"),
        icon: allianceIcon,
        iconAlt: "Alliance",
        btnType: "indigo",
        disabled: false,
      });
    }

    return btns;
  }

  private buildSelfTradeActions(my: PlayerView): ActionButtonJson[] {
    const btns: ActionButtonJson[] = [];
    const canEmbargoAll = this.actions?.canEmbargoAll ?? false;

    const stopAllId = "stop_trade_all";
    this.actionHandlers.set(stopAllId, () => {
      this.eventBus.emit(new SendEmbargoAllIntentEvent("start"));
    });
    btns.push({
      id: stopAllId,
      label: !canEmbargoAll
        ? `${translateText("player_panel.stop_trade_all")} \u23F3`
        : translateText("player_panel.stop_trade_all"),
      title: !canEmbargoAll
        ? `${translateText("player_panel.stop_trade_all")} - ${translateText("cooldown")}`
        : translateText("player_panel.stop_trade_all"),
      icon: stopTradingIcon,
      iconAlt: "Stop Trading With All",
      btnType: "yellow",
      disabled: !canEmbargoAll,
    });

    const startAllId = "start_trade_all";
    this.actionHandlers.set(startAllId, () => {
      this.eventBus.emit(new SendEmbargoAllIntentEvent("stop"));
    });
    btns.push({
      id: startAllId,
      label: !canEmbargoAll
        ? `${translateText("player_panel.start_trade_all")} \u23F3`
        : translateText("player_panel.start_trade_all"),
      title: !canEmbargoAll
        ? `${translateText("player_panel.start_trade_all")} - ${translateText("cooldown")}`
        : translateText("player_panel.start_trade_all"),
      icon: startTradingIcon,
      iconAlt: "Start Trading With All",
      btnType: "green",
      disabled: !canEmbargoAll,
    });

    return btns;
  }

  // --- Helper methods ---

  private identityChipProps(type: PlayerType) {
    switch (type) {
      case PlayerType.Nation:
        return {
          labelKey: "player_type.nation",
          aria: "Nation player",
          classes: "border-indigo-400/25 bg-indigo-500/10 text-indigo-200",
          icon: "\u{1F3DB}\u{FE0F}",
        };
      case PlayerType.Bot:
        return {
          labelKey: "player_type.bot",
          aria: "Bot",
          classes: "border-purple-400/25 bg-purple-500/10 text-purple-200",
          icon: "\u{1F916}",
        };
      case PlayerType.Human:
      default:
        return {
          labelKey: "player_type.player",
          aria: "Human player",
          classes: "border-zinc-400/20 bg-zinc-500/5 text-zinc-300",
          icon: "\u{1F464}",
        };
    }
  }

  private getRelationClass(relation: Relation): string {
    const base =
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 " +
      "shadow-[inset_0_0_8px_rgba(255,255,255,0.04)]";

    switch (relation) {
      case Relation.Hostile:
        return `${base} border-red-400/30 bg-red-500/10 text-red-200`;
      case Relation.Distrustful:
        return `${base} border-red-300/40 bg-red-300/10 text-red-300`;
      case Relation.Friendly:
        return `${base} border-emerald-400/30 bg-emerald-500/10 text-emerald-200`;
      case Relation.Neutral:
      default:
        return `${base} border-zinc-400/30 bg-zinc-500/10 text-zinc-200`;
    }
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Friendly:
        return translateText("relation.friendly");
      case Relation.Neutral:
      default:
        return translateText("relation.neutral");
    }
  }

  private getExpiryColorClass(seconds: number | null): string {
    if (seconds === null) return "text-white";
    if (seconds <= 30) return "text-red-400";
    if (seconds <= 60) return "text-yellow-400";
    return "text-emerald-400";
  }

  private getTraitorRemainingSeconds(player: PlayerView): number | null {
    const ticksLeft = player.data.traitorRemainingTicks ?? 0;
    if (!player.isTraitor() || ticksLeft <= 0) return null;
    return Math.ceil(ticksLeft / 10);
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-player-panel-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-player-panel": DioxusPlayerPanel;
  }
}

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

interface PlayerInfoStateJson {
  isVisible: boolean;
  isActive: boolean;
  showDetails: boolean;
  contentType: string;
  wildernessTitle: string;
  irradiatedTitle: string;
  playerName: string;
  playerFlag: string;
  playerFlagIsCustom: boolean;
  isFriendly: boolean;
  playerTypeLabel: string;
  relationClass: string;
  relationName: string;
  showRelation: boolean;
  showAlliance: boolean;
  allianceIcon: string;
  allianceTimeoutLabel: string;
  allianceExpiryText: string;
  playerIcons: { kind: string; text: string; src: string }[];
  troopsLabel: string;
  troops: string;
  showTroops: boolean;
  maxTroopsLabel: string;
  maxTroops: string;
  showMaxTroops: boolean;
  attackingTroopsLabel: string;
  attackingTroops: string;
  showAttackingTroops: boolean;
  greenPercent: number;
  orangePercent: number;
  goldLabel: string;
  gold: string;
  goldIcon: string;
  unitCounts: { icon: string; alt: string; count: string; isDisabled: boolean }[];
  teamLabel: string;
  teamName: string;
  showTeam: boolean;
  unitOwnerName: string;
  unitIsAlly: boolean;
  unitTypeName: string;
  unitHasHealth: boolean;
  unitHealthLabel: string;
  unitHealth: string;
}

@customElement("dioxus-player-info-overlay")
export class DioxusPlayerInfoOverlay extends LitElement implements Layer {
  public game!: GameView;
  public eventBus!: EventBus;
  public transform!: TransformHandler;

  private player: PlayerView | null = null;
  private playerProfile: PlayerProfile | null = null;
  private unit: UnitView | null = null;
  private isWilderness: boolean = false;
  private isIrradiatedWilderness: boolean = false;
  private _isInfoVisible: boolean = false;
  private _isActive = false;
  private lastMouseUpdate = 0;
  private showDetails = true;

  @state() private isLaunched = false;

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGamePlayerInfoOverlayLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [UI_RUNTIME_EVENTS.uiInGamePlayerInfoToggleDetails],
        () => {
          this.showDetails = !this.showDetails;
        },
      );
    } catch (err) {
      console.error("[DioxusPlayerInfoOverlay] Failed to launch:", err);
    }
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
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
    this._isInfoVisible = false;
    this.unit = null;
    this.player = null;
    this.isWilderness = false;
    this.isIrradiatedWilderness = false;
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
      this._isInfoVisible = true;
    } else if (owner && !owner.isPlayer() && this.game.isLand(tile)) {
      if (this.game.hasFallout(tile)) {
        this.isIrradiatedWilderness = true;
      } else {
        this.isWilderness = true;
      }
      this._isInfoVisible = true;
    } else if (!this.game.isLand(tile)) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        .filter(
          (u) => euclideanDistWorld(worldCoord, u.tile(), this.game) < 50,
        )
        .sort(distSortUnitWorld(worldCoord, this.game));

      if (units.length > 0) {
        this.unit = units[0];
        this._isInfoVisible = true;
      }
    }
  }

  tick() {
    if (!this.isLaunched || !this.game) return;
    this.sendState();
  }

  private getRelationClass(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return "text-red-500";
      case Relation.Distrustful:
        return "text-red-300";
      case Relation.Neutral:
        return "text-white";
      case Relation.Friendly:
        return "text-green-500";
      default:
        return "text-white";
    }
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

  private allianceExpirationText(alliance: AllianceView) {
    const { expiresAt } = alliance;
    const remainingTicks = expiresAt - this.game.ticks();
    let remainingSeconds = 0;
    if (remainingTicks > 0) {
      remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10));
    }
    return renderDuration(remainingSeconds);
  }

  private sendState() {
    const stateObj: PlayerInfoStateJson = {
      isVisible: this._isInfoVisible,
      isActive: this._isActive,
      showDetails: this.showDetails,
      contentType: "none",
      wildernessTitle: translateText("player_info_overlay.wilderness_title"),
      irradiatedTitle: translateText(
        "player_info_overlay.irradiated_wilderness_title",
      ),
      playerName: "",
      playerFlag: "",
      playerFlagIsCustom: false,
      isFriendly: false,
      playerTypeLabel: "",
      relationClass: "",
      relationName: "",
      showRelation: false,
      showAlliance: false,
      allianceIcon: allianceIconInfo,
      allianceTimeoutLabel: translateText(
        "player_info_overlay.alliance_timeout",
      ),
      allianceExpiryText: "",
      playerIcons: [],
      troopsLabel: translateText("player_info_overlay.troops"),
      troops: "",
      showTroops: false,
      maxTroopsLabel: translateText("player_info_overlay.maxtroops"),
      maxTroops: "",
      showMaxTroops: false,
      attackingTroopsLabel: translateText("player_info_overlay.a_troops"),
      attackingTroops: "",
      showAttackingTroops: false,
      greenPercent: 0,
      orangePercent: 0,
      goldLabel: translateText("player_info_overlay.gold"),
      gold: "",
      goldIcon: goldCoinIcon,
      unitCounts: [],
      teamLabel: translateText("player_info_overlay.team"),
      teamName: "",
      showTeam: false,
      unitOwnerName: "",
      unitIsAlly: false,
      unitTypeName: "",
      unitHasHealth: false,
      unitHealthLabel: translateText("player_info_overlay.health"),
      unitHealth: "",
    };

    if (this.isWilderness) {
      stateObj.contentType = "wilderness";
    } else if (this.isIrradiatedWilderness) {
      stateObj.contentType = "irradiated_wilderness";
    } else if (this.player !== null) {
      stateObj.contentType = "player";
      this.buildPlayerState(stateObj, this.player);
    } else if (this.unit !== null) {
      stateObj.contentType = "unit";
      this.buildUnitState(stateObj, this.unit);
    }

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePlayerInfoOverlay,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: { state: stateObj },
      })
    ) {
      console.warn(
        "[DioxusPlayerInfoOverlay] Failed to dispatch runtime snapshot",
      );
    }
  }

  private buildPlayerState(s: PlayerInfoStateJson, player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player) ?? false;
    const isAllied = myPlayer?.isAlliedWith(player) ?? false;

    s.playerName = player.name();
    s.isFriendly = isFriendly;

    // Flag
    if (player.cosmetics.flag) {
      s.playerFlag = player.cosmetics.flag;
      s.playerFlagIsCustom = player.cosmetics.flag.startsWith("!");
    }

    // Player type
    switch (player.type()) {
      case PlayerType.Bot:
        s.playerTypeLabel = translateText("player_type.bot");
        break;
      case PlayerType.Nation:
        s.playerTypeLabel = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        s.playerTypeLabel = translateText("player_type.player");
        break;
    }

    // Relation
    if (
      player.type() === PlayerType.Nation &&
      myPlayer !== null &&
      !isAllied
    ) {
      const relation =
        this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
      s.relationClass = this.getRelationClass(relation);
      s.relationName = this.getRelationName(relation);
      s.showRelation = true;
    }

    // Alliance
    if (isAllied && myPlayer) {
      const alliance = myPlayer
        .alliances()
        .find((a) => a.other === player.id());
      if (alliance !== undefined) {
        s.showAlliance = true;
        s.allianceExpiryText = this.allianceExpirationText(alliance);
      }
    }

    // Player icons
    const firstPlace = getFirstPlacePlayer(this.game);
    const icons = getPlayerIcons({
      game: this.game,
      player,
      includeAllianceIcon: false,
      firstPlace,
    });
    s.playerIcons = icons.map((icon) => ({
      kind: icon.kind,
      text: icon.text ?? "",
      src: icon.src ?? "",
    }));

    // Team
    if (player.team() !== null) {
      s.showTeam = true;
      s.teamName = String(player.team());
    }

    // Troops
    const totalTroops = player.troops();
    const maxTroops = this.game.config().maxTroops(player);
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    if (totalTroops >= 1) {
      s.showTroops = true;
      s.troops = renderTroops(totalTroops);
    }
    if (maxTroops >= 1) {
      s.showMaxTroops = true;
      s.maxTroops = renderTroops(maxTroops);
    }
    if (attackingTroops >= 1) {
      s.showAttackingTroops = true;
      s.attackingTroops = renderTroops(attackingTroops);
    }

    // Troop bar
    const base = Math.max(maxTroops, 1);
    const greenPercentRaw = (totalTroops / base) * 100;
    const orangePercentRaw = (attackingTroops / base) * 100;
    s.greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    s.orangePercent = Math.max(
      0,
      Math.min(100 - s.greenPercent, orangePercentRaw),
    );

    // Gold
    s.gold = renderNumber(player.gold());

    // Unit counts
    const unitDefs: {
      type: UnitType;
      icon: string;
      desc: string;
    }[] = [
      {
        type: UnitType.City,
        icon: cityIcon,
        desc: "player_info_overlay.cities",
      },
      {
        type: UnitType.Factory,
        icon: factoryIcon,
        desc: "player_info_overlay.factories",
      },
      {
        type: UnitType.Port,
        icon: portIcon,
        desc: "player_info_overlay.ports",
      },
      {
        type: UnitType.MissileSilo,
        icon: missileSiloIcon,
        desc: "player_info_overlay.missile_launchers",
      },
      {
        type: UnitType.SAMLauncher,
        icon: samLauncherIcon,
        desc: "player_info_overlay.sams",
      },
      {
        type: UnitType.Warship,
        icon: warshipIcon,
        desc: "player_info_overlay.warships",
      },
    ];

    s.unitCounts = unitDefs.map((ud) => ({
      icon: ud.icon,
      alt: translateText(ud.desc),
      count: String(player.totalUnitLevels(ud.type)),
      isDisabled: this.game.config().isUnitDisabled(ud.type),
    }));
  }

  private buildUnitState(s: PlayerInfoStateJson, unit: UnitView) {
    const isAlly =
      (unit.owner() === this.game.myPlayer() ||
        this.game.myPlayer()?.isFriendly(unit.owner())) ??
      false;

    s.unitOwnerName = unit.owner().name();
    s.unitIsAlly = isAlly;
    s.unitTypeName = String(unit.type());
    s.unitHasHealth = unit.hasHealth();
    if (unit.hasHealth()) {
      s.unitHealth = String(unit.health());
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-player-info-overlay-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-player-info-overlay": DioxusPlayerInfoOverlay;
  }
}

/** Settings state passed to Dioxus */
export interface DioxusSettingsState {
  // Volumes (0-1)
  backgroundMusicVolume: number;
  soundEffectsVolume: number;
  // Boolean toggles
  alternateView: boolean;
  emojis: boolean;
  darkMode: boolean;
  fxLayer: boolean;
  alertFrame: boolean;
  structureSprites: boolean;
  cursorCostLabel: boolean;
  anonymousNames: boolean;
  leftClickOpensMenu: boolean;
  performanceOverlay: boolean;
}

/** Translations passed to Dioxus */
export interface DioxusSettingsTranslations {
  title: string;
  backgroundMusicVolume: string;
  soundEffectsVolume: string;
  toggleTerrain: string;
  toggleTerrainDesc: string;
  emojis: string;
  emojisDesc: string;
  darkMode: string;
  darkModeDesc: string;
  specialEffects: string;
  specialEffectsDesc: string;
  alertFrame: string;
  alertFrameDesc: string;
  structureSprites: string;
  structureSpritesDesc: string;
  cursorCostLabel: string;
  cursorCostLabelDesc: string;
  anonymousNames: string;
  anonymousNamesDesc: string;
  leftClickMenu: string;
  leftClickMenuDesc: string;
  performanceOverlay: string;
  performanceOverlayDesc: string;
  exitGame: string;
  exitGameDesc: string;
  on: string;
  off: string;
}

/** Icons passed to Dioxus */
export interface DioxusSettingsIcons {
  settings: string;
  music: string;
  tree: string;
  emoji: string;
  darkMode: string;
  explosion: string;
  siren: string;
  structure: string;
  cursorPrice: string;
  ninja: string;
  mouse: string;
  exit: string;
}

/** Event detail from Dioxus when a setting changes */
export interface DioxusSettingChangeEvent {
  setting: string;
  value: number | boolean;
}

const SETTINGS_MODAL_ID = "settings";

@customElement("dioxus-settings-modal")
export class DioxusSettingsModal extends LitElement implements Layer {
  public eventBus: EventBus;
  public userSettings: UserSettings;

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private shouldPause: boolean = false;
  private wasPausedWhenOpened: boolean = false;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  init() {
    if (!this.userSettings || !this.eventBus) {
      console.error("[DioxusSettingsModal] userSettings or eventBus not set");
      return;
    }

    // Initialize sound volumes from user settings
    SoundManager.setBackgroundMusicVolume(
      this.userSettings.backgroundMusicVolume(),
    );
    SoundManager.setSoundEffectsVolume(this.userSettings.soundEffectsVolume());

    // Listen for show/hide events
    this.eventBus.on(ShowSettingsModalEvent, (event) => {
      if (event.isVisible) {
        this.shouldPause = event.shouldPause;
        this.wasPausedWhenOpened = event.isPaused;
        this.openModal();
      } else {
        this.closeModal();
      }
    });
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiInGameSettingsModalSettingChange,
        UI_RUNTIME_EVENTS.uiInGameSettingsModalCloseRequest,
      ],
      (event) => {
        const payload = parseUiRuntimePayload(event.payload);
        if (event.type === UI_RUNTIME_EVENTS.uiInGameSettingsModalSettingChange) {
          const setting = payload.setting;
          if (typeof setting !== "string") {
            return;
          }
          this.applySetting(setting, payload.value as number | boolean);
          return;
        }
        if (event.type === UI_RUNTIME_EVENTS.uiInGameSettingsModalCloseRequest) {
          const dispatched = requestUiModalClose(SETTINGS_MODAL_ID, "component");
          if (!dispatched) {
            this.closeModal();
          }
        }
      },
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(SETTINGS_MODAL_ID, false);
    }
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== SETTINGS_MODAL_ID) {
      return;
    }
    this.closeModal();
  };

  private applySetting(setting: string, value: number | boolean) {
    switch (setting) {
      case "backgroundMusicVolume":
        this.userSettings.setBackgroundMusicVolume(value as number);
        SoundManager.setBackgroundMusicVolume(value as number);
        break;
      case "soundEffectsVolume":
        this.userSettings.setSoundEffectsVolume(value as number);
        SoundManager.setSoundEffectsVolume(value as number);
        break;
      case "alternateView":
        this.alternateView = value as boolean;
        this.eventBus.emit(new AlternateViewEvent(this.alternateView));
        break;
      case "emojis":
        this.userSettings.toggleEmojis();
        break;
      case "darkMode":
        this.userSettings.toggleDarkMode();
        this.eventBus.emit(new RefreshGraphicsEvent());
        break;
      case "fxLayer":
        this.userSettings.toggleFxLayer();
        break;
      case "alertFrame":
        this.userSettings.toggleAlertFrame();
        break;
      case "structureSprites":
        this.userSettings.toggleStructureSprites();
        break;
      case "cursorCostLabel":
        this.userSettings.toggleCursorCostLabel();
        break;
      case "anonymousNames":
        this.userSettings.toggleRandomName();
        break;
      case "leftClickOpensMenu":
        this.userSettings.toggleLeftClickOpenMenu();
        break;
      case "performanceOverlay":
        this.userSettings.togglePerformanceOverlay();
        break;
      case "exitGame":
        window.location.href = "/";
        break;
    }
    this.requestUpdate();
  }

  private async openModal() {
    await ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState(SETTINGS_MODAL_ID, true);
    this.pauseGame(true);
    this.requestUpdate();

    // Wait for next render then launch Dioxus
    await this.updateComplete;
    await this.launchDioxusComponent();
  }

  private closeModal() {
    reportUiModalState(SETTINGS_MODAL_ID, false);
    this.isVisible = false;
    this.pauseGame(false);
    this.requestUpdate();
  }

  private pauseGame(pause: boolean) {
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  private getSettingsState(): DioxusSettingsState {
    return {
      backgroundMusicVolume: this.userSettings.backgroundMusicVolume(),
      soundEffectsVolume: this.userSettings.soundEffectsVolume(),
      alternateView: this.alternateView,
      emojis: this.userSettings.emojis(),
      darkMode: this.userSettings.darkMode(),
      fxLayer: this.userSettings.fxLayer(),
      alertFrame: this.userSettings.alertFrame(),
      structureSprites: this.userSettings.structureSprites(),
      cursorCostLabel: this.userSettings.cursorCostLabel(),
      anonymousNames: this.userSettings.anonymousNames(),
      leftClickOpensMenu: this.userSettings.leftClickOpensMenu(),
      performanceOverlay: this.userSettings.performanceOverlay(),
    };
  }

  private getTranslations(): DioxusSettingsTranslations {
    return {
      title: translateText("user_setting.tab_basic"),
      backgroundMusicVolume: translateText(
        "user_setting.background_music_volume",
      ),
      soundEffectsVolume: translateText("user_setting.sound_effects_volume"),
      toggleTerrain: translateText("user_setting.toggle_terrain"),
      toggleTerrainDesc: translateText("user_setting.toggle_view_desc"),
      emojis: translateText("user_setting.emojis_label"),
      emojisDesc: translateText("user_setting.emojis_desc"),
      darkMode: translateText("user_setting.dark_mode_label"),
      darkModeDesc: translateText("user_setting.dark_mode_desc"),
      specialEffects: translateText("user_setting.special_effects_label"),
      specialEffectsDesc: translateText("user_setting.special_effects_desc"),
      alertFrame: translateText("user_setting.alert_frame_label"),
      alertFrameDesc: translateText("user_setting.alert_frame_desc"),
      structureSprites: translateText("user_setting.structure_sprites_label"),
      structureSpritesDesc: translateText("user_setting.structure_sprites_desc"),
      cursorCostLabel: translateText("user_setting.cursor_cost_label_label"),
      cursorCostLabelDesc: translateText("user_setting.cursor_cost_label_desc"),
      anonymousNames: translateText("user_setting.anonymous_names_label"),
      anonymousNamesDesc: translateText("user_setting.anonymous_names_desc"),
      leftClickMenu: translateText("user_setting.left_click_menu"),
      leftClickMenuDesc: translateText("user_setting.left_click_desc"),
      performanceOverlay: translateText("user_setting.performance_overlay_label"),
      performanceOverlayDesc: translateText(
        "user_setting.performance_overlay_desc",
      ),
      exitGame: translateText("user_setting.exit_game_label"),
      exitGameDesc: translateText("user_setting.exit_game_info"),
      on: translateText("user_setting.on"),
      off: translateText("user_setting.off"),
    };
  }

  private getIcons(): DioxusSettingsIcons {
    return {
      settings: settingsIcon,
      music: musicIcon,
      tree: treeIcon,
      emoji: emojiIcon,
      darkMode: darkModeIcon,
      explosion: explosionIcon,
      siren: sirenIcon,
      structure: structureIcon,
      cursorPrice: cursorPriceIcon,
      ninja: ninjaIcon,
      mouse: mouseIcon,
      exit: exitIcon,
    };
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      // Load WASM module via centralized loader
      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for the mount point to be rendered
      await this.updateComplete;

      // Launch the full settings modal
      const settings = this.getSettingsState();
      const translations = this.getTranslations();
      const icons = this.getIcons();

      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameFullSettingsModalLaunch,
        {
          settings,
          translations,
          icons,
        },
      );
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusSettingsModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private handleBackdropClick = (event: MouseEvent) => {
    // Only close if clicking on the backdrop itself, not its children
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  };

  render() {
    if (!this.isVisible) {
      return null;
    }

    if (this.loading) {
      return html`
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center"
        >
          <div class="text-white">Loading settings...</div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center"
        >
          <div class="bg-slate-800 p-4 rounded-lg">
            <div class="text-red-400">Error: ${this.error}</div>
            <button
              class="mt-4 px-4 py-2 bg-slate-700 text-white rounded"
              @click=${this.closeModal}
            >
              Close
            </button>
          </div>
        </div>
      `;
    }

    // Render the backdrop and mount point for Dioxus
    return html`
      <div
        class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4"
        @click=${this.handleBackdropClick}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div id="dioxus-settings-modal-root"></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-settings-modal": DioxusSettingsModal;
  }
}

export { DioxusPerformanceOverlay } from "./PerformanceOverlayBridge";


interface ChatEntry {
  description: string;
  isHtml: boolean;
}

interface ChatDisplayStateJson {
  isVisible: boolean;
  isHidden: boolean;
  newEvents: number;
  entries: ChatEntry[];
}

@customElement("dioxus-chat-display")
export class DioxusChatDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;

  private active: boolean = false;
  private _hidden: boolean = false;
  private newEvents: number = 0;
  private chatEvents: {
    description: string;
    unsafeDescription?: boolean;
    createdAt: number;
  }[] = [];

  @state() private isLaunched = false;

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameChatDisplayLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [UI_RUNTIME_EVENTS.uiInGameChatDisplayToggle],
        () => {
          this._hidden = !this._hidden;
          if (this._hidden) {
            this.newEvents = 0;
          }
        },
      );
    } catch (err) {
      console.error("[DioxusChatDisplay] Failed to launch:", err);
    }
  }

  init() {}

  tick() {
    if (!this.isLaunched || !this.game) return;

    // this.active = true;
    const updates = this.game.updatesSinceLastTick();
    if (updates !== null) {
      const messages = updates[GameUpdateType.DisplayEvent] as
        | DisplayMessageUpdate[]
        | undefined;

      if (messages) {
        for (const msg of messages) {
          if (msg.messageType === MessageType.CHAT) {
            const myPlayer = this.game.myPlayer();
            if (
              msg.playerID !== null &&
              (!myPlayer || myPlayer.smallID() !== msg.playerID)
            ) {
              continue;
            }

            this.chatEvents.push({
              description: msg.message,
              unsafeDescription: true,
              createdAt: this.game.ticks(),
            });

            if (this._hidden) {
              this.newEvents++;
            }
          }
        }
      }
    }

    if (this.chatEvents.length > 100) {
      this.chatEvents = this.chatEvents.slice(-100);
    }

    this.sendState();
  }

  private sendState() {
    const entries: ChatEntry[] = this.chatEvents.map((chat) => ({
      description: chat.unsafeDescription
        ? onlyImages(chat.description)
        : chat.description,
      isHtml: chat.unsafeDescription ?? false,
    }));

    const state: ChatDisplayStateJson = {
      isVisible: this.active,
      isHidden: this._hidden,
      newEvents: this.newEvents,
      entries,
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameChatDisplay,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: { state },
      })
    ) {
      console.warn("[DioxusChatDisplay] Failed to dispatch runtime snapshot");
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-chat-display-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-chat-display": DioxusChatDisplay;
  }
}

@customElement("dioxus-control-panel")
export class DioxusControlPanel extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public clientID: ClientID;

  @state() private isLaunched = false;

  private attackRatio: number = 0.2;
  private _isVisible = false;
  private _troopRateIsIncreasing: boolean = true;
  private _lastTroopIncreaseRate: number = 0;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameControlPanelLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusControlPanel] Failed to launch:", err);
    }
  }

  private async loadAttackRatioFromSessionStorage() {
    const storedAttackRatio = await readUiSessionStorage(
      SETTINGS_ATTACK_RATIO_STORAGE_KEY,
    );
    if (typeof storedAttackRatio !== "string") {
      return;
    }

    const parsedAttackRatio = Number(storedAttackRatio);
    if (
      Number.isFinite(parsedAttackRatio) &&
      parsedAttackRatio >= 0.01 &&
      parsedAttackRatio <= 1
    ) {
      this.attackRatio = parsedAttackRatio;
      this.uiState.attackRatio = parsedAttackRatio;
    }
  }

  init() {
    this.attackRatio =
      typeof this.uiState.attackRatio === "number" &&
      Number.isFinite(this.uiState.attackRatio) &&
      this.uiState.attackRatio > 0
        ? this.uiState.attackRatio
        : 0.2;
    this.uiState.attackRatio = this.attackRatio;
    void this.loadAttackRatioFromSessionStorage();

    // Handle keyboard-driven attack ratio changes
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio =
        (Math.round(this.attackRatio * 100) + event.attackRatio) / 100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.uiState.attackRatio = newAttackRatio;
    });

    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [UI_RUNTIME_EVENTS.uiInGameControlPanelRatioChange],
      (event) => {
        const payload = parseUiRuntimePayload(event.payload);
        const ratio = payload.ratio;
        if (typeof ratio === "number") {
          this.attackRatio = ratio / 100;
          this.uiState.attackRatio = this.attackRatio;
        }
      },
    );
  }

  tick() {
    if (!this.isLaunched || !this.game) return;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this._isVisible = false;
      this.sendState();
      return;
    }

    if (this.game.ticks() % 5 === 0) {
      this.updateTroopIncrease();
    }

    this.sendState();
  }

  private updateTroopIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const troopIncreaseRate = this.game.config().troopIncreaseRate(player);
    this._troopRateIsIncreasing =
      troopIncreaseRate >= this._lastTroopIncreaseRate;
    this._lastTroopIncreaseRate = troopIncreaseRate;
  }

  private sendState() {
    const player = this.game?.myPlayer();

    const troops = player ? player.troops() : 0;
    const maxTroops = player ? this.game.config().maxTroops(player) : 0;
    const troopRate = player
      ? this.game.config().troopIncreaseRate(player) * 10
      : 0;
    const gold: Gold = player ? player.gold() : 0n;

    const state = {
      isVisible: this._isVisible,
      troops: renderTroops(troops),
      maxTroops: renderTroops(maxTroops),
      troopRate: renderTroops(troopRate),
      troopRateIncreasing: this._troopRateIsIncreasing,
      gold: renderNumber(gold),
      attackRatio: this.attackRatio,
      attackTroops: renderTroops(troops * this.attackRatio),
      troopsLabel: translateText("control_panel.troops"),
      goldLabel: translateText("control_panel.gold"),
      attackRatioLabel: translateText("control_panel.attack_ratio"),
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameControlPanel,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: { state },
      })
    ) {
      console.warn("[DioxusControlPanel] Failed to dispatch runtime snapshot");
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-control-panel-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-control-panel": DioxusControlPanel;
  }
}

@customElement("dioxus-emoji-table")
export class DioxusEmojiTable extends LitElement {
  public isVisible: boolean = false;
  public transformHandler: TransformHandler;
  public game: GameView;

  @state() private isLaunched = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  private emojiCallback: ((emoji: string) => void) | null = null;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameEmojiTableLaunch,
        {
          emojis: flattenedEmojiTable,
        },
      );
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameEmojiTableSelect,
          UI_RUNTIME_EVENTS.uiInGameEmojiTableClose,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGameEmojiTableClose) {
            this.hideTable();
            return;
          }
          const payload = parseUiRuntimePayload(event.payload);
          const index = payload.index;
          if (
            typeof index === "number" &&
            index >= 0 &&
            index < flattenedEmojiTable.length &&
            this.emojiCallback
          ) {
            this.emojiCallback(flattenedEmojiTable[index]);
            this.hideTable();
          }
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusEmojiTable] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  initEventBus(eventBus: EventBus) {
    eventBus.on(ShowEmojiMenuEvent, (e) => {
      const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
      if (!this.game.isValidCoord(cell.x, cell.y)) {
        return;
      }

      const tile = this.game.ref(cell.x, cell.y);
      if (!this.game.hasOwner(tile)) {
        return;
      }

      const targetPlayer = this.game.owner(tile);
      if (targetPlayer instanceof TerraNulliusImpl) {
        return;
      }

      this.showTable((emoji: string) => {
        const recipient =
          targetPlayer === this.game.myPlayer()
            ? AllPlayers
            : (targetPlayer as PlayerView);
        eventBus.emit(
          new SendEmojiIntentEvent(
            recipient,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      });
    });

    eventBus.on(CloseViewEvent, () => {
      this.hideTable();
    });
  }

  showTable(callback: (emoji: string) => void) {
    this.emojiCallback = callback;
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameEmojiTableShow);
    }
    this.isVisible = true;
  }

  hideTable() {
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameEmojiTableHide);
    }
    this.isVisible = false;
  }

  render() {
    if (this.loading) return html``;
    if (this.error) {
      return html`<div class="text-red-400 text-xs">
        Error: ${this.error}
      </div>`;
    }
    return html`
      <div
        id="dioxus-emoji-table-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-emoji-table": DioxusEmojiTable;
  }
}

interface UnitItemState {
  iconUrl: string;
  count: string | null;
  unitType: string;
  structureKey: string;
  hotkey: string;
  canBuild: boolean;
  isSelected: boolean;
  cost: string;
  name: string;
  description: string;
  group: number;
}

interface UnitDisplayStateJson {
  isVisible: boolean;
  items: UnitItemState[];
}

// Unit definitions for building the state
interface UnitDef {
  unitType: UnitType;
  structureKey: string;
  keybindKey: string;
  defaultHotkey: string;
  icon: string;
  hasCount: boolean;
  group: number;
}

const UNIT_DEFS: UnitDef[] = [
  {
    unitType: UnitType.City,
    structureKey: "city",
    keybindKey: "buildCity",
    defaultHotkey: "1",
    icon: cityIcon,
    hasCount: true,
    group: 0,
  },
  {
    unitType: UnitType.Factory,
    structureKey: "factory",
    keybindKey: "buildFactory",
    defaultHotkey: "2",
    icon: factoryIcon,
    hasCount: true,
    group: 0,
  },
  {
    unitType: UnitType.Port,
    structureKey: "port",
    keybindKey: "buildPort",
    defaultHotkey: "3",
    icon: portIcon,
    hasCount: true,
    group: 0,
  },
  {
    unitType: UnitType.DefensePost,
    structureKey: "defense_post",
    keybindKey: "buildDefensePost",
    defaultHotkey: "4",
    icon: defensePostIcon,
    hasCount: true,
    group: 0,
  },
  {
    unitType: UnitType.MissileSilo,
    structureKey: "missile_silo",
    keybindKey: "buildMissileSilo",
    defaultHotkey: "5",
    icon: missileSiloIcon,
    hasCount: true,
    group: 0,
  },
  {
    unitType: UnitType.SAMLauncher,
    structureKey: "sam_launcher",
    keybindKey: "buildSamLauncher",
    defaultHotkey: "6",
    icon: samLauncherIcon,
    hasCount: true,
    group: 0,
  },
  {
    unitType: UnitType.Warship,
    structureKey: "warship",
    keybindKey: "buildWarship",
    defaultHotkey: "7",
    icon: warshipIcon,
    hasCount: true,
    group: 1,
  },
  {
    unitType: UnitType.AtomBomb,
    structureKey: "atom_bomb",
    keybindKey: "buildAtomBomb",
    defaultHotkey: "8",
    icon: atomBombIcon,
    hasCount: false,
    group: 1,
  },
  {
    unitType: UnitType.HydrogenBomb,
    structureKey: "hydrogen_bomb",
    keybindKey: "buildHydrogenBomb",
    defaultHotkey: "9",
    icon: hydrogenBombIcon,
    hasCount: false,
    group: 1,
  },
  {
    unitType: UnitType.MIRV,
    structureKey: "mirv",
    keybindKey: "buildMIRV",
    defaultHotkey: "0",
    icon: mirvIcon,
    hasCount: false,
    group: 1,
  },
];

@customElement("dioxus-unit-display")
export class DioxusUnitDisplay extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  private playerActions: PlayerActions | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private allDisabled = false;

  // Unit counts
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;

  @state() private isLaunched = false;

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameUnitDisplayLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameUnitDisplayClick,
          UI_RUNTIME_EVENTS.uiInGameUnitDisplayHover,
          UI_RUNTIME_EVENTS.uiInGameUnitDisplayUnhover,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGameUnitDisplayUnhover) {
            this.eventBus?.emit(new ToggleStructureEvent(null));
            return;
          }

          const payload = parseUiRuntimePayload(event.payload);
          const unitTypeStr = payload.unitType;
          if (typeof unitTypeStr !== "string" || unitTypeStr.length === 0) {
            return;
          }

          const unitType = this.resolveUnitType(unitTypeStr);
          if (unitType === null) {
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameUnitDisplayClick) {
            const selected = this.uiState.ghostStructure === unitType;
            if (selected) {
              this.uiState.ghostStructure = null;
              this.eventBus?.emit(new GhostStructureChangedEvent(null));
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
              this.eventBus?.emit(new GhostStructureChangedEvent(unitType));
            }
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameUnitDisplayHover) {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }
        },
      );
    } catch (err) {
      console.error("[DioxusUnitDisplay] Failed to launch:", err);
    }
  }

  private resolveUnitType(unitTypeStr: string): UnitType | null {
    for (const def of UNIT_DEFS) {
      if (def.unitType.toString() === unitTypeStr) {
        return def.unitType;
      }
    }
    return null;
  }

  private async loadKeybindsFromSessionStorage() {
    const keybindsStorage = await readUiSessionStorage(
      SETTINGS_KEYBINDS_STORAGE_KEY,
    );
    if (typeof keybindsStorage !== "string" || keybindsStorage.length === 0) {
      return;
    }

    try {
      this.keybinds = JSON.parse(keybindsStorage);
    } catch (e) {
      console.warn("Invalid keybinds JSON:", e);
    }
  }

  init() {
    const config = this.game.config();
    void this.loadKeybindsFromSessionStorage();

    this.allDisabled =
      config.isUnitDisabled(UnitType.City) &&
      config.isUnitDisabled(UnitType.Factory) &&
      config.isUnitDisabled(UnitType.Port) &&
      config.isUnitDisabled(UnitType.DefensePost) &&
      config.isUnitDisabled(UnitType.MissileSilo) &&
      config.isUnitDisabled(UnitType.SAMLauncher) &&
      config.isUnitDisabled(UnitType.Warship) &&
      config.isUnitDisabled(UnitType.AtomBomb) &&
      config.isUnitDisabled(UnitType.HydrogenBomb) &&
      config.isUnitDisabled(UnitType.MIRV);
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerActions?.buildableUnits ?? []) {
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

  private getCount(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.City:
        return this._cities;
      case UnitType.Factory:
        return this._factories;
      case UnitType.Port:
        return this._port;
      case UnitType.DefensePost:
        return this._defensePost;
      case UnitType.MissileSilo:
        return this._missileSilo;
      case UnitType.SAMLauncher:
        return this._samLauncher;
      case UnitType.Warship:
        return this._warships;
      default:
        return 0;
    }
  }

  tick() {
    if (!this.isLaunched || !this.game) return;

    const player = this.game.myPlayer();
    player?.actions().then((actions) => {
      this.playerActions = actions;
    });
    if (!player) return;

    // Update unit counts
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);

    // Determine visibility
    const isVisible =
      !this.allDisabled &&
      !!player &&
      !this.game.inSpawnPhase() &&
      player.isAlive();

    // Build items
    const items: UnitItemState[] = [];
    for (const def of UNIT_DEFS) {
      if (this.game.config().isUnitDisabled(def.unitType)) continue;

      const rawHotkey =
        this.keybinds[def.keybindKey]?.key ?? def.defaultHotkey;
      const displayHotkey = rawHotkey
        .replace("Digit", "")
        .replace("Key", "")
        .toUpperCase();

      items.push({
        iconUrl: def.icon,
        count: def.hasCount
          ? renderNumber(this.getCount(def.unitType))
          : null,
        unitType: def.unitType.toString(),
        structureKey: def.structureKey,
        hotkey: displayHotkey,
        canBuild: this.canBuild(def.unitType),
        isSelected: this.uiState.ghostStructure === def.unitType,
        cost: renderNumber(this.cost(def.unitType)),
        name: translateText("unit_type." + def.structureKey),
        description: translateText("build_menu.desc." + def.structureKey),
        group: def.group,
      });
    }

    const state: UnitDisplayStateJson = {
      isVisible,
      items,
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameUnitDisplay,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: { state },
      })
    ) {
      console.warn("[DioxusUnitDisplay] Failed to dispatch runtime snapshot");
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-unit-display-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-unit-display": DioxusUnitDisplay;
  }
}

export {
  DioxusAlertFrame,
  DioxusHeadsUpMessage,
  DioxusImmunityTimer,
  DioxusSpawnTimer,
} from "./HudLayersBridge";
export {
  DioxusGameLeftSidebar,
  DioxusLeaderboard,
  DioxusTeamStats,
  type LeaderboardEntry,
  type LeaderboardRowClickEvent,
  type LeaderboardSortEvent,
  type LeaderboardTranslations,
  type TeamStatsEntry,
  type TeamStatsTranslations,
} from "./LeaderboardSidebarBridge";
export {
  DioxusGameRightSidebar,
  DioxusReplayPanel,
  ShowReplayPanelEvent,
} from "./ReplayAndRightSidebarBridge";
