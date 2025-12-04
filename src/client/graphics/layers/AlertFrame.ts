import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { Layer } from "./Layer";

// Parameters for the alert animation
const ALERT_SPEED = 1.6;
const ALERT_COUNT = 2;
const RETALIATION_WINDOW_TICKS = 15 * 10; // 15 seconds
const ALERT_COOLDOWN_TICKS = 15 * 10; // 15 seconds

@customElement("alert-frame")
export class AlertFrame extends LitElement implements Layer {
  public game: GameView;
  private userSettings: UserSettings = new UserSettings();

  @state()
  private isActive = false;
  @state()
  private alertType: "betrayal" | "land-attack" = "betrayal";

  private animationTimeout: number | null = null;
  private seenAttackIds: Set<string> = new Set();
  private lastAlertTick: number = -1;
  // Map of player ID -> tick when we last attacked them
  private outgoingAttackTicks: Map<number, number> = new Map();

  static styles = css`
    .alert-border {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      border: 17px solid;
      box-sizing: border-box;
      z-index: 40;
      opacity: 0;
    }

    .alert-border.betrayal {
      border-color: #ee0000;
    }

    .alert-border.land-attack {
      border-color: #ffa500;
    }

    .alert-border.animate {
      animation: alertBlink ${ALERT_SPEED}s ease-in-out ${ALERT_COUNT};
    }

    @keyframes alertBlink {
      0% {
        opacity: 0;
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }
  `;

  constructor() {
    super();
    if (!document.querySelector("style[data-alert-frame]")) {
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-alert-frame", "");
      styleEl.textContent = AlertFrame.styles.cssText;
      document.head.appendChild(styleEl);
    }
  }

  createRenderRoot() {
    return this;
  }

  init() {
    // Listen for BrokeAllianceUpdate events directly from game updates
  }

  tick() {
    if (!this.game) {
      return; // Game not initialized yet
    }

    const myPlayer = this.game.myPlayer();

    // Clear tracked attacks if player dies or doesn't exist
    if (!myPlayer || !myPlayer.isAlive()) {
      this.seenAttackIds.clear();
      this.outgoingAttackTicks.clear();
      this.lastAlertTick = -1;
      return;
    }

    // Track outgoing attacks to detect retaliation
    this.trackOutgoingAttacks();

    // Check for BrokeAllianceUpdate events
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.BrokeAlliance]?.forEach((update) => {
        this.onBrokeAllianceUpdate(update as BrokeAllianceUpdate);
      });

    // Check for new incoming attacks
    this.checkForNewAttacks();
  }

  // The alert frame is not affected by the camera transform
  shouldTransform(): boolean {
    return false;
  }

  private onBrokeAllianceUpdate(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID);

    // Only trigger alert if the current player is the betrayed one
    if (betrayed === myPlayer) {
      this.alertType = "betrayal";
      this.activateAlert();
    }
  }

  private activateAlert() {
    if (this.userSettings.alertFrame()) {
      this.isActive = true;
      this.lastAlertTick = this.game.ticks();
      this.requestUpdate();
    }
  }

  private trackOutgoingAttacks() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      return;
    }

    const currentTick = this.game.ticks();
    const outgoingAttacks = myPlayer.outgoingAttacks();

    // Track when we attack other players (not terra nullius)
    for (const attack of outgoingAttacks) {
      // Only track attacks on players (targetID !== 0 means it's a player, not unclaimed land)
      if (attack.targetID !== 0 && !attack.retreating) {
        const existingTick = this.outgoingAttackTicks.get(attack.targetID);

        // Only update timestamp if:
        // 1. This is a new attack (not in map yet), OR
        // 2. The existing entry has expired (older than retaliation window)
        if (
          existingTick === undefined ||
          currentTick - existingTick >= RETALIATION_WINDOW_TICKS
        ) {
          this.outgoingAttackTicks.set(attack.targetID, currentTick);
        }
      }
    }

    // Clean up old entries (older than retaliation window)
    for (const [playerID, tick] of this.outgoingAttackTicks.entries()) {
      if (currentTick - tick > RETALIATION_WINDOW_TICKS) {
        this.outgoingAttackTicks.delete(playerID);
      }
    }
  }

  private checkForNewAttacks() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      return;
    }

    const incomingAttacks = myPlayer.incomingAttacks();
    const currentTick = this.game.ticks();

    // Check if we're in cooldown (within 10 seconds of last alert)
    const inCooldown =
      this.lastAlertTick !== -1 &&
      currentTick - this.lastAlertTick < ALERT_COOLDOWN_TICKS;

    // Find new attacks that we haven't seen yet
    const playerTroops = myPlayer.troops();
    const minAttackTroopsThreshold = playerTroops / 5; // 1/5 of current troops

    for (const attack of incomingAttacks) {
      // Only alert for non-retreating attacks
      if (!attack.retreating && !this.seenAttackIds.has(attack.id)) {
        // Check if this is a retaliation (we attacked them recently)
        const ourAttackTick = this.outgoingAttackTicks.get(attack.attackerID);
        const isRetaliation =
          ourAttackTick !== undefined &&
          currentTick - ourAttackTick < RETALIATION_WINDOW_TICKS;

        // Check if attack is too small (less than 1/5 of our troops)
        const isSmallAttack = attack.troops < minAttackTroopsThreshold;

        // Don't alert if:
        // 1. We're in cooldown from a recent alert
        // 2. This is a retaliation (we attacked them within 15 seconds)
        // 3. The attack is too small (less than 1/5 of our troops)
        if (!inCooldown && !isRetaliation && !isSmallAttack) {
          this.seenAttackIds.add(attack.id);
          this.alertType = "land-attack";
          this.activateAlert();
        } else {
          // Still mark as seen so we don't alert later
          this.seenAttackIds.add(attack.id);
        }
      }
    }

    // Clean up IDs for attacks that are no longer active (retreating or completed)
    const activeAttackIds = new Set(incomingAttacks.map((a) => a.id));

    // Remove IDs for attacks that are no longer in the incoming attacks list
    for (const attackId of this.seenAttackIds) {
      if (!activeAttackIds.has(attackId)) {
        this.seenAttackIds.delete(attackId);
      }
    }
  }

  public dismissAlert() {
    this.isActive = false;
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.animationTimeout = null;
    }
    this.requestUpdate();
  }

  render() {
    if (!this.isActive) {
      return html``;
    }

    return html`
      <div
        class=${`alert-border animate ${this.alertType}`}
        @animationend=${() => this.dismissAlert()}
      ></div>
    `;
  }
}
