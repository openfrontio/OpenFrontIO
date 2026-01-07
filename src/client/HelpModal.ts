import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/Difficulties";
import "./components/Maps";

@customElement("help-modal")
export class HelpModal extends LitElement {
  @property({ type: Boolean }) inline = false;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private keybinds: Record<string, string> = this.getKeybinds();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private isKeybindObject(v: unknown): v is { value: string } {
    return (
      typeof v === "object" &&
      v !== null &&
      "value" in v &&
      typeof (v as any).value === "string"
    );
  }

  private getKeybinds(): Record<string, string> {
    let saved: Record<string, string> = {};
    try {
      const parsed = JSON.parse(
        localStorage.getItem("settings.keybinds") ?? "{}",
      );
      saved = Object.fromEntries(
        Object.entries(parsed)
          .map(([k, v]) => {
            if (this.isKeybindObject(v)) return [k, v.value];
            if (typeof v === "string") return [k, v];
            return [k, undefined];
          })
          .filter(([, v]) => typeof v === "string" && v !== "Null"),
      ) as Record<string, string>;
    } catch (e) {
      console.warn("Invalid keybinds JSON:", e);
    }

    const isMac = /Mac/.test(navigator.userAgent);
    return {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "KeyT",
      attackRatioUp: "KeyY",
      shiftKey: "ShiftLeft",
      modifierKey: isMac ? "MetaLeft" : "ControlLeft",
      altKey: "AltLeft",
      resetGfx: "KeyR",
      ...saved,
    };
  }

  private getKeyLabel(code: string): string {
    if (!code) return "";

    const specialLabels: Record<string, string> = {
      ShiftLeft: "⇧ Shift",
      ShiftRight: "⇧ Shift",
      ControlLeft: "Ctrl",
      ControlRight: "Ctrl",
      AltLeft: "Alt",
      AltRight: "Alt",
      MetaLeft: "⌘",
      MetaRight: "⌘",
      Space: "Space",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
    };

    if (specialLabels[code]) return specialLabels[code];
    if (code.startsWith("Key") && code.length === 4) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;

    return code;
  }

  private renderKey(code: string) {
    const label = this.getKeyLabel(code);
    return html`<span
      class="inline-block min-w-[32px] text-center px-2 py-1 rounded bg-[#2a2a2a] border-b-2 border-[#1a1a1a] text-white font-mono text-xs font-bold mx-0.5"
      >${label}</span
    >`;
  }

  render() {
    const keybinds = this.keybinds;

    const content = html`
      <div
        class="h-full flex flex-col ${this.inline
          ? "bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-6 shadow-xl"
          : ""}"
      >
        <div class="flex items-center mb-6 pb-2 border-b border-white/10 gap-2">
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${this.close}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label="Back"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <span
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest"
            >
              ${translateText("main.instructions")}
            </span>
          </div>
        </div>

        <div
          class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pr-4 space-y-8"
        >
          <!-- Hotkeys Section -->
          <section
            class="bg-white/5 rounded-xl border border-white/10 overflow-hidden"
          >
            <div class="p-4 bg-white/5 border-b border-white/5">
              <h2
                class="text-lg font-bold text-white flex items-center gap-2 uppercase tracking-wide"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-5 h-5 text-blue-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                  <path d="M6 8h.001"></path>
                  <path d="M10 8h.001"></path>
                  <path d="M14 8h.001"></path>
                  <path d="M18 8h.001"></path>
                  <path d="M6 12h.001"></path>
                  <path d="M10 12h.001"></path>
                  <path d="M14 12h.001"></path>
                  <path d="M18 12h.001"></path>
                  <path d="M6 16h12"></path>
                </svg>
                ${translateText("help_modal.hotkeys")}
              </h2>
            </div>
            <div class="p-4 overflow-x-auto">
              <table class="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr
                    class="text-white/40 text-xs uppercase tracking-wider text-left"
                  >
                    <th class="pb-2 pl-4">
                      ${translateText("help_modal.table_key")}
                    </th>
                    <th class="pb-2">
                      ${translateText("help_modal.table_action")}
                    </th>
                  </tr>
                </thead>
                <tbody class="text-white/80">
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      ${this.renderKey(keybinds.toggleView)}
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_alt_view")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      ${this.renderKey("KeyU")}
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.bomb_direction")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="inline-flex items-center gap-2">
                        ${this.renderKey(keybinds.shiftKey)}
                        <span class="text-white/40 font-bold">+</span>
                        <div
                          class="w-5 h-8 border border-white/40 rounded-full relative"
                        >
                          <div
                            class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"
                          ></div>
                          <div
                            class="w-0.5 h-1.5 bg-white/40 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_attack_altclick")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="inline-flex items-center gap-2">
                        ${this.renderKey(keybinds.modifierKey)}
                        <span class="text-white/40 font-bold">+</span>
                        <div
                          class="w-5 h-8 border border-white/40 rounded-full relative"
                        >
                          <div
                            class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"
                          ></div>
                          <div
                            class="w-0.5 h-1.5 bg-white/40 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_build")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="inline-flex items-center gap-2">
                        ${this.renderKey(keybinds.altKey)}
                        <span class="text-white/40 font-bold">+</span>
                        <div
                          class="w-5 h-8 border border-white/40 rounded-full relative"
                        >
                          <div
                            class="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full"
                          ></div>
                          <div
                            class="w-0.5 h-1.5 bg-white/40 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_emote")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      ${this.renderKey(keybinds.centerCamera)}
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_center")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="flex flex-wrap gap-2">
                        ${this.renderKey(keybinds.zoomOut)}
                        ${this.renderKey(keybinds.zoomIn)}
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_zoom")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="flex flex-wrap gap-1 max-w-[200px]">
                        ${this.renderKey(keybinds.moveUp)}
                        ${this.renderKey(keybinds.moveLeft)}
                        ${this.renderKey(keybinds.moveDown)}
                        ${this.renderKey(keybinds.moveRight)}
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_move_camera")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="flex flex-wrap gap-2">
                        ${this.renderKey(keybinds.attackRatioDown)}
                        ${this.renderKey(keybinds.attackRatioUp)}
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_ratio_change")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="inline-flex items-center gap-2">
                        ${this.renderKey(keybinds.shiftKey)}
                        <span class="text-white/40 font-bold">+</span>
                        <div class="flex items-center gap-1">
                          <div
                            class="w-5 h-8 border border-white/40 rounded-full relative"
                          >
                            <div
                              class="w-0.5 h-2 bg-red-400 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                            ></div>
                          </div>
                          <div class="flex flex-col text-[10px] text-white/50">
                            <span>↑</span>
                            <span>↓</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_ratio_change")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div class="inline-flex items-center gap-2">
                        ${this.renderKey(keybinds.altKey)}
                        <span class="text-white/40 font-bold">+</span>
                        ${this.renderKey(keybinds.resetGfx)}
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_reset_gfx")}
                    </td>
                  </tr>
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5">
                      <div
                        class="w-5 h-8 border border-white/40 rounded-full relative"
                      >
                        <div
                          class="w-0.5 h-2 bg-red-400 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2"
                        ></div>
                      </div>
                    </td>
                    <td class="py-3 border-b border-white/5 text-white/70">
                      ${translateText("help_modal.action_auto_upgrade")}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- UI Interface Section -->
          <section class="mb-8 mt-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="9" y1="21" x2="9" y2="9"></line>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.ui_section")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div class="grid grid-cols-1 gap-6">
              <!-- Leaderboard -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_leaderboard")}</span
                  >
                  <img
                    src="/images/helpModal/leaderboard2.webp"
                    alt="Leaderboard"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div
                  class="flex items-center text-white/70 text-sm leading-relaxed"
                >
                  <p>${translateText("help_modal.ui_leaderboard_desc")}</p>
                </div>
              </div>

              <!-- Control Panel -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_control")}</span
                  >
                  <img
                    src="/images/helpModal/controlPanel.webp"
                    alt="Control Panel"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_control_desc")}
                  </p>
                  <ul class="space-y-2 list-disc pl-4 text-white/60">
                    <li>${translateText("help_modal.ui_gold")}</li>
                    <li>${translateText("help_modal.ui_attack_ratio")}</li>
                  </ul>
                </div>
              </div>

              <!-- Events Panel -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_events")}</span
                  >
                  <div class="flex flex-col gap-2">
                    <img
                      src="/images/helpModal/eventsPanel.webp"
                      alt="Events"
                      class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                      loading="lazy"
                    />
                    <img
                      src="/images/helpModal/eventsPanelAttack.webp"
                      alt="Events Attack"
                      class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_events_desc")}
                  </p>
                  <ul class="space-y-2 list-disc pl-4 text-white/60">
                    <li>${translateText("help_modal.ui_events_alliance")}</li>
                    <li>${translateText("help_modal.ui_events_attack")}</li>
                    <li>${translateText("help_modal.ui_events_quickchat")}</li>
                  </ul>
                </div>
              </div>

              <!-- Options -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_options")}</span
                  >
                  <img
                    src="/images/helpModal/options2.webp"
                    alt="Options"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div class="flex flex-col justify-center text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.ui_options_desc")}
                  </p>
                  <ul class="space-y-2 list-disc pl-4 text-white/60">
                    <li>${translateText("help_modal.option_pause")}</li>
                    <li>${translateText("help_modal.option_timer")}</li>
                    <li>${translateText("help_modal.option_exit")}</li>
                    <li>${translateText("help_modal.option_settings")}</li>
                  </ul>
                </div>
              </div>

              <!-- Player Overlay -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3 shrink-0">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.ui_playeroverlay")}</span
                  >
                  <img
                    src="/images/helpModal/playerInfoOverlay.webp"
                    alt="Player Info"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                    loading="lazy"
                  />
                </div>
                <div
                  class="flex items-center text-white/70 text-sm leading-relaxed"
                >
                  <p>${translateText("help_modal.ui_playeroverlay_desc")}</p>
                </div>
              </div>
            </div>
          </section>

          <!-- Radial Menu Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.radial_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div
              class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col md:flex-row gap-6 hover:bg-white/5 transition-colors"
            >
              <div class="flex flex-col gap-4 shrink-0">
                <img
                  src="/images/helpModal/radialMenu2.webp"
                  alt="Radial Menu"
                  class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                  loading="lazy"
                />
                <img
                  src="/images/helpModal/radialMenuAlly.webp"
                  alt="Radial Menu Ally"
                  class="rounded-lg shadow-lg border border-white/20 max-w-[200px]"
                  loading="lazy"
                />
              </div>
              <div class="text-white/70 text-sm">
                <p class="mb-4 leading-relaxed">
                  ${translateText("help_modal.radial_desc")}
                </p>
                <ul class="space-y-3">
                  <li class="flex items-center gap-3">
                    <div
                      class="icon build-icon scale-75 filter grayscale brightness-200"
                    ></div>
                    <span>${translateText("help_modal.radial_build")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <img
                      src="/images/InfoIcon.svg"
                      class="w-5 h-5 opacity-80"
                      loading="lazy"
                    />
                    <span>${translateText("help_modal.radial_info")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <div
                      class="icon boat-icon scale-75 filter grayscale brightness-200"
                    ></div>
                    <span>${translateText("help_modal.radial_boat")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <div
                      class="icon alliance-icon scale-75 filter grayscale brightness-200"
                    ></div>
                    <span>${translateText("help_modal.info_alliance")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <div
                      class="icon betray-icon scale-75 filter grayscale brightness-200"
                    ></div>
                    <span>${translateText("help_modal.ally_betray")}</span>
                  </li>
                  <li class="flex items-center gap-3">
                    <div
                      class="icon donate-icon scale-75 filter grayscale brightness-200"
                    ></div>
                    <span
                      >${translateText("help_modal.radial_donate_troops")}</span
                    >
                  </li>
                  <li class="flex items-center gap-3">
                    <div
                      class="icon donate-gold-icon scale-75 filter grayscale brightness-200"
                    ></div>
                    <span
                      >${translateText("help_modal.radial_donate_gold")}</span
                    >
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <!-- Info/Ally Panels Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.info_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Enemy Info -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.info_enemy_panel")}</span
                  >
                  <img
                    src="/images/helpModal/infoMenu2.webp"
                    alt="Enemy Info"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[240px]"
                    loading="lazy"
                  />
                </div>
                <div class="text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.info_enemy_desc")}
                  </p>
                  <ul class="space-y-3">
                    <li class="flex items-center gap-3">
                      <div
                        class="icon chat-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span>${translateText("help_modal.info_chat")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <div
                        class="icon target-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span>${translateText("help_modal.info_target")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <div
                        class="icon alliance-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span>${translateText("help_modal.info_alliance")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <div
                        class="icon emoji-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span>${translateText("help_modal.info_emoji")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <div
                        class="icon flex items-center justify-center w-8 h-8 opacity-80"
                      >
                        <img
                          src="/images/helpModal/stopTrading.webp"
                          class="w-full h-full object-contain"
                        />
                      </div>
                      <span>${translateText("help_modal.info_trade")}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Ally Info -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-6 hover:bg-white/5 transition-colors"
              >
                <div class="flex flex-col items-center gap-3">
                  <span
                    class="text-xs font-bold uppercase tracking-wider text-blue-300"
                    >${translateText("help_modal.info_ally_panel")}</span
                  >
                  <img
                    src="/images/helpModal/infoMenu2Ally.webp"
                    alt="Ally Info"
                    class="rounded-lg shadow-lg border border-white/20 max-w-[240px]"
                    loading="lazy"
                  />
                </div>
                <div class="text-white/70 text-sm">
                  <p class="mb-4 leading-relaxed">
                    ${translateText("help_modal.info_ally_desc")}
                  </p>
                  <ul class="space-y-3">
                    <li class="flex items-center gap-3">
                      <div
                        class="icon betray-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span>${translateText("help_modal.ally_betray")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <div
                        class="icon donate-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span>${translateText("help_modal.ally_donate")}</span>
                    </li>
                    <li class="flex items-center gap-3">
                      <div
                        class="icon donate-gold-icon scale-75 filter grayscale brightness-200"
                      ></div>
                      <span
                        >${translateText("help_modal.ally_donate_gold")}</span
                      >
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <!-- Build Menu Section -->
          <section class="mb-8">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path>
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.build_menu_title")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <p class="mb-4 text-white/70 text-sm">
              ${translateText("help_modal.build_menu_desc")}
            </p>

            <div class="overflow-hidden rounded-xl border border-white/10">
              <table class="w-full border-collapse">
                <thead class="bg-white/10">
                  <tr>
                    <th
                      class="py-3 pl-4 text-left text-xs font-bold uppercase tracking-wider text-blue-300 w-[20%]"
                    >
                      ${translateText("help_modal.build_name")}
                    </th>
                    <th
                      class="py-3 text-left text-xs font-bold uppercase tracking-wider text-blue-300 w-[15%]"
                    >
                      ${translateText("help_modal.build_icon")}
                    </th>
                    <th
                      class="py-3 text-left text-xs font-bold uppercase tracking-wider text-blue-300"
                    >
                      ${translateText("help_modal.build_desc")}
                    </th>
                  </tr>
                </thead>
                <tbody class="text-white/80">
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_city")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon city-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_city_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_defense")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon defense-post-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_defense_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_port")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon port-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_port_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_factory")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon factory-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_factory_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_warship")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon warship-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_warship_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_silo")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon missile-silo-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_silo_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_sam")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon sam-launcher-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_sam_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_atom")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon atom-bomb-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_atom_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_hydrogen")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon hydrogen-bomb-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_hydrogen_desc")}
                    </td>
                  </tr>
                  <tr class="bg-white/5 hover:bg-white/10 transition-colors">
                    <td class="py-3 pl-4 border-b border-white/5 font-medium">
                      ${translateText("help_modal.build_mirv")}
                    </td>
                    <td class="py-3 border-b border-white/5">
                      <div
                        class="icon mirv-icon scale-75 transform-origin-left filter grayscale brightness-200"
                      ></div>
                    </td>
                    <td
                      class="py-3 border-b border-white/5 text-white/60 text-sm"
                    >
                      ${translateText("help_modal.build_mirv_desc")}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Player Icons Section -->
          <section class="mb-4">
            <div class="flex items-center gap-3 mb-6">
              <div class="text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <h3
                class="text-xl font-bold uppercase tracking-widest text-white/90"
              >
                ${translateText("help_modal.player_icons")}
              </h3>
              <div
                class="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"
              ></div>
            </div>

            <p class="mb-6 text-white/70 text-sm">
              ${translateText("help_modal.icon_desc")}
            </p>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
              <!-- Crown -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <span
                  class="text-xs font-bold uppercase tracking-wider text-blue-300 text-center"
                >
                  ${translateText("help_modal.icon_crown")}
                </span>
                <img
                  src="/images/helpModal/crown.webp"
                  alt="Rank 1"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
              </div>

              <!-- Traitor -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <span
                  class="text-xs font-bold uppercase tracking-wider text-blue-300 text-center"
                >
                  ${translateText("help_modal.icon_traitor")}
                </span>
                <img
                  src="/images/helpModal/traitor2.webp"
                  alt="Traitor"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
              </div>

              <!-- Ally -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <span
                  class="text-xs font-bold uppercase tracking-wider text-blue-300 text-center"
                >
                  ${translateText("help_modal.icon_ally")}
                </span>
                <img
                  src="/images/helpModal/ally2.webp"
                  alt="Ally"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
              </div>

              <!-- Embargo -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <span
                  class="text-xs font-bold uppercase tracking-wider text-blue-300 text-center"
                >
                  ${translateText("help_modal.icon_embargo")}
                </span>
                <img
                  src="/images/helpModal/embargo.webp"
                  alt="Embargo"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
              </div>

              <!-- Alliance Request -->
              <div
                class="bg-black/20 rounded-xl border border-white/10 p-4 flex flex-col items-center gap-3 hover:bg-white/5 transition-colors"
              >
                <span
                  class="text-xs font-bold uppercase tracking-wider text-blue-300 text-center"
                >
                  ${translateText("help_modal.icon_request")}
                </span>
                <img
                  src="/images/helpModal/allianceRequest.webp"
                  alt="Request"
                  class="rounded shadow-lg border border-white/10 h-24 w-auto object-contain"
                  loading="lazy"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="helpModal"
        title="Instructions"
        translationKey="main.instructions"
        ?inline=${this.inline}
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }

  public open() {
    this.keybinds = this.getKeybinds();
    this.modalEl?.open();
  }

  public close() {
    if (this.inline) {
      if ((window as any).showPage) (window as any).showPage("page-play");
    } else {
      this.modalEl?.close();
    }
  }
}
