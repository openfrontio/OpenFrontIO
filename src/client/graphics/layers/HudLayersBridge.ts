import { GameMode, GameType, Team } from "../../../core/game/Game";
import {
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  initDioxusRuntime,
} from "../../UiRuntimeBridge";
import { translateText } from "../../Utils";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_SNAPSHOTS,
} from "../../runtime/UiRuntimeProtocol";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  if (!dispatchUiAction({ type: actionType, payload })) {
    console.warn(
      "[HudLayersBridge] Failed to dispatch runtime action:",
      actionType,
    );
  }
}

const RETALIATION_WINDOW_TICKS = 15 * 10;
const ALERT_COOLDOWN_TICKS = 15 * 10;

interface BarSegment {
  ratio: number;
  color: string;
}

@customElement("dioxus-spawn-timer")
export class DioxusSpawnTimer extends LitElement implements Layer {
  public game: GameView;
  public transformHandler: TransformHandler;

  @state() private isLaunched = false;
  private lastDispatchedTick = -1;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiHudSpawnTimerLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusSpawnTimer] Failed to launch:", err);
    }
  }

  init() {
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiHudSpawnTimerShow);
    }
  }

  tick() {
    if (!this.isLaunched || !this.game) return;
    const currentTick = this.game.ticks();
    if (this.lastDispatchedTick === currentTick) {
      return;
    }
    this.lastDispatchedTick = currentTick;

    const segments: BarSegment[] = [];

    if (this.game.inSpawnPhase()) {
      segments.push({
        ratio: this.game.ticks() / this.game.config().numSpawnPhaseTurns(),
        color: "rgba(0, 128, 255, 0.7)",
      });
    } else if (this.game.config().gameConfig().gameMode === GameMode.Team) {
      const teamTiles = new Map<Team, number>();
      for (const player of this.game.players()) {
        const team = player.team();
        if (team === null) throw new Error("Team is null");
        const tiles = teamTiles.get(team) ?? 0;
        teamTiles.set(team, tiles + player.numTilesOwned());
      }

      const theme = this.game.config().theme();
      let total = 0;
      for (const count of teamTiles.values()) total += count;

      if (total > 0) {
        for (const [team, count] of teamTiles) {
          segments.push({
            ratio: count / total,
            color: theme.teamColor(team).toRgbString(),
          });
        }
      }
    }

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotHudSpawnTimer,
        scope: "hud",
        tick: currentTick,
        payload: {
          visible: segments.length > 0,
          segments,
        },
      })
    ) {
      console.warn("[DioxusSpawnTimer] Failed to dispatch runtime snapshot");
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-spawn-timer-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-immunity-timer")
export class DioxusImmunityTimer extends LitElement implements Layer {
  public game: GameView;

  @state() private isLaunched = false;
  private isActive = false;
  private lastDispatchedTick = -1;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiHudImmunityTimerLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusImmunityTimer] Failed to launch:", err);
    }
  }

  init() {}

  tick() {
    if (!this.isLaunched || !this.game) return;
    const currentTick = this.game.ticks();
    if (this.lastDispatchedTick === currentTick) {
      return;
    }
    this.lastDispatchedTick = currentTick;

    const showTeamOwnershipBar =
      this.game.config().gameConfig().gameMode === GameMode.Team &&
      !this.game.inSpawnPhase();

    const topOffset = showTeamOwnershipBar ? "7px" : "0px";

    const immunityDuration = this.game.config().spawnImmunityDuration();
    const spawnPhaseTurns = this.game.config().numSpawnPhaseTurns();
    let nextActive = false;
    let progressRatio = 0;

    if (immunityDuration <= 5 * 10 || this.game.inSpawnPhase()) {
      nextActive = false;
    } else {
      const immunityEnd = spawnPhaseTurns + immunityDuration;
      if (currentTick >= immunityEnd || currentTick < spawnPhaseTurns) {
        nextActive = false;
      } else {
        const elapsedTicks = Math.max(0, currentTick - spawnPhaseTurns);
        progressRatio = Math.min(
          1,
          Math.max(0, elapsedTicks / immunityDuration),
        );
        nextActive = true;
      }
    }

    this.isActive = nextActive;
    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotHudImmunityTimer,
        scope: "hud",
        tick: currentTick,
        payload: {
          active: nextActive,
          progressRatio,
          topOffset,
        },
      })
    ) {
      console.warn("[DioxusImmunityTimer] Failed to dispatch runtime snapshot");
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-immunity-timer-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-heads-up-message")
export class DioxusHeadsUpMessage extends LitElement implements Layer {
  public game: GameView;

  @state() private isLaunched = false;

  private isVisible = false;
  private isPaused = false;
  private toastTimeout: number | null = null;
  private lastDispatchedTick = -1;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "show-message",
      this.handleShowMessage as EventListener,
    );
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    window.removeEventListener(
      "show-message",
      this.handleShowMessage as EventListener,
    );
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiHudHeadsUpMessageLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusHeadsUpMessage] Failed to launch:", err);
    }
  }

  private handleShowMessage = (event: CustomEvent) => {
    const { message, duration, color } = event.detail ?? {};
    if (typeof message === "string") {
      if (!this.isLaunched) return;

      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiHudHeadsUpToastShow, {
        message,
        color: color === "red" ? "red" : "green",
      });

      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }
      this.toastTimeout = window.setTimeout(
        () => {
          dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiHudHeadsUpToastHide);
        },
        typeof duration === "number" ? duration : 2000,
      );
    }
  };

  init() {
    this.isVisible = true;
  }

  tick() {
    if (!this.isLaunched || !this.game) return;
    const currentTick = this.game.ticks();
    if (this.lastDispatchedTick === currentTick) {
      return;
    }
    this.lastDispatchedTick = currentTick;

    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.GamePaused].length > 0) {
      const pauseUpdate = updates[GameUpdateType.GamePaused][0];
      this.isPaused = pauseUpdate.paused;
    }

    this.isVisible = this.game.inSpawnPhase() || this.isPaused;

    const message = this.getMessage();
    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotHudHeadsUpMessage,
        scope: "hud",
        tick: currentTick,
        payload: {
          isVisible: this.isVisible,
          message,
        },
      })
    ) {
      console.warn("[DioxusHeadsUpMessage] Failed to dispatch runtime snapshot");
    }
  }

  private getMessage(): string {
    if (this.isPaused) {
      if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
        return translateText("heads_up_message.singleplayer_game_paused");
      }
      return translateText("heads_up_message.multiplayer_game_paused");
    }
    return this.game.config().isRandomSpawn()
      ? translateText("heads_up_message.random_spawn")
      : translateText("heads_up_message.choose_spawn");
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-heads-up-message-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

@customElement("dioxus-alert-frame")
export class DioxusAlertFrame extends LitElement implements Layer {
  public game: GameView;
  private userSettings: UserSettings = new UserSettings();

  @state() private isLaunched = false;

  private seenAttackIds: Set<string> = new Set();
  private lastAlertTick = -1;
  private outgoingAttackTicks: Map<number, number> = new Map();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiHudAlertFrameLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusAlertFrame] Failed to launch:", err);
    }
  }

  init() {}

  tick() {
    if (!this.isLaunched || !this.game) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      this.seenAttackIds.clear();
      this.outgoingAttackTicks.clear();
      this.lastAlertTick = -1;
      return;
    }

    this.trackOutgoingAttacks();

    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.BrokeAlliance]?.forEach((update) => {
        this.onBrokeAllianceUpdate(update as BrokeAllianceUpdate);
      });

    this.checkForNewAttacks();
  }

  shouldTransform(): boolean {
    return false;
  }

  private onBrokeAllianceUpdate(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID);
    if (betrayed === myPlayer) {
      this.activateAlert("betrayal");
    }
  }

  private activateAlert(alertType: string) {
    if (this.userSettings.alertFrame()) {
      this.lastAlertTick = this.game.ticks();
      if (
        !dispatchUiSnapshot({
          type: UI_RUNTIME_SNAPSHOTS.uiSnapshotHudAlertFrame,
          scope: "hud",
          tick: this.lastAlertTick,
          payload: {
            action: "show",
            alertType,
          },
        })
      ) {
        console.warn("[DioxusAlertFrame] Failed to dispatch runtime snapshot");
      }
    }
  }

  private trackOutgoingAttacks() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) return;

    const currentTick = this.game.ticks();
    const outgoingAttacks = myPlayer.outgoingAttacks();

    for (const attack of outgoingAttacks) {
      if (attack.targetID !== 0 && !attack.retreating) {
        const existingTick = this.outgoingAttackTicks.get(attack.targetID);
        if (
          existingTick === undefined ||
          currentTick - existingTick >= RETALIATION_WINDOW_TICKS
        ) {
          this.outgoingAttackTicks.set(attack.targetID, currentTick);
        }
      }
    }

    for (const [playerID, tick] of this.outgoingAttackTicks.entries()) {
      if (currentTick - tick > RETALIATION_WINDOW_TICKS) {
        this.outgoingAttackTicks.delete(playerID);
      }
    }
  }

  private checkForNewAttacks() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) return;

    const incomingAttacks = myPlayer.incomingAttacks();
    const currentTick = this.game.ticks();

    const inCooldown =
      this.lastAlertTick !== -1 &&
      currentTick - this.lastAlertTick < ALERT_COOLDOWN_TICKS;

    const playerTroops = myPlayer.troops();
    const minAttackTroopsThreshold = playerTroops / 5;

    for (const attack of incomingAttacks) {
      if (!attack.retreating && !this.seenAttackIds.has(attack.id)) {
        const ourAttackTick = this.outgoingAttackTicks.get(attack.attackerID);
        const isRetaliation =
          ourAttackTick !== undefined &&
          currentTick - ourAttackTick < RETALIATION_WINDOW_TICKS;

        const isSmallAttack = attack.troops < minAttackTroopsThreshold;

        if (!inCooldown && !isRetaliation && !isSmallAttack) {
          this.seenAttackIds.add(attack.id);
          this.activateAlert("land-attack");
        } else {
          this.seenAttackIds.add(attack.id);
        }
      }
    }

    const activeAttackIds = new Set(incomingAttacks.map((a) => a.id));
    for (const attackId of this.seenAttackIds) {
      if (!activeAttackIds.has(attackId)) {
        this.seenAttackIds.delete(attackId);
      }
    }
  }

  render() {
    return html`
      <div
        id="dioxus-alert-frame-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-spawn-timer": DioxusSpawnTimer;
    "dioxus-immunity-timer": DioxusImmunityTimer;
    "dioxus-heads-up-message": DioxusHeadsUpMessage;
    "dioxus-alert-frame": DioxusAlertFrame;
  }
}
