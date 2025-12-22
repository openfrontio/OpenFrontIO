import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/Difficulties";
import "./components/Maps";

@customElement("help-modal")
export class HelpModal extends LitElement {
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
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
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

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

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
    return html`<span class="key">${label}</span>`;
  }

  render() {
    const keybinds = this.keybinds;

    return html`
      <o-modal
        id="helpModal"
        title="Instructions"
        translationKey="main.instructions"
      >
        <div class="flex flex-col items-center">
          <div class="text-center text-2xl font-bold mb-4">
            ${translateText("help_modal.hotkeys")}
          </div>
          <table>
            <thead>
              <tr>
                <th>${translateText("help_modal.table_key")}</th>
                <th>${translateText("help_modal.table_action")}</th>
              </tr>
            </thead>
            <tbody class="text-left">
              <tr>
                <td>${this.renderKey(keybinds.toggleView)}</td>
                <td>${translateText("help_modal.action_alt_view")}</td>
              </tr>
              <tr>
                <td>
                  <div class="scroll-combo-horizontal">
                    ${this.renderKey(keybinds.shiftKey)}
                    <span class="plus">+</span>
                    <div class="mouse-shell alt-left-click">
                      <div class="mouse-left-corner"></div>
                      <div class="mouse-wheel"></div>
                    </div>
                  </div>
                </td>
                <td>${translateText("help_modal.action_attack_altclick")}</td>
              </tr>
              <tr>
                <td>
                  <div class="scroll-combo-horizontal">
                    ${this.renderKey(keybinds.modifierKey)}
                    <span class="plus">+</span>
                    <div class="mouse-shell alt-left-click">
                      <div class="mouse-left-corner"></div>
                      <div class="mouse-wheel"></div>
                    </div>
                  </div>
                </td>
                <td>${translateText("help_modal.action_build")}</td>
              </tr>
              <tr>
                <td>
                  <div class="scroll-combo-horizontal">
                    ${this.renderKey(keybinds.altKey)}
                    <span class="plus">+</span>
                    <div class="mouse-shell alt-left-click">
                      <div class="mouse-left-corner"></div>
                      <div class="mouse-wheel"></div>
                    </div>
                  </div>
                </td>
                <td>${translateText("help_modal.action_emote")}</td>
              </tr>
              <tr>
                <td>${this.renderKey(keybinds.centerCamera)}</td>
                <td>${translateText("help_modal.action_center")}</td>
              </tr>
              <tr>
                <td>
                  ${this.renderKey(keybinds.zoomOut)} /
                  ${this.renderKey(keybinds.zoomIn)}
                </td>
                <td>${translateText("help_modal.action_zoom")}</td>
              </tr>
              <tr>
                <td>
                  ${this.renderKey(keybinds.moveUp)}
                  ${this.renderKey(keybinds.moveLeft)}
                  ${this.renderKey(keybinds.moveDown)}
                  ${this.renderKey(keybinds.moveRight)}
                </td>
                <td>${translateText("help_modal.action_move_camera")}</td>
              </tr>
              <tr>
                <td>
                  ${this.renderKey(keybinds.attackRatioDown)} /
                  ${this.renderKey(keybinds.attackRatioUp)}
                </td>
                <td>${translateText("help_modal.action_ratio_change")}</td>
              </tr>
              <tr>
                <td>
                  <div class="scroll-combo-horizontal">
                    ${this.renderKey(keybinds.shiftKey)}
                    <span class="plus">+</span>
                    <div class="mouse-with-arrows">
                      <div class="mouse-shell">
                        <div class="mouse-wheel" id="highlighted-wheel"></div>
                      </div>
                      <div class="mouse-arrows-side">
                        <div class="arrow">↑</div>
                        <div class="arrow">↓</div>
                      </div>
                    </div>
                  </div>
                </td>
                <td>${translateText("help_modal.action_ratio_change")}</td>
              </tr>
              <tr>
                <td>
                  ${this.renderKey(keybinds.altKey)} +
                  ${this.renderKey(keybinds.resetGfx)}
                </td>
                <td>${translateText("help_modal.action_reset_gfx")}</td>
              </tr>
              <tr>
                <td>
                  <div class="mouse-shell">
                    <div class="mouse-wheel" id="highlighted-wheel"></div>
                  </div>
                </td>
                <td>${translateText("help_modal.action_auto_upgrade")}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="text-2xl font-bold text-center mb-4">
          ${translateText("help_modal.ui_section")}
        </div>
        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div class="text-gray-300 font-bold">
              ${translateText("help_modal.ui_leaderboard")}
            </div>
            <img
              src="/images/helpModal/leaderboard2.webp"
              alt="Leaderboard"
              title="Leaderboard"
              class="default-image"
              loading="lazy"
            />
          </div>
          <div>
            <p>${translateText("help_modal.ui_leaderboard_desc")}</p>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center w-full md:w-[80%]">
            <div class="text-gray-300 font-bold">
              ${translateText("help_modal.ui_control")}
            </div>
            <img
              src="/images/helpModal/controlPanel.webp"
              alt="Control panel"
              title="Control panel"
              class="default-image"
              loading="lazy"
            />
          </div>
          <div>
            <p class="mb-4">${translateText("help_modal.ui_control_desc")}</p>
            <ul>
              <li class="mb-4">${translateText("help_modal.ui_gold")}</li>
              <li class="mb-4">
                ${translateText("help_modal.ui_attack_ratio")}
              </li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div class="text-gray-300 font-bold">
              ${translateText("help_modal.ui_events")}
            </div>
            <div class="flex flex-col gap-4">
              <img
                src="/images/helpModal/eventsPanel.webp"
                alt="Event panel"
                title="Event panel"
                class="default-image"
                loading="lazy"
              />
              <img
                src="/images/helpModal/eventsPanelAttack.webp"
                alt="Event panel"
                title="Event panel"
                class="default-image"
                loading="lazy"
              />
            </div>
          </div>
          <div>
            <p class="mb-4">${translateText("help_modal.ui_events_desc")}</p>
            <ul>
              <li class="mb-4">
                ${translateText("help_modal.ui_events_alliance")}
              </li>
              <li class="mb-4">
                ${translateText("help_modal.ui_events_attack")}
              </li>
              <li class="mb-4">
                ${translateText("help_modal.ui_events_quickchat")}
              </li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div class="text-gray-300 font-bold">
              ${translateText("help_modal.ui_options")}
            </div>
            <img
              src="/images/helpModal/options2.webp"
              alt="Options"
              title="Options"
              class="default-image"
              loading="lazy"
            />
          </div>
          <div>
            <p class="mb-4">${translateText("help_modal.ui_options_desc")}</p>
            <ul>
              <li class="mb-4">${translateText("help_modal.option_pause")}</li>
              <li class="mb-4">${translateText("help_modal.option_timer")}</li>
              <li class="mb-4">${translateText("help_modal.option_exit")}</li>
              <li class="mb-4">
                ${translateText("help_modal.option_settings")}
              </li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div class="text-gray-300 font-bold">
              ${translateText("help_modal.ui_playeroverlay")}
            </div>
            <img
              src="/images/helpModal/playerInfoOverlay.webp"
              alt="Player info overlay"
              title="Player info overlay"
              class="default-image"
              loading="lazy"
            />
          </div>
          <div>
            <p class="mb-4">
              ${translateText("help_modal.ui_playeroverlay_desc")}
            </p>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="text-2xl font-bold mb-4 text-center">
          ${translateText("help_modal.radial_title")}
        </div>

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col gap-4">
            <img
              src="/images/helpModal/radialMenu2.webp"
              alt="Radial menu"
              title="Radial menu"
              class="default-image"
              loading="lazy"
            />
            <img
              src="/images/helpModal/radialMenuAlly.webp"
              alt="Radial menu ally"
              title="Radial menu ally"
              class="default-image"
              loading="lazy"
            />
          </div>
          <div>
            <p class="mb-4">${translateText("help_modal.radial_desc")}</p>
            <ul>
              <li class="mb-4">
                <div class="inline-block icon build-icon"></div>
                <span>${translateText("help_modal.radial_build")}</span>
              </li>
              <li class="mb-4">
                <img
                  src="/images/InfoIcon.svg"
                  class="inline-block icon"
                  style="fill: white; background: transparent;"
                  loading="lazy"
                />
                <span>${translateText("help_modal.radial_info")}</span>
              </li>
              <li class="mb-4">
                <div class="inline-block icon boat-icon"></div>
                <span>${translateText("help_modal.radial_boat")}</span>
              </li>
              <li class="mb-4">
                <div class="inline-block icon alliance-icon"></div>
                <span>${translateText("help_modal.info_alliance")}</span>
              </li>
              <li class="mb-4">
                <div class="inline-block icon betray-icon"></div>
                <span>${translateText("help_modal.ally_betray")}</span>
              </li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div>
          <div class="text-2xl font-bold mb-4 text-center">
            ${translateText("help_modal.info_title")}
          </div>

          <div class="flex flex-col md:flex-row gap-4">
            <div class="flex flex-col items-center w-full md:w-[62%]">
              <div class="text-gray-300 font-bold">
                ${translateText("help_modal.info_enemy_panel")}
              </div>
              <img
                src="/images/helpModal/infoMenu2.webp"
                alt="Enemy info panel"
                title="Enemy info panel"
                class="info-panel-img"
                loading="lazy"
              />
            </div>
            <div class="pt-4">
              <p class="mb-4">${translateText("help_modal.info_enemy_desc")}</p>
              <ul>
                <li class="mb-4">
                  <div class="inline-block icon chat-icon"></div>
                  <span>${translateText("help_modal.info_chat")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon target-icon"></div>
                  <span>${translateText("help_modal.info_target")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon alliance-icon"></div>
                  <span>${translateText("help_modal.info_alliance")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon emoji-icon"></div>
                  <span>${translateText("help_modal.info_emoji")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon">
                    <img src="/images/helpModal/stopTrading.webp" />
                  </div>
                  <span>${translateText("help_modal.info_trade")}</span>
                </li>
              </ul>
            </div>
          </div>

          <hr class="mt-6 mb-4" />

          <div class="flex flex-col md:flex-row gap-4">
            <div class="flex flex-col items-center w-full md:w-[62%]">
              <div class="text-gray-300 font-bold">
                ${translateText("help_modal.info_ally_panel")}
              </div>
              <img
                src="/images/helpModal/infoMenu2Ally.webp"
                alt="Ally info panel"
                title="Ally info panel"
                class="info-panel-img"
                loading="lazy"
              />
            </div>
            <div class="pt-4">
              <p class="mb-4">${translateText("help_modal.info_ally_desc")}</p>
              <ul>
                <li class="mb-4">
                  <div class="inline-block icon betray-icon"></div>
                  <span>${translateText("help_modal.ally_betray")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon donate-icon"></div>
                  <span>${translateText("help_modal.ally_donate")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon donate-gold-icon"></div>
                  <span>${translateText("help_modal.ally_donate_gold")}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div>
          <div class="text-2xl font-bold mb-4 text-center">
            ${translateText("help_modal.build_menu_title")}
          </div>
          <p class="mb-4">${translateText("help_modal.build_menu_desc")}</p>
          <table>
            <thead>
              <tr>
                <th>${translateText("help_modal.build_name")}</th>
                <th>${translateText("help_modal.build_icon")}</th>
                <th>${translateText("help_modal.build_desc")}</th>
              </tr>
            </thead>
            <tbody class="text-left">
              <tr>
                <td>${translateText("help_modal.build_city")}</td>
                <td><div class="icon city-icon"></div></td>
                <td>${translateText("help_modal.build_city_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_defense")}</td>
                <td><div class="icon defense-post-icon"></div></td>
                <td>${translateText("help_modal.build_defense_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_port")}</td>
                <td><div class="icon port-icon"></div></td>
                <td>${translateText("help_modal.build_port_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_factory")}</td>
                <td><div class="icon factory-icon"></div></td>
                <td>${translateText("help_modal.build_factory_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_warship")}</td>
                <td><div class="icon warship-icon"></div></td>
                <td>${translateText("help_modal.build_warship_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_silo")}</td>
                <td><div class="icon missile-silo-icon"></div></td>
                <td>${translateText("help_modal.build_silo_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_sam")}</td>
                <td><div class="icon sam-launcher-icon"></div></td>
                <td>${translateText("help_modal.build_sam_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_atom")}</td>
                <td><div class="icon atom-bomb-icon"></div></td>
                <td>${translateText("help_modal.build_atom_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_hydrogen")}</td>
                <td><div class="icon hydrogen-bomb-icon"></div></td>
                <td>${translateText("help_modal.build_hydrogen_desc")}</td>
              </tr>
              <tr>
                <td>${translateText("help_modal.build_mirv")}</td>
                <td><div class="icon mirv-icon"></div></td>
                <td>${translateText("help_modal.build_mirv_desc")}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr class="mt-6 mb-4" />

        <div>
          <div class="text-2xl mb-4 font-bold text-center">
            ${translateText("help_modal.player_icons")}
          </div>
          <p class="mb-2">${translateText("help_modal.icon_desc")}</p>

          <div class="flex flex-col md:flex-row gap-4 mt-4">
            <div
              class="flex flex-col items-center w-full md:w-1/3 mb-2 md:mb-0"
            >
              <div
                class="text-gray-300 flex flex-col justify-start min-h-[3rem] w-full px-2 mb-1"
              >
                ${translateText("help_modal.icon_crown")}
              </div>
              <img
                src="/images/helpModal/crown.webp"
                alt="Number 1 player"
                title="Number 1 player"
                class="player-icon-img w-full"
                loading="lazy"
              />
            </div>

            <div
              class="flex flex-col items-center w-full md:w-1/3 mb-2 md:mb-0"
            >
              <div
                class="text-gray-300 flex flex-col justify-start min-h-[3rem] w-full px-2 mb-1"
              >
                ${translateText("help_modal.icon_traitor")}
              </div>
              <img
                src="/images/helpModal/traitor2.webp"
                alt="Traitor"
                title="Traitor"
                class="player-icon-img w-full"
                loading="lazy"
              />
            </div>

            <div
              class="flex flex-col items-center w-full md:w-1/3 mb-2 md:mb-0"
            >
              <div
                class="text-gray-300 flex flex-col justify-start min-h-[3rem] w-full px-2 mb-1"
              >
                ${translateText("help_modal.icon_ally")}
              </div>
              <img
                src="/images/helpModal/ally2.webp"
                alt="Ally"
                title="Ally"
                class="player-icon-img w-full"
                loading="lazy"
              />
            </div>
          </div>

          <div class="flex flex-col md:flex-row gap-4 mt-4 md:justify-center">
            <div
              class="flex flex-col items-center w-full md:w-1/3 mb-2 md:mb-0"
            >
              <div
                class="text-gray-300 flex flex-col justify-start min-h-[3rem] w-full px-2 mb-1"
              >
                ${translateText("help_modal.icon_embargo")}
              </div>
              <img
                src="/images/helpModal/embargo.webp"
                alt="Stopped trading"
                title="Stopped trading"
                class="player-icon-img w-full"
                loading="lazy"
              />
            </div>

            <div
              class="flex flex-col items-center w-full md:w-1/3 mb-2 md:mb-0"
            >
              <div
                class="text-gray-300 flex flex-col justify-start min-h-[3rem] w-full px-2 mb-1"
              >
                ${translateText("help_modal.icon_request")}
              </div>
              <img
                src="/images/helpModal/allianceRequest.webp"
                alt="Alliance Request"
                title="Alliance Request"
                class="player-icon-img w-full"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  public open() {
    this.keybinds = this.getKeybinds();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
