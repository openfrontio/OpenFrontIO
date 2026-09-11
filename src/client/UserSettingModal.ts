import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { formatKeyForDisplay, translateText } from "../client/Utils";
import {
  AudioCategory,
  getDefaultKeybinds,
  UserSettings,
} from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingSelect";
import { SettingSelect } from "./components/baseComponents/setting/SettingSelect";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";
import { BaseModal } from "./components/BaseModal";
import "./components/GraphicsPresetSelector";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  desktopDisplay,
  DISPLAY_SETTLE_TIMEOUT_MS,
  isDisplaySnapshot,
  selectedDisplayId,
  type DesktopDisplayInfo,
  type DesktopDisplayPrefsPatch,
  type DesktopDisplaySnapshot,
} from "./DesktopDisplay";
import { isDesktopShell } from "./DesktopShell";
import { Platform } from "./Platform";
import type { AudioControls } from "./sound/CuePlayer";
import { audioControls, playCue } from "./sound/CuePlayer";
import type { CueCategory } from "./sound/Sounds";
import type { UIState } from "./UIState";

/**
 * Logged with no payload, ever.
 *
 * A display snapshot is not sensitive, but this runs in the Steam build
 * alongside code that handles account and purchase identifiers, and "log the
 * object you were given" is the habit that leaks them. The failure is also
 * not actionable by the player — the tab keeps rendering the last state it
 * could read — so a fixed breadcrumb is the whole of what a log is worth here.
 */
function warnDisplayBridgeFailure(): void {
  console.warn("[display] bridge call failed");
}

/** Mixer channels in the order the Audio tab shows them. */
const AUDIO_TAB_ORDER: readonly AudioCategory[] = [
  "master",
  "music",
  "effects",
  "alerts",
  "ambience",
  "interface",
];

/**
 * Rows that get a Test button. Master is tested by every other button and
 * music is already playing, so neither is previewable. Ambience is previewable
 * in principle but AudioMixer.previewCue("ambience") resolves without playing
 * — an ambience loop has no natural end — so a button there would do nothing.
 */
const PREVIEWABLE: readonly CueCategory[] = ["effects", "alerts", "interface"];

/**
 * Longest a Test button stays disabled waiting for its cue. Comfortably past
 * the longest preview cue; it only ever fires when a preview cannot settle.
 */
const PREVIEW_CEILING_MS = 10_000;

@customElement("user-setting")
export class UserSettingModal extends BaseModal {
  protected routerName: string | undefined = "settings";

  /**
   * Also set on the in-game instance by GameRenderer. The HUD's own attack
   * ratio slider is session-only — it never writes UserSettings — so in a
   * running game the live ratio is the one in UIState, not the stored one.
   */
  public uiState?: UIState;

  private userSettings: UserSettings = new UserSettings();
  private readonly defaultKeybinds = getDefaultKeybinds(Platform.isMac);

  // Optional "return to where you came from" callback, supplied by the caller
  // of open() and invoked once on close. The in-game menu uses it to reappear.
  private onReturn?: () => void;

  @state() private keySequence: string[] = [];
  @state() private showEasterEggSettings = false;

  @state() private userKeybinds: Record<
    string,
    { value: string; key: string }
  > = {};

  // ---- Display tab state (desktop shell only) ----
  //
  // Every field here is inert on the web: the tab is not in tabs[] when
  // desktopDisplay() is null, so onTabEnter("display") is unreachable and no
  // bridge reference is ever evaluated.

  /** The shell's last readable snapshot; null until the first one arrives. */
  @state() private display: DesktopDisplaySnapshot | null = null;

  /** True from a write leaving until the shell reports back, or the ceiling. */
  @state() private displayBusy = false;

  // The bridge's own unsubscribe. Called on close, on leaving the tab, and
  // before every subscribe — so repeated opens cannot stack listeners.
  private displayUnsubscribe: (() => void) | null = null;

  // Bumped on every write and on every leave. A bridge response carrying a
  // stale id is dropped, so a slow first patch cannot overwrite what a later
  // one already settled, and nothing in flight when the tab closed can land
  // on the next open.
  private displayRequestId = 0;

  private displaySettleTimer: ReturnType<typeof setTimeout> | undefined;

  connectedCallback() {
    super.connectedCallback();
    // Only the inline page instance owns the #modal=settings URL state. The
    // in-game instance must not touch the hash: Main's popstate handler treats
    // a hash change during a match as a request to leave the game.
    if (!this.inline) {
      this.routerName = undefined;
    }
    this.loadKeybindsFromStorage();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleEasterEggKey);
    // An element torn down without close() being called (the in-game instance
    // when the match ends) would otherwise leave the bridge holding a
    // callback into a dead component.
    this.leaveDisplayTab();
    super.disconnectedCallback();
  }

  private loadKeybindsFromStorage() {
    const parsed = this.userSettings.parsedUserKeybinds();
    if (Object.keys(parsed).length === 0) {
      this.userKeybinds = {};
      return;
    }

    const validated: Record<string, { value: string; key: string }> = {};

    for (const [action, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") {
        validated[action] = { value: entry, key: entry };
      } else if (
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry)
      ) {
        const rawValue = (entry as any).value ?? "Null";
        const value = Array.isArray(rawValue)
          ? rawValue.find((v) => typeof v === "string")
          : rawValue;

        const rawKey = (entry as any).key ?? value;
        const key = Array.isArray(rawKey)
          ? rawKey.find((v) => typeof v === "string")
          : rawKey;

        if (typeof value === "string" && typeof key === "string") {
          validated[action] = { value, key };
        }
      }
    }

    this.userKeybinds = validated;
  }

  private handleKeybindChange(
    e: CustomEvent<{
      action: string;
      value: string;
      key: string;
      prevValue?: string;
    }>,
  ) {
    const { action, value, key, prevValue } = e.detail;

    const activeKeybinds = { ...this.defaultKeybinds };
    for (const [k, v] of Object.entries(this.userKeybinds)) {
      const normalizedValue = v.value;
      if (normalizedValue === "Null") {
        delete activeKeybinds[k];
      } else {
        activeKeybinds[k] = normalizedValue;
      }
    }

    const values = Object.entries(activeKeybinds)
      .filter(([k]) => k !== action)
      .map(([, v]) => v);

    // Allow specific key pairs to share physical modifier keys without reporting conflict
    const ALLOWED_SHARED_MODIFIERS: Array<{
      actions: [string, string];
      keyPrefix: string;
    }> = [
      { actions: ["emojiMenuModifier", "altKey"], keyPrefix: "Alt" },
      { actions: ["boxSelectWarships", "shiftKey"], keyPrefix: "Shift" },
    ];

    const isAllowedSharedModifier = ALLOWED_SHARED_MODIFIERS.some(
      ({ actions: [a1, a2], keyPrefix }) =>
        ((action === a1 && activeKeybinds[a2] === value) ||
          (action === a2 && activeKeybinds[a1] === value)) &&
        (value === `${keyPrefix}Left` || value === `${keyPrefix}Right`),
    );

    if (
      values.includes(value) &&
      value !== "Null" &&
      !isAllowedSharedModifier
    ) {
      const displayKey = formatKeyForDisplay(key || value);
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: html`
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-red-500 inline-block align-middle mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span class="font-medium">
                ${(() => {
                  const placeholder = "__KEY__";
                  const message = translateText(
                    "user_setting.keybind_conflict_error",
                    { key: placeholder },
                  );
                  const [prefix, suffix] = message.split(placeholder);
                  return html`${prefix}<span
                      class="font-mono font-bold bg-white/10 px-1.5 py-0.5 rounded text-red-200 mx-1 border border-white/10"
                      >${displayKey}</span
                    >${suffix || ""}`;
                })()}
              </span>
            `,
            color: "red",
            duration: 3000,
          },
        }),
      );

      const element = this.renderRoot.querySelector<SettingKeybind>(
        `setting-keybind[action="${action}"]`,
      );
      if (element) {
        element.value = prevValue ?? this.defaultKeybinds[action] ?? "";
        element.requestUpdate();
      }
      return;
    }

    this.userKeybinds = {
      ...this.userKeybinds,
      [action]: { value: value, key: key },
    };
    this.userSettings.setKeybinds(this.userKeybinds);
  }

  private getKeyValue(action: string): string | undefined {
    const entry = this.userKeybinds[action];
    if (!entry) return undefined;
    const normalizedValue = entry.value;
    if (normalizedValue === "Null") return "";
    return normalizedValue || undefined;
  }

  private getKeyChar(action: string): string {
    const entry = this.userKeybinds[action];
    if (!entry) return formatKeyForDisplay(this.defaultKeybinds[action] || "");
    return entry.key || formatKeyForDisplay(entry.value || "");
  }

  private handleEasterEggKey = (e: KeyboardEvent) => {
    if (!this.isModalOpen || this.showEasterEggSettings) return;

    // Validate that the event target is inside this component
    const target = e.target as Node;
    if (!this.contains(target)) {
      return;
    }

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "evan") {
      this.triggerEasterEgg();
      this.keySequence = [];
    }
  };

  private triggerEasterEgg() {
    console.log("🪺 Setting~ unlocked by EVAN combo!");
    this.showEasterEggSettings = true;
    const popup = document.createElement("div");
    popup.className =
      "fixed top-10 left-1/2 p-4 px-6 bg-black/80 text-white text-xl rounded-xl animate-fadePop z-[9999]";
    popup.textContent = "🎉 You found a secret setting!";
    document.body.appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 5000);
  }

  private toggleEmojis() {
    this.userSettings.toggleEmojis();

    console.log("🤡 Emojis:", this.userSettings.emojis() ? "ON" : "OFF");
  }

  private toggleAlertFrame() {
    this.userSettings.toggleAlertFrame();

    console.log(
      "🚨 Alert frame:",
      this.userSettings.alertFrame() ? "ON" : "OFF",
    );
  }

  private toggleCursorCostLabel() {
    this.userSettings.toggleCursorCostLabel();

    console.log(
      "💰 Cursor build cost:",
      this.userSettings.cursorCostLabel() ? "ON" : "OFF",
    );
  }

  private toggleAnonymousNames() {
    this.userSettings.toggleRandomName();

    console.log(
      "🙈 Anonymous Names:",
      this.userSettings.anonymousNames() ? "ON" : "OFF",
    );
  }

  private toggleLobbyIdVisibility() {
    this.userSettings.toggleLobbyIdVisibility();
    console.log(
      "👁️ Hidden Lobby IDs:",
      !this.userSettings.lobbyIdVisibility() ? "ON" : "OFF",
    );
  }

  private toggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
    console.log(
      "🖱️ Left Click Opens Menu:",
      this.userSettings.leftClickOpensMenu() ? "ON" : "OFF",
    );

    this.requestUpdate();
  }

  /** The ratio the player is actually attacking with right now. */
  private currentAttackRatio(): number {
    return this.uiState?.attackRatio ?? this.userSettings.attackRatio();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      // ControlPanel listens for this and updates both its cached ratio and
      // UIState, so the running game follows the slider.
      this.userSettings.setAttackRatio(ratio);
      this.requestUpdate();
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private changeAttackRatioIncrement(
    e: CustomEvent<{ value: number | string }>,
  ) {
    const rawValue = e.detail?.value;
    const value =
      typeof rawValue === "number" ? rawValue : parseInt(String(rawValue), 10);
    if (!Number.isFinite(value)) {
      console.warn("Select event missing detail.value", e);
      return;
    }
    this.userSettings.setAttackRatioIncrement(Math.round(value));
    this.requestUpdate();
  }

  private sliderNukeAllianceSafetyDuration(e: CustomEvent<{ value: number }>) {
    this.userSettings.setNukeAllianceSafetyDuration(e.detail.value);
    this.requestUpdate();
  }

  private toggleTerritoryPatterns() {
    this.userSettings.toggleTerritoryPatterns();

    console.log(
      "🏳️ Territory Patterns:",
      this.userSettings.territoryPatterns() ? "ON" : "OFF",
    );
  }

  private toggleGoToPlayer() {
    this.userSettings.toggleGoToPlayer();

    console.log(
      "🔍 Go to player:",
      this.userSettings.goToPlayer() ? "ON" : "OFF",
    );
  }

  private togglePerformanceOverlay() {
    this.userSettings.togglePerformanceOverlay();
  }

  private toggleHelpMessages() {
    this.userSettings.toggleHelpMessages();

    console.log(
      "Help messages:",
      this.userSettings.helpMessages() ? "ON" : "OFF",
    );
  }

  private toggleAttackingTroopsOverlay() {
    this.userSettings.toggleAttackingTroopsOverlay();

    console.log(
      "Attacking troops overlay:",
      this.userSettings.attackingTroopsOverlay() ? "ON" : "OFF",
    );
  }

  // A slider handler writes the setting and stops. AudioMixer follows
  // USER_SETTINGS_CHANGED_EVENT for that key, which reaches the menu theme on
  // this page and a running game's music alike — no volume event, no bus, and
  // so no second EventBus for the home page to be missing.
  private sliderAudio(
    category: AudioCategory,
    e: CustomEvent<{ value: number }>,
  ) {
    const value = e.detail?.value;
    if (typeof value !== "number") {
      console.warn("Slider event missing detail.value", e);
      return;
    }
    this.userSettings.setAudioVolume(category, value / 100);
    this.playSliderTick();
    this.requestUpdate();
  }

  private toggleMuteOnBlur(e: Event) {
    this.userSettings.setMuteOnBlur((e.target as HTMLInputElement).checked);
    // Re-render so the dependent "keep alerts audible" row follows.
    this.requestUpdate();
  }

  private toggleAlertsWhenUnfocused(e: Event) {
    this.userSettings.setAlertsWhenUnfocused(
      (e.target as HTMLInputElement).checked,
    );
    this.requestUpdate();
  }

  // @change fires throughout a drag; rate-limit the tick so dragging sounds
  // like a ratchet rather than a buzz.
  private lastSliderTickMs = 0;

  /**
   * Only ever reached from a slider's `change` handler, which `setting-slider`
   * dispatches from its `@input` — a user drag. Setting `.value`
   * programmatically never routes through here, so the tick cannot fire on a
   * re-render. Via CuePlayer so this modal does not drag howler into every
   * test that mounts it.
   */
  private playSliderTick() {
    const now = Date.now();
    if (now - this.lastSliderTickMs < 150) return;
    this.lastSliderTickMs = now;
    playCue("slider");
  }

  /**
   * Channels with a preview cue in flight. A button stays disabled until its
   * own cue finishes, so a player cannot stack copies of it.
   */
  @state() private previewing: ReadonlySet<CueCategory> = new Set();

  private async playTestCue(category: CueCategory) {
    const controls = audioControls();
    if (controls === null || this.previewing.has(category)) return;
    this.previewing = new Set([...this.previewing, category]);
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    try {
      // A cue whose asset fails to load or play settles neither `end` nor
      // `stop` in Howler, so previewCue would never resolve and the button
      // would stay disabled for the life of the page. Race a ceiling so the
      // worst case is one dead press, not a permanently dead button.
      await Promise.race([
        controls.previewCue(category),
        new Promise<void>((resolve) => {
          ceiling = setTimeout(resolve, PREVIEW_CEILING_MS);
        }),
      ]);
    } catch (error) {
      // The cue is a convenience; a failed preview must not break the tab.
      console.warn("Failed to play audio preview", error);
    } finally {
      if (ceiling !== undefined) clearTimeout(ceiling);
      const remaining = new Set(this.previewing);
      remaining.delete(category);
      this.previewing = remaining;
    }
  }

  private renderTestButton(controls: AudioControls, category: CueCategory) {
    const muted = !controls.isAudible(category);
    const pending = this.previewing.has(category);
    return html`
      <button
        id="audio-${category}-test"
        class="self-end px-3 py-1 text-sm font-medium rounded-lg border border-white/10 text-white transition-colors ${muted ||
        pending
          ? "opacity-40 cursor-not-allowed"
          : "bg-white/5 hover:bg-white/15"}"
        ?disabled=${muted || pending}
        title=${muted ? translateText("user_setting.audio_test_muted") : ""}
        @click=${() => this.playTestCue(category)}
      >
        ${translateText("user_setting.audio_test")}
      </button>
    `;
  }

  private renderVolumeSlider(category: AudioCategory) {
    const controls = audioControls();
    return html`
      <div class="flex flex-col gap-2">
        <setting-slider
          label="${translateText(`user_setting.audio_${category}`)}"
          description="${translateText(`user_setting.audio_${category}_desc`)}"
          id="audio-${category}-slider"
          min="0"
          max="100"
          unit=""
          .value=${Math.round(this.userSettings.audioVolume(category) * 100)}
          @change=${(e: CustomEvent<{ value: number }>) =>
            this.sliderAudio(category, e)}
        ></setting-slider>
        ${controls !== null && PREVIEWABLE.includes(category as CueCategory)
          ? html`<div class="flex justify-end">
              ${this.renderTestButton(controls, category as CueCategory)}
            </div>`
          : ""}
      </div>
    `;
  }

  private renderAudioSettings() {
    const muteOnBlur = this.userSettings.muteOnBlur();
    return html`
      ${AUDIO_TAB_ORDER.map((category) => this.renderVolumeSlider(category))}

      <setting-toggle
        label="${translateText("user_setting.audio_mute_on_blur")}"
        description="${translateText("user_setting.audio_mute_on_blur_desc")}"
        id="audio-mute-on-blur-toggle"
        .checked=${muteOnBlur}
        @change=${this.toggleMuteOnBlur}
      ></setting-toggle>

      <!-- Dependent on the row above: meaningless when nothing is muted. -->
      <div class="pl-6">
        <setting-toggle
          label="${translateText("user_setting.audio_alerts_when_unfocused")}"
          description="${translateText(
            "user_setting.audio_alerts_when_unfocused_desc",
          )}"
          id="audio-alerts-when-unfocused-toggle"
          .checked=${this.userSettings.alertsWhenUnfocused()}
          ?disabled=${!muteOnBlur}
          @change=${this.toggleAlertsWhenUnfocused}
        ></setting-toggle>
      </div>
    `;
  }

  protected modalConfig() {
    return {
      tabs: [
        { key: "gameplay", label: translateText("user_setting.tab_gameplay") },
        { key: "graphics", label: translateText("user_setting.tab_graphics") },
        // Desktop only, and only on a shell that actually exposes the display
        // bridge. isDesktopShell() is documentation — desktopDisplay() is
        // already null everywhere it is false — and the second condition is
        // what keeps the tab away from a shell too old to serve it, where
        // rendering it would offer controls that do nothing.
        ...(isDesktopShell() && desktopDisplay() !== null
          ? [
              {
                key: "display",
                label: translateText("user_setting.tab_display"),
              },
            ]
          : []),
        { key: "audio", label: translateText("user_setting.tab_audio") },
        // Keybinds is about having keys. A touch device has none, so the tab
        // is a list of rebind controls the player can neither use nor trigger.
        //
        // Platform.isTouch tests the PRIMARY pointer (`pointer: coarse`), not
        // the viewport, which is the distinction that matters here: a laptop
        // with a touchscreen and a mouse keeps the tab, and a tablet loses it
        // at any width. A CSS breakpoint would get both backwards.
        //
        // Removed from tabs[] rather than hidden, so BaseModal -- which
        // validates a requested tab against this list -- lands
        // open({ tab: "keybinds" }) on Gameplay instead of selecting a tab
        // with nothing behind it.
        ...(Platform.isTouch
          ? []
          : [
              {
                key: "keybinds",
                label: translateText("user_setting.tab_keybinds"),
              },
            ]),
      ],
    };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("user_setting.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      showDivider: true,
    });
  }

  protected renderBody(tab: string) {
    let body;
    switch (tab) {
      case "keybinds":
        body = this.renderKeybindSettings();
        break;
      case "audio":
        body = this.renderAudioSettings();
        break;
      case "graphics":
        body = this.renderGraphicsSettings();
        break;
      case "display":
        body = this.renderDisplaySettings();
        break;
      default:
        body = this.renderGameplaySettings();
    }
    return html`
      <div class="flex flex-col gap-2 p-4 lg:p-[1.4rem]">${body}</div>
    `;
  }

  protected updated(): void {
    this.syncDisplayControls();
  }

  protected onTabEnter(key: string): void {
    // BaseModal has no onTabLeave, so entering any other tab is what "left
    // the Display tab" looks like. Subscribing only while the tab is on
    // screen keeps a settings modal the player left open on Gameplay from
    // taking an IPC push on every monitor change for the rest of the session.
    if (key === "display") {
      this.enterDisplayTab();
    } else {
      this.leaveDisplayTab();
    }
  }

  protected onClose(): void {
    this.leaveDisplayTab();
    window.removeEventListener("keydown", this.handleEasterEggKey);
    // Fire once: a caller that reopens us on return would otherwise inherit
    // the previous caller's callback.
    const onReturn = this.onReturn;
    this.onReturn = undefined;
    onReturn?.();
  }

  // ---- Display tab ----
  //
  // The shell owns window mode and monitor choice; this tab is a view of the
  // shell's state, never a second copy of it. It therefore renders only what
  // the shell last reported and never what the player just clicked: the shell
  // may refuse a patch (an unplugged monitor, a mode it does not know), and
  // when it does it answers with the state that actually holds.

  private enterDisplayTab(): void {
    const bridge = desktopDisplay();
    if (bridge === null) return;
    // Idempotent on purpose. open() calls onTabEnter for the already-active
    // tab, so re-opening the modal on Display re-enters it — and a second
    // subscribe without this would leak one listener per open.
    this.leaveDisplayTab();
    const requestId = this.displayRequestId;
    void this.readDisplaySnapshot(requestId);
    if (typeof bridge.subscribe !== "function") return;
    try {
      this.displayUnsubscribe = bridge.subscribe((snapshot) => {
        // A push is the shell's current truth whatever else is in flight —
        // it is emitted for monitors being plugged in as well as for our own
        // writes — so it is applied unconditionally, and it is what normally
        // settles a pending write.
        //
        // Nothing below happens for a push we cannot read. adoptDisplaySnapshot
        // would drop it anyway, but the bump and the settle would still run --
        // retiring the real setPrefs answer, cancelling the ceiling's recovery
        // read, and re-enabling the controls on state we never updated. The
        // player's change would silently read as reverted while the shell had
        // in fact applied it. An unreadable push is not evidence of anything.
        if (!isDisplaySnapshot(snapshot)) return;
        // Bumped BEFORE adopting, which invalidates whatever was in flight:
        // a push is strictly newer than any request that has not answered
        // yet, so letting the initial read (or the ceiling's re-read) land
        // afterwards would overwrite fresher truth with staler truth.
        this.displayRequestId++;
        this.adoptDisplaySnapshot(snapshot);
        this.settleDisplayWrite();
      });
    } catch {
      // A shell whose subscribe throws still has a usable read/write pair;
      // the tab just falls back to re-reading after each write.
      this.displayUnsubscribe = null;
      warnDisplayBridgeFailure();
    }
  }

  private leaveDisplayTab(): void {
    const unsubscribe = this.displayUnsubscribe;
    this.displayUnsubscribe = null;
    try {
      unsubscribe?.();
    } catch {
      // Closing the settings modal must not fail because the shell's
      // unsubscribe did.
      warnDisplayBridgeFailure();
    }
    this.clearDisplaySettleTimer();
    this.displayBusy = false;
    // Invalidate anything still in flight, so a response cannot arrive after
    // the tab is gone and re-enable controls that are no longer on screen.
    this.displayRequestId++;
  }

  private async readDisplaySnapshot(requestId: number): Promise<void> {
    const bridge = desktopDisplay();
    if (bridge === null) return;
    try {
      const snapshot = await bridge.getPrefs();
      if (requestId !== this.displayRequestId) return;
      this.adoptDisplaySnapshot(snapshot);
    } catch {
      // Keep whatever was last rendered. The shell's handlers are written
      // never to reject — a refused patch comes back as the current snapshot
      // — so a rejection means the bridge itself is broken, and retrying
      // against a broken bridge is worse than a stale control.
      warnDisplayBridgeFailure();
    }
  }

  private adoptDisplaySnapshot(snapshot: unknown): void {
    // Dropped rather than rendered when unreadable: see isDisplaySnapshot.
    if (!isDisplaySnapshot(snapshot)) return;
    this.display = snapshot;
  }

  /**
   * Sends a patch and waits for the shell to say what happened.
   *
   * Three ways this ends, and all three end with the controls enabled and
   * showing a state the shell reported:
   *
   *   - the shell pushes `display:changed` or answers the invoke — re-render
   *     from that snapshot (the normal path, and the only one that can
   *     actually change what is selected);
   *   - the bridge rejects — keep the last snapshot, since that is still the
   *     mode the window is really in, and re-enable so the player can retry;
   *   - nothing answers within DISPLAY_SETTLE_TIMEOUT_MS — re-enable anyway
   *     and re-read, so the tab ends up on the shell's state rather than
   *     stuck on the player's click.
   */
  private applyDisplayPatch(patch: DesktopDisplayPrefsPatch): void {
    const bridge = desktopDisplay();
    // Both controls are disabled while busy; this is the guard for a change
    // event arriving anyway (a test, or a select driven programmatically).
    if (bridge === null || this.displayBusy) return;

    this.displayBusy = true;
    this.displayRequestId++;
    const requestId = this.displayRequestId;

    this.clearDisplaySettleTimer();
    this.displaySettleTimer = setTimeout(() => {
      this.displaySettleTimer = undefined;
      // Re-enable BEFORE the re-read, not after it: the ceiling has to hold
      // even when getPrefs never answers either.
      this.displayBusy = false;
      void this.readDisplaySnapshot(requestId);
    }, DISPLAY_SETTLE_TIMEOUT_MS);

    let pending: Promise<DesktopDisplaySnapshot>;
    try {
      pending = bridge.setPrefs(patch);
    } catch {
      // A bridge that throws synchronously rather than rejecting.
      warnDisplayBridgeFailure();
      this.settleDisplayWrite();
      return;
    }
    void pending.then(
      (snapshot) => {
        if (requestId !== this.displayRequestId) return;
        this.adoptDisplaySnapshot(snapshot);
        this.settleDisplayWrite();
      },
      () => {
        warnDisplayBridgeFailure();
        if (requestId !== this.displayRequestId) return;
        this.settleDisplayWrite();
      },
    );
  }

  private settleDisplayWrite(): void {
    this.clearDisplaySettleTimer();
    this.displayBusy = false;
  }

  /**
   * Forces the two selects back onto the snapshot once a write has settled.
   *
   * `<setting-select>` writes the player's choice into its OWN `value` on
   * change, which is right for a setting the page owns outright and wrong
   * here: these two are owned by the shell. Without this, a refused or failed
   * change leaves the control reading "Windowed" over a window that is still
   * borderless — the binding cannot fix it by itself, because the modal's
   * state never changed and so Lit has nothing to re-commit.
   *
   * Deliberately skipped while a change is in flight. The control is disabled
   * then, and leaving the requested value on screen is the only feedback that
   * anything is happening; snapping it back and forward again would read as a
   * glitch rather than as a wait.
   */
  private syncDisplayControls(): void {
    const snapshot = this.display;
    if (snapshot === null || this.displayBusy) return;
    if (this.activeTab !== "display") return;

    const mode = this.querySelector<SettingSelect>("#display-mode-select");
    if (mode && mode.value !== snapshot.prefs.mode) {
      mode.value = snapshot.prefs.mode;
    }

    const monitor = this.querySelector<SettingSelect>(
      "#display-monitor-select",
    );
    if (monitor === null) return;
    const expected = String(selectedDisplayId(snapshot));
    if (monitor.value !== expected) {
      monitor.value = expected;
    }
  }

  private clearDisplaySettleTimer(): void {
    if (this.displaySettleTimer === undefined) return;
    clearTimeout(this.displaySettleTimer);
    this.displaySettleTimer = undefined;
  }

  private handleDisplayModeChange = (e: CustomEvent<{ value: unknown }>) => {
    const value = e.detail?.value;
    // Validated here rather than trusted: the shell refuses an unknown mode,
    // and there is no reason to spend an IPC round trip to be told so.
    if (value !== "windowed" && value !== "borderless") return;
    this.applyDisplayPatch({ mode: value });
  };

  private handleDisplayMonitorChange = (e: CustomEvent<{ value: unknown }>) => {
    const raw = e.detail?.value;
    const id = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(id)) return;
    const chosen = this.display?.displays.find((d) => d.id === id);
    // An id we are not currently showing is a race with a monitor being
    // unplugged, not a choice. The shell refuses it too.
    if (chosen === undefined) return;
    // The primary display is stored as null rather than as its id, because
    // that is what null MEANS to the shell: "whichever display the OS calls
    // primary". A player who picks the primary keeps following it if the OS
    // primary later changes, and a renumbered id cannot strand them on a
    // display they never chose.
    this.applyDisplayPatch({ displayId: chosen.primary ? null : chosen.id });
  };

  private displayOptionLabel(info: DesktopDisplayInfo, index: number): string {
    // Never a bare id. An Electron display id is an opaque OS number that
    // means nothing to a player and is not stable across sessions. The shell
    // already substitutes "Display N" for an empty label; this enforces the
    // same guarantee on our side of the boundary instead of assuming it
    // across a versioned one.
    const trimmed = info.label.trim();
    const label =
      trimmed === ""
        ? translateText("user_setting.display_unnamed", { index: index + 1 })
        : trimmed;
    return info.primary
      ? `${label} (${translateText("user_setting.display_primary")})`
      : label;
  }

  private renderDisplaySettings() {
    const snapshot = this.display;
    // F11 is the shell's own escape hatch from a window with no title bar,
    // and it is worth saying so on a tab whose Borderless option removes that
    // title bar. Suppressed on macOS, where F11 is bound to Mission Control's
    // Show Desktop by default and frequently never reaches the window — a
    // hint that names a key that does nothing is worse than no hint.
    const f11Hint = Platform.isMac
      ? null
      : html`
          <div
            id="display-f11-hint"
            class="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300/70 text-xs"
          >
            ${translateText("user_setting.display_f11_hint")}
          </div>
        `;

    // Before the first snapshot arrives there is nothing truthful to select,
    // so the controls are withheld rather than rendered empty. The hint is
    // true either way.
    if (snapshot === null) return html`${f11Hint}`;

    const displays = snapshot.displays;
    const selectedId = selectedDisplayId(snapshot);

    // Rendered as its own row rather than as the spec's extra option inside
    // the picker: losing the remembered monitor usually drops the count to
    // one, which hides the picker — and with it the only explanation of why
    // the game is suddenly on the other display.
    const missingNote = snapshot.preferredDisplayPresent
      ? null
      : html`
          <div
            id="display-missing-note"
            class="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200/80 text-xs"
          >
            ${translateText("user_setting.display_missing")}
          </div>
        `;

    return html`
      ${f11Hint} ${missingNote}

      <setting-select
        id="display-mode-select"
        label=${translateText("user_setting.display_mode_label")}
        description=${translateText("user_setting.display_mode_desc")}
        .value=${snapshot.prefs.mode}
        ?disabled=${this.displayBusy}
        .options=${[
          {
            value: "windowed",
            label: translateText("user_setting.display_mode_windowed"),
          },
          {
            value: "borderless",
            label: translateText("user_setting.display_mode_borderless"),
          },
        ]}
        @change=${this.handleDisplayModeChange}
      ></setting-select>

      ${displays.length > 1
        ? html`
            <setting-select
              id="display-monitor-select"
              label=${translateText("user_setting.display_monitor_label")}
              description=${translateText("user_setting.display_monitor_desc")}
              .value=${String(selectedId)}
              ?disabled=${this.displayBusy}
              .options=${displays.map((d, i) => ({
                value: d.id,
                label: this.displayOptionLabel(d, i),
              }))}
              @change=${this.handleDisplayMonitorChange}
            ></setting-select>
          `
        : null}
    `;
  }

  private renderKeybindSettings() {
    return html`
      <div
        class="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300/70 text-xs"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5 shrink-0 opacity-70"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        ${translateText("user_setting.keybinds_hint")}
      </div>

      <h2
        class="text-blue-200 text-xl font-bold mt-4 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.view_options")}
      </h2>

      <setting-keybind
        action="toggleView"
        label=${translateText("user_setting.toggle_view")}
        description=${translateText("user_setting.toggle_view_desc")}
        defaultKey=${this.defaultKeybinds.toggleView}
        .value=${this.getKeyValue("toggleView")}
        .display=${this.getKeyChar("toggleView")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="coordinateGrid"
        label=${translateText("user_setting.coordinate_grid_label")}
        description=${translateText("user_setting.coordinate_grid_desc")}
        defaultKey=${this.defaultKeybinds.coordinateGrid}
        .value=${this.getKeyValue("coordinateGrid")}
        .display=${this.getKeyChar("coordinateGrid")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="altKey"
        label=${translateText("user_setting.graphics_refresh_modifier")}
        description=${translateText(
          "user_setting.graphics_refresh_modifier_desc",
          { key: this.getKeyChar("resetGfx").toUpperCase() },
        )}
        .defaultKey=${this.defaultKeybinds.altKey}
        .value=${this.getKeyValue("altKey")}
        .display=${this.getKeyChar("altKey")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="resetGfx"
        label=${translateText("help_modal.action_reset_gfx")}
        description=${translateText("user_setting.reset_gfx_desc")}
        .defaultKey=${this.defaultKeybinds.resetGfx}
        .value=${this.getKeyValue("resetGfx")}
        .display=${this.getKeyChar("resetGfx")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.build_controls")}
      </h2>

      <setting-keybind
        action="buildCity"
        label=${translateText("user_setting.build_city")}
        description=${translateText("user_setting.build_city_desc")}
        defaultKey=${this.defaultKeybinds.buildCity}
        .value=${this.getKeyValue("buildCity")}
        .display=${this.getKeyChar("buildCity")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildFactory"
        label=${translateText("user_setting.build_factory")}
        description=${translateText("user_setting.build_factory_desc")}
        defaultKey=${this.defaultKeybinds.buildFactory}
        .value=${this.getKeyValue("buildFactory")}
        .display=${this.getKeyChar("buildFactory")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildPort"
        label=${translateText("user_setting.build_port")}
        description=${translateText("user_setting.build_port_desc")}
        defaultKey=${this.defaultKeybinds.buildPort}
        .value=${this.getKeyValue("buildPort")}
        .display=${this.getKeyChar("buildPort")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildDefensePost"
        label=${translateText("user_setting.build_defense_post")}
        description=${translateText("user_setting.build_defense_post_desc")}
        defaultKey=${this.defaultKeybinds.buildDefensePost}
        .value=${this.getKeyValue("buildDefensePost")}
        .display=${this.getKeyChar("buildDefensePost")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMissileSilo"
        label=${translateText("user_setting.build_missile_silo")}
        description=${translateText("user_setting.build_missile_silo_desc")}
        defaultKey=${this.defaultKeybinds.buildMissileSilo}
        .value=${this.getKeyValue("buildMissileSilo")}
        .display=${this.getKeyChar("buildMissileSilo")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildSamLauncher"
        label=${translateText("user_setting.build_sam_launcher")}
        description=${translateText("user_setting.build_sam_launcher_desc")}
        defaultKey=${this.defaultKeybinds.buildSamLauncher}
        .value=${this.getKeyValue("buildSamLauncher")}
        .display=${this.getKeyChar("buildSamLauncher")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildWarship"
        label=${translateText("user_setting.build_warship")}
        description=${translateText("user_setting.build_warship_desc")}
        defaultKey=${this.defaultKeybinds.buildWarship}
        .value=${this.getKeyValue("buildWarship")}
        .display=${this.getKeyChar("buildWarship")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildAtomBomb"
        label=${translateText("user_setting.build_atom_bomb")}
        description=${translateText("user_setting.build_atom_bomb_desc")}
        defaultKey=${this.defaultKeybinds.buildAtomBomb}
        .value=${this.getKeyValue("buildAtomBomb")}
        .display=${this.getKeyChar("buildAtomBomb")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildHydrogenBomb"
        label=${translateText("user_setting.build_hydrogen_bomb")}
        description=${translateText("user_setting.build_hydrogen_bomb_desc")}
        defaultKey=${this.defaultKeybinds.buildHydrogenBomb}
        .value=${this.getKeyValue("buildHydrogenBomb")}
        .display=${this.getKeyChar("buildHydrogenBomb")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMIRV"
        label=${translateText("user_setting.build_mirv")}
        description=${translateText("user_setting.build_mirv_desc")}
        defaultKey=${this.defaultKeybinds.buildMIRV}
        .value=${this.getKeyValue("buildMIRV")}
        .display=${this.getKeyChar("buildMIRV")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.menu_shortcuts")}
      </h2>

      <setting-keybind
        action="buildMenuModifier"
        label=${translateText("user_setting.build_menu_modifier")}
        description=${translateText("user_setting.build_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.buildMenuModifier}
        .value=${this.getKeyValue("buildMenuModifier")}
        .display=${this.getKeyChar("buildMenuModifier")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="emojiMenuModifier"
        label=${translateText("user_setting.emoji_menu_modifier")}
        description=${translateText("user_setting.emoji_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.emojiMenuModifier}
        .value=${this.getKeyValue("emojiMenuModifier")}
        .display=${this.getKeyChar("emojiMenuModifier")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="boxSelectWarships"
        label=${translateText("user_setting.box_select_warships")}
        description=${translateText("user_setting.box_select_warships_desc")}
        .defaultKey=${this.defaultKeybinds.boxSelectWarships}
        .value=${this.getKeyValue("boxSelectWarships")}
        .display=${this.getKeyChar("boxSelectWarships")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="selectAllWarships"
        label=${translateText("user_setting.select_all_warships")}
        description=${translateText("user_setting.select_all_warships_desc")}
        .defaultKey=${this.defaultKeybinds.selectAllWarships}
        .value=${this.getKeyValue("selectAllWarships")}
        .display=${this.getKeyChar("selectAllWarships")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="pauseGame"
        label=${translateText("user_setting.pause_game")}
        description=${translateText("user_setting.pause_game_desc")}
        .defaultKey=${this.defaultKeybinds.pauseGame}
        .value=${this.getKeyValue("pauseGame")}
        .display=${this.getKeyChar("pauseGame")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="gameSpeedUp"
        label=${translateText("user_setting.game_speed_up")}
        description=${translateText("user_setting.game_speed_up_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedUp}
        .value=${this.getKeyValue("gameSpeedUp")}
        .display=${this.getKeyChar("gameSpeedUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="gameSpeedDown"
        label=${translateText("user_setting.game_speed_down")}
        description=${translateText("user_setting.game_speed_down_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedDown}
        .value=${this.getKeyValue("gameSpeedDown")}
        .display=${this.getKeyChar("gameSpeedDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_ratio_controls")}
      </h2>

      <setting-keybind
        action="attackRatioDown"
        label=${translateText("user_setting.attack_ratio_down")}
        description=${translateText("user_setting.attack_ratio_down_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        defaultKey=${this.defaultKeybinds.attackRatioDown}
        .value=${this.getKeyValue("attackRatioDown")}
        .display=${this.getKeyChar("attackRatioDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="attackRatioUp"
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        defaultKey=${this.defaultKeybinds.attackRatioUp}
        .value=${this.getKeyValue("attackRatioUp")}
        .display=${this.getKeyChar("attackRatioUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_keybinds")}
      </h2>

      <setting-keybind
        action="boatAttack"
        label=${translateText("user_setting.boat_attack")}
        description=${translateText("user_setting.boat_attack_desc")}
        defaultKey=${this.defaultKeybinds.boatAttack}
        .value=${this.getKeyValue("boatAttack")}
        .display=${this.getKeyChar("boatAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="groundAttack"
        label=${translateText("user_setting.ground_attack")}
        description=${translateText("user_setting.ground_attack_desc")}
        defaultKey=${this.defaultKeybinds.groundAttack}
        .value=${this.getKeyValue("groundAttack")}
        .display=${this.getKeyChar("groundAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="retaliateAttack"
        label=${translateText("user_setting.retaliate_attack")}
        description=${translateText("user_setting.retaliate_attack_desc")}
        defaultKey=${this.defaultKeybinds.retaliateAttack}
        .value=${this.getKeyValue("retaliateAttack")}
        .display=${this.getKeyChar("retaliateAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="swapDirection"
        label=${translateText("user_setting.swap_direction")}
        description=${translateText("user_setting.swap_direction_desc")}
        .defaultKey=${this.defaultKeybinds.swapDirection}
        .value=${this.getKeyValue("swapDirection")}
        .display=${this.getKeyChar("swapDirection")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.ally_keybinds")}
      </h2>

      <setting-keybind
        action="requestAlliance"
        label=${translateText("user_setting.request_alliance")}
        description=${translateText("user_setting.request_alliance_desc")}
        defaultKey=${this.defaultKeybinds.requestAlliance}
        .value=${this.getKeyValue("requestAlliance")}
        .display=${this.getKeyChar("requestAlliance")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="breakAlliance"
        label=${translateText("user_setting.break_alliance")}
        description=${translateText("user_setting.break_alliance_desc")}
        defaultKey=${this.defaultKeybinds.breakAlliance}
        .value=${this.getKeyValue("breakAlliance")}
        .display=${this.getKeyChar("breakAlliance")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.zoom_controls")}
      </h2>

      <setting-keybind
        action="zoomOut"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey=${this.defaultKeybinds.zoomOut}
        .value=${this.getKeyValue("zoomOut")}
        .display=${this.getKeyChar("zoomOut")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomIn"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey=${this.defaultKeybinds.zoomIn}
        .value=${this.getKeyValue("zoomIn")}
        .display=${this.getKeyChar("zoomIn")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.camera_movement")}
      </h2>

      <setting-keybind
        action="centerCamera"
        label=${translateText("user_setting.center_camera")}
        description=${translateText("user_setting.center_camera_desc")}
        defaultKey=${this.defaultKeybinds.centerCamera}
        .value=${this.getKeyValue("centerCamera")}
        .display=${this.getKeyChar("centerCamera")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveUp"
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        defaultKey=${this.defaultKeybinds.moveUp}
        .value=${this.getKeyValue("moveUp")}
        .display=${this.getKeyChar("moveUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveLeft"
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        defaultKey=${this.defaultKeybinds.moveLeft}
        .value=${this.getKeyValue("moveLeft")}
        .display=${this.getKeyChar("moveLeft")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveDown"
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        defaultKey=${this.defaultKeybinds.moveDown}
        .value=${this.getKeyValue("moveDown")}
        .display=${this.getKeyChar("moveDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveRight"
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        defaultKey=${this.defaultKeybinds.moveRight}
        .value=${this.getKeyValue("moveRight")}
        .display=${this.getKeyChar("moveRight")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>
    `;
  }

  /**
   * Purely visual switches — how the map and HUD are drawn. Anything that
   * changes how the game is played, or what the game tells you, belongs in
   * renderGameplaySettings() instead.
   */
  private renderGraphicsSettings() {
    return html`
      <!-- 🎨 Graphics preset -->
      <div
        class="flex flex-col w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-3"
      >
        <div class="flex flex-col min-w-0">
          <div class="text-white font-bold text-base block mb-1">
            ${translateText("user_setting.graphics_preset_label")}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${translateText("user_setting.graphics_preset_desc")}
          </div>
        </div>
        <graphics-preset-selector></graphics-preset-selector>
      </div>

      <!-- 🏳️ Territory Patterns -->
      <setting-toggle
        label="${translateText("user_setting.territory_patterns_label")}"
        description="${translateText("user_setting.territory_patterns_desc")}"
        id="territory-patterns-toggle"
        .checked=${this.userSettings.territoryPatterns()}
        @change=${this.toggleTerritoryPatterns}
      ></setting-toggle>

      <!-- 😊 Emojis -->
      <setting-toggle
        label="${translateText("user_setting.emojis_label")}"
        description="${translateText("user_setting.emojis_desc")}"
        id="emoji-toggle"
        .checked=${this.userSettings.emojis()}
        @change=${this.toggleEmojis}
      ></setting-toggle>

      <!-- 📱 Performance Overlay -->
      <setting-toggle
        label="${translateText("user_setting.performance_overlay_label")}"
        description="${translateText("user_setting.performance_overlay_desc")}"
        id="performance-overlay-toggle"
        .checked=${this.userSettings.performanceOverlay()}
        @change=${this.togglePerformanceOverlay}
      ></setting-toggle>
    `;
  }

  private renderGameplaySettings() {
    return html`
      <!-- 🚨 Alert frame -->
      <setting-toggle
        label="${translateText("user_setting.alert_frame_label")}"
        description="${translateText("user_setting.alert_frame_desc")}"
        id="alert-frame-toggle"
        .checked=${this.userSettings.alertFrame()}
        @change=${this.toggleAlertFrame}
      ></setting-toggle>

      <!-- 💰 Cursor Price Pill -->
      <setting-toggle
        label="${translateText("user_setting.cursor_cost_label_label")}"
        description="${translateText("user_setting.cursor_cost_label_desc")}"
        id="cursor_cost_label-toggle"
        .checked=${this.userSettings.cursorCostLabel()}
        @change=${this.toggleCursorCostLabel}
      ></setting-toggle>

      <!-- 🖱️ Left Click Menu -->
      <setting-toggle
        label="${translateText("user_setting.left_click_label")}"
        description="${translateText("user_setting.left_click_desc")}"
        id="left-click-toggle"
        .checked=${this.userSettings.leftClickOpensMenu()}
        @change=${this.toggleLeftClickOpensMenu}
      ></setting-toggle>

      <!-- 🙈 Anonymous Names -->
      <setting-toggle
        label="${translateText("user_setting.anonymous_names_label")}"
        description="${translateText("user_setting.anonymous_names_desc")}"
        id="anonymous-names-toggle"
        .checked=${this.userSettings.anonymousNames()}
        @change=${this.toggleAnonymousNames}
      ></setting-toggle>

      <!-- 👁️ Hidden Lobby IDs -->
      <setting-toggle
        label="${translateText("user_setting.lobby_id_visibility_label")}"
        description="${translateText("user_setting.lobby_id_visibility_desc")}"
        id="lobby-id-visibility-toggle"
        .checked=${!this.userSettings.lobbyIdVisibility()}
        @change=${this.toggleLobbyIdVisibility}
      ></setting-toggle>

      <!-- 🔍 Go to player -->
      <setting-toggle
        label="${translateText("user_setting.go_to_player_label")}"
        description="${translateText("user_setting.go_to_player_desc")}"
        id="go-to-player-toggle"
        .checked=${this.userSettings.goToPlayer()}
        @change=${this.toggleGoToPlayer}
      ></setting-toggle>

      <!-- Help messages (moved here from the in-game menu) -->
      <setting-toggle
        label="${translateText("user_setting.help_messages_label")}"
        description="${translateText("user_setting.help_messages_desc")}"
        id="help-messages-toggle"
        .checked=${this.userSettings.helpMessages()}
        @change=${this.toggleHelpMessages}
      ></setting-toggle>

      <!-- Attacking troops overlay (moved here from the in-game menu) -->
      <setting-toggle
        label="${translateText("user_setting.attacking_troops_overlay_label")}"
        description="${translateText(
          "user_setting.attacking_troops_overlay_desc",
        )}"
        id="attacking-troops-overlay-toggle"
        .checked=${this.userSettings.attackingTroopsOverlay()}
        @change=${this.toggleAttackingTroopsOverlay}
      ></setting-toggle>

      <!-- ⚔️ Attack Ratio -->
      <setting-slider
        label="${translateText("user_setting.attack_ratio_label")}"
        description="${translateText("user_setting.attack_ratio_desc")}"
        id="attack-ratio-slider"
        min="1"
        max="100"
        .value=${Math.round(this.currentAttackRatio() * 100)}
        @change=${this.sliderAttackRatio}
      ></setting-slider>

      <!-- ⚔️ Attack Ratio Increment -->
      <setting-select
        label=${translateText("user_setting.attack_ratio_increment_label")}
        description=${translateText("user_setting.attack_ratio_increment_desc")}
        .options=${[
          { value: 1, label: "1%" },
          { value: 2, label: "2%" },
          { value: 5, label: "5%" },
          { value: 10, label: "10%" },
          { value: 20, label: "20%" },
        ]}
        .value=${String(this.userSettings.attackRatioIncrement())}
        @change=${this.changeAttackRatioIncrement}
      ></setting-select>

      <setting-slider
        label="${translateText("user_setting.nuke_alliance_safety_label")}"
        description="${translateText("user_setting.nuke_alliance_safety_desc")}"
        min="0"
        max="30"
        .value=${this.userSettings.nukeAllianceSafetyDuration()}
        .formatValue=${(val: number) =>
          val > 0
            ? translateText("user_setting.nuke_alliance_safety_duration", {
                count: val,
                seconds: (val / 10).toFixed(1),
              })
            : translateText("user_setting.off")}
        @change=${this.sliderNukeAllianceSafetyDuration}
      ></setting-slider>

      ${this.showEasterEggSettings
        ? html`
            <setting-slider
              label="${translateText(
                "user_setting.easter_writing_speed_label",
              )}"
              description="${translateText(
                "user_setting.easter_writing_speed_desc",
              )}"
              min="0"
              max="100"
              value="40"
              easter="true"
              @change=${(e: CustomEvent) => {
                const value = e.detail?.value;
                if (value !== undefined) {
                  console.log("Changed:", value);
                } else {
                  console.warn("Slider event missing detail.value", e);
                }
              }}
            ></setting-slider>

            <setting-number
              label="${translateText("user_setting.easter_bug_count_label")}"
              description="${translateText(
                "user_setting.easter_bug_count_desc",
              )}"
              value="100"
              min="0"
              max="1000"
              easter="true"
              @change=${(e: CustomEvent) => {
                const value = e.detail?.value;
                if (value !== undefined) {
                  console.log("Changed:", value);
                } else {
                  console.warn("Slider event missing detail.value", e);
                }
              }}
            ></setting-number>
          `
        : null}
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    window.addEventListener("keydown", this.handleEasterEggKey);
    // Keybinds are editable from either instance and were only read in
    // connectedCallback, so re-read them or the other one renders stale.
    this.loadKeybindsFromStorage();
    if (typeof args?.onReturn === "function") {
      this.onReturn = args.onReturn as () => void;
    }
  }
}
