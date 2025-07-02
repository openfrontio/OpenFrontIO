import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

type TabType =
  | "hotkeys"
  | "gameui"
  | "control"
  | "event"
  | "options"
  | "player-info"
  | "radial"
  | "info"
  | "ally"
  | "build"
  | "icons";

@customElement("help-modal")
export class HelpModal extends LitElement {
  @state() private activeTab: TabType = "hotkeys";
  @state() private isModalOpen = false;

  private get tabs() {
    return [
      {
        id: "hotkeys",
        label: translateText("help_modal.hotkeys"),
        icon: "icons/keyboard.svg",
      },
      {
        id: "gameui",
        label: translateText("help_modal.ui_leaderboard"),
        icon: "icons/panels-top-left.svg",
      },
      {
        id: "control",
        label: translateText("help_modal.ui_control"),
        icon: "icons/sliders-horizontal.svg",
      },
      {
        id: "event",
        label: translateText("help_modal.ui_events"),
        icon: "icons/sliders-horizontal.svg",
      },
      {
        id: "options",
        label: translateText("help_modal.ui_options"),
        icon: "icons/settings.svg",
      },
      {
        id: "player-info",
        label: translateText("help_modal.ui_playeroverlay"),
        icon: "icons/info.svg",
      },
      {
        id: "radial",
        label: translateText("help_modal.radial_title"),
        icon: "icons/menu.svg",
      },
      {
        id: "info",
        label: translateText("help_modal.info_title"),
        icon: "icons/info.svg",
      },
      {
        id: "ally",
        label: translateText("help_modal.info_ally_panel"),
        icon: "icons/users.svg",
      },
      {
        id: "build",
        label: translateText("help_modal.build_menu_title"),
        icon: "icons/building.svg",
      },
      {
        id: "icons",
        label: translateText("help_modal.player_icons"),
        icon: "icons/crown.svg",
      },
    ];
  }

  private get hotkeys() {
    return [
      { key: "Space", action: translateText("help_modal.action_alt_view") },
      {
        key: "Shift + Click",
        action: translateText("help_modal.action_attack_altclick"),
      },
      { key: "Ctrl + Click", action: translateText("help_modal.action_build") },
      { key: "Alt + Click", action: translateText("help_modal.action_emote") },
      { key: "C", action: translateText("help_modal.action_center") },
      { key: "Q / E", action: translateText("help_modal.action_zoom") },
      {
        key: "W A S D",
        action: translateText("help_modal.action_move_camera"),
      },
      { key: "1 / 2", action: translateText("help_modal.action_ratio_change") },
      {
        key: "Shift + Scroll",
        action: translateText("help_modal.action_ratio_change"),
      },
      { key: "Alt + R", action: translateText("help_modal.action_reset_gfx") },
    ];
  }
  private get buildings() {
    return [
      {
        name: translateText("help_modal.build_city"),
        icon: "icons/building-2.svg",
        description: translateText("help_modal.build_city_desc"),
        cost: "125K",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_defense"),
        icon: "icons/shield.svg",
        description: translateText("help_modal.build_defense_desc"),
        cost: "50.0K",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_port"),
        icon: "icons/anchor.svg",
        description: translateText("help_modal.build_port_desc"),
        cost: "125K",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_warship"),
        icon: "icons/ship.svg",
        description: translateText("help_modal.build_warship_desc"),
        cost: "250K",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_silo"),
        icon: "icons/cylinder.svg",
        description: translateText("help_modal.build_silo_desc"),
        cost: "1.00M",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_sam"),
        icon: "icons/antenna.svg",
        description: translateText("help_modal.build_sam_desc"),
        cost: "1.50M",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_atom"),
        icon: "icons/bomb.svg",
        description: translateText("help_modal.build_atom_desc"),
        cost: "750K",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_hydrogen"),
        icon: "icons/bomb.svg",
        description: translateText("help_modal.build_hydrogen_desc"),
        cost: "5.00M",
        quantity: 0,
      },
      {
        name: translateText("help_modal.build_mirv"),
        icon: "icons/rocket.svg",
        description: translateText("help_modal.build_mirv_desc"),
        cost: "25.0M",
        quantity: 0,
      },
    ];
  }
  private get playerIcons() {
    return [
      {
        icon: "icons/crown.svg",

        description: translateText("help_modal.icon_crown"),
      },
      {
        icon: "icons/shield-ban.svg",

        description: translateText("help_modal.icon_traitor"),
      },
      {
        icon: "icons/handshake.svg",

        description: translateText("help_modal.icon_ally"),
      },
      {
        icon: "icons/circle-dollar-sign.svg",

        description: translateText("help_modal.icon_embargo"),
      },
      {
        icon: "icons/mail.svg",

        description: translateText("help_modal.icon_request"),
      },
    ];
  }
  private get infoMenuActions() {
    return [
      {
        icon: "icons/message-square-more.svg",
        description: translateText("help_modal.info_chat"),
      },
      {
        icon: "icons/circle-plus.svg",
        description: translateText("help_modal.info_target"),
      },
      {
        icon: "icons/handshake.svg",
        description: translateText("help_modal.info_alliance"),
      },
      {
        icon: "icons/smile.svg",
        description: translateText("help_modal.info_emoji"),
      },
      {
        icon: "icons/none",
        description: translateText("help_modal.info_trade"),
      },
    ];
  }
  private get allyActions() {
    return [
      {
        icon: "icons/swords.svg",

        description: translateText("help_modal.ally_betray"),
      },
      {
        icon: "icons/smile.svg",

        description: translateText("help_modal.ally_donate"),
      },
      {
        icon: "icons/smile.svg",

        description: translateText("help_modal.ally_donate_gold"),
      },
    ];
  }
  public open() {
    this.activeTab = "hotkeys";
    this.isModalOpen = true;
  }

  public close() {
    this.isModalOpen = false;
  }

  createRenderRoot() {
    return this;
  }

  private handleTabChange(tab: TabType) {
    this.activeTab = tab;
  }

  render() {
    return html`
      <o-modal
        width="large"
        .isModalOpen=${this.isModalOpen}
        .title=${translateText("main.instructions")}
        disableContentScroll
        @modal-close=${this.close}
      >
        <div class="flex h-[calc(85vh-80px)]">
          <!-- Left Side Tabs -->
          <div class="p-1 w-56 flex flex-col background-panel">
            ${this.tabs.map(
              (tab) => html`
                <button
                  class="
          flex items-center gap-2 px-4 py-3 font-pixel text-small leading-5 transition-all duration-200 text-left border-none bg-none cursor-pointer
          ${this.activeTab === tab.id
                    ? "text-textLight bg-primary hover:text-textLight hover:bg-primary"
                    : "text-textGrey hover:text-textLight hover:bg-backgroundDarkLighter"}"
                  @click=${() => this.handleTabChange(tab.id as TabType)}
                >
                  <o-icon
                    src=${tab.icon}
                    size="medium"
                    color="${this.activeTab === tab.id
                      ? "var(--text-color-white)"
                      : "var(--text-color-grey)"}"
                  ></o-icon>
                  ${tab.label}
                </button>
              `,
            )}
          </div>
          <!-- Content Area -->
          <div
            class="flex-1 p-8 overflow-y-auto background-panel custom-scrollbar"
          >
            ${this.activeTab === "hotkeys"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      Hotkeys
                    </h3>
                    ${this.hotkeys.map(
                      (hotkey) => html`
                        <div
                          class="background-panel grid grid-cols-[2fr_1fr] items-center gap-4 p-4"
                        >
                          <span class="text-textLight">${hotkey.action}</span>
                          <div class="flex gap-2 items-center justify-end">
                            ${hotkey.key.split(" + ").map(
                              (k, i, arr) => html`
                                <kbd
                                  class="text-small text-textGrey border border-borderBase px-2 py-0.5 transition-colors duration-200"
                                  >${k}</kbd
                                >
                                ${i < arr.length - 1
                                  ? html`<span> + </span>`
                                  : ""}
                              `,
                            )}
                          </div>
                        </div>
                      `,
                    )}
                  </div>
                `
              : ""}
            ${this.activeTab === "gameui"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.ui_leaderboard")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.ui_leaderboard_desc")}
                      </p>
                      <div class="mt-4 bg-backgroundDarkLighter p-4">
                        <table class="w-full">
                          <thead>
                            <tr class="text-textLight">
                              <th class="text-left">
                                ${translateText("leaderboard.rank")}
                              </th>
                              <th class="text-left">
                                ${translateText("leaderboard.player")}
                              </th>
                              <th class="text-left">
                                ${translateText("leaderboard.owned")}
                              </th>
                              <th class="text-left">
                                ${translateText("leaderboard.gold")}
                              </th>
                              <th class="text-left">
                                ${translateText("leaderboard.troops")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr class="text-textGrey">
                              <td>1</td>
                              <td>Minoan Dynasty</td>
                              <td>0.05%</td>
                              <td>1.79K</td>
                              <td>1.76K</td>
                            </tr>
                            <tr class="text-textGrey">
                              <td>2</td>
                              <td>Italian Duchy</td>
                              <td>0.04%</td>
                              <td>1.72K</td>
                              <td>1.78K</td>
                            </tr>
                            <tr class="text-textGrey">
                              <td>3</td>
                              <td>AngloSaxon Caliphate</td>
                              <td>0.04%</td>
                              <td>1.72K</td>
                              <td>1.78K</td>
                            </tr>
                            <tr class="text-textGrey">
                              <td>4</td>
                              <td>Navajo Host</td>
                              <td>0.04%</td>
                              <td>1.80K</td>
                              <td>1.73K</td>
                            </tr>
                            <tr class="text-primary">
                              <td>442</td>
                              <td>Anon69</td>
                              <td>0%</td>
                              <td>1.16K</td>
                              <td>6.23K</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "control"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.ui_control")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.ui_control_desc")}
                      </p>
                      <div class="p-6 bg-backgroundDarkLighter">
                        <div class="mb-4">
                          <div class="flex justify-between items-center mb-2">
                            <span class="text-textLight font-pixel text-small"
                              >${translateText("control_panel.pop")}</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >3.60K / 12.1K
                              <span class="text-green"> (+379)</span></span
                            >
                          </div>
                        </div>
                        <div class="mb-6">
                          <div class="flex justify-between items-center mb-2">
                            <span class="text-textLight font-pixel text-small"
                              >${translateText("control_panel.gold")}</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >245 <span class="text-green"> (+90)</span></span
                            >
                          </div>
                        </div>
                        <div class="mb-4">
                          <div
                            class="text-textLight font-pixel text-small mb-2"
                          >
                            ${translateText("control_panel.troops")} 3.38K |
                            ${translateText("control_panel.workers")} 216
                          </div>
                          <div class="relative">
                            <div
                              class="w-full h-3 bg-backgroundGrey rounded-full overflow-hidden"
                            >
                              <div
                                class="h-full bg-primary rounded-full"
                                style="width: 99%"
                              ></div>
                            </div>
                            <div
                              class="absolute top-1/2 right-2 -translate-y-1/2 w-3 h-3 bg-textLight rounded-full border-2 border-borderBase"
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div
                            class="text-textLight font-pixel text-small mb-2"
                          >
                            ${translateText("control_panel.attack_ratio")} 25%
                            (846)
                          </div>
                          <div class="relative">
                            <div
                              class="w-full h-3 bg-backgroundGrey rounded-full overflow-hidden"
                            >
                              <div
                                class="h-full bg-red rounded-full"
                                style="width: 25%"
                              ></div>
                            </div>
                            <div
                              class="absolute top-1/2 left-1/4 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-textLight rounded-full border-2 border-borderBase"
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="space-y-4">
                      <div class="p-4 background-panel">
                        <h4
                          class="font-pixel text-medium leading-7 text-textLight mb-2"
                        >
                          ${translateText("control_panel.pop")}
                        </h4>
                        <p class="text-textGrey">
                          ${translateText("help_modal.ui_pop")}
                        </p>
                      </div>
                      <div class="p-4 background-panel">
                        <h4
                          class="font-pixel text-medium leading-7 text-textLight mb-2"
                        >
                          ${translateText("control_panel.gold")}
                        </h4>
                        <p class="text-textGrey">
                          ${translateText("help_modal.ui_gold")}
                        </p>
                      </div>
                      <div class="p-4 background-panel">
                        <h4
                          class="font-pixel text-medium leading-7 text-textLight mb-2"
                        >
                          ${translateText("control_panel.troops")} &
                          ${translateText("control_panel.workers")}
                        </h4>
                        <p class="text-textGrey">
                          ${translateText("help_modal.ui_troops_workers")}
                        </p>
                      </div>
                      <div class="p-4 background-panel">
                        <h4
                          class="font-pixel text-medium leading-7 text-textLight mb-2"
                        >
                          ${translateText("control_panel.attack_ratio")}
                        </h4>
                        <p class="text-textGrey">
                          ${translateText("help_modal.ui_attack_ratio")}
                        </p>
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "event"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.ui_events")}
                    </h3>

                    <div class="background-panel p-4">
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.ui_events_desc")}
                      </p>

                      <div class=" p-4">
                        <div class="space-y-3">
                          <div
                            class="bg-backgroundDarkLighter p-3 border-l-4 border-primary"
                          >
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-primary font-title text-small"
                                >Sent Japanese Area:</span
                              >
                              <span
                                class="text-red font-title text-small cursor-pointer hover:text-red"
                                >❓</span
                              >
                            </div>
                          </div>

                          <!-- Alliance Accepted -->
                          <div
                            class="bg-backgroundDarkLighter p-3 border-l-4 border-green"
                          >
                            <div
                              class="flex items-center justify-between mb-2 text-green font-title text-small"
                            >
                              Japanese Area accepted your alliance request
                            </div>
                          </div>

                          <!-- Attack Messages -->
                          <div
                            class="bg-backgroundDarkLighter p-3 border-l-4 border-backgroundGrey"
                          >
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-textGrey font-title text-small"
                                >596 Bhutanese Sisterhood</span
                              >
                              <span
                                class="text-red font-title text-small cursor-pointer hover:text-red"
                                >❌</span
                              >
                            </div>
                          </div>

                          <div
                            class="bg-backgroundDarkLighter p-3 border-l-4 border-backgroundGrey"
                          >
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-textGrey font-title text-small"
                                >3.66K Wilderness</span
                              >
                              <span
                                class="text-red font-title text-small cursor-pointer hover:text-red"
                                >❌</span
                              >
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class=" p-4 ">
                      <div class="space-y-6">
                        <div
                          class="flex items-start gap-4 background-panel p-3"
                        >
                          <p class="text-textGrey">
                            ${translateText("help_modal.ui_events_alliance")}
                          </p>
                        </div>

                        <div
                          class="flex items-start gap-4  background-panel p-3"
                        >
                          <div>
                            <p class="text-textGrey">
                              ${translateText("help_modal.ui_events_attack")}
                            </p>
                          </div>
                        </div>

                        <div
                          class="flex items-start gap-4  background-panel p-3"
                        >
                          <div>
                            <p class="text-textGrey">
                              ${translateText("help_modal.ui_events_quickchat")}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "options"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.ui_options")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.ui_options_desc")}
                      </p>
                      <div
                        class="p-4 bg-backgroundDarkLighter max-w-sm mx-auto"
                      >
                        <div class="flex items-center justify-center gap-4">
                          <div
                            class="w-8 h-8 bg-backgroundGrey  flex items-center justify-center"
                          >
                            <o-icon
                              src="icons/play.svg"
                              size="medium"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <div
                            class="w-8 h-8 bg-backgroundGrey  flex items-center justify-center"
                          >
                            <div class="text-textLight font-pixel text-small">
                              11s
                            </div>
                          </div>
                          <div
                            class="w-8 h-8 bg-backgroundGrey  flex items-center justify-center"
                          >
                            <o-icon
                              src="icons/x.svg"
                              size="medium"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <div
                            class="w-8 h-8 bg-backgroundGrey  flex items-center justify-center"
                          >
                            <o-icon
                              src="icons/settings.svg"
                              size="medium"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="space-y-4">
                      <div class="p-4 background-panel">
                        <h4
                          class="font-pixel text-medium leading-7 text-textLight mb-2"
                        >
                          ${translateText("help_modal.option_controls")}
                        </h4>
                        <ul class="space-y-2 text-textGrey">
                          <li>• ${translateText("help_modal.option_pause")}</li>
                          <li>• ${translateText("help_modal.option_timer")}</li>
                          <li>• ${translateText("help_modal.option_exit")}</li>
                          <li>
                            • ${translateText("help_modal.option_settings")}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "player-info"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.info_title")}
                    </h3>
                    <div class="p-4 background-panel">
                      <h4
                        class="font-pixel text-medium leading-7 text-textLight mb-4"
                      >
                        ${translateText("help_modal.info_enemy_panel")}
                      </h4>
                      <div
                        class="bg-backgroundDarkLighter p-4 mb-6 max-w-sm mx-auto"
                      >
                        <div class="text-center mb-4"></div>
                        <div class="space-y-2 mb-4">
                          <h5
                            class="text-textLight font-pixel text-medium mb-2"
                          >
                            Persian Oligarchy
                          </h5>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small">
                              ${translateText(
                                "player_info_overlay.type",
                              )}:</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >${translateText("player_info_overlay.bot")}</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.d_troops",
                              )}</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >6.39K</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.gold",
                              )}:</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >14.3K</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.ports",
                              )}</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >0</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.cities",
                              )}</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >0</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.missile_launchers",
                              )}</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >0</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.sams",
                              )}:</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >0</span
                            >
                          </div>
                          <div class="flex justify-between">
                            <span class="text-textGrey font-pixel text-small"
                              >${translateText(
                                "player_info_overlay.warships",
                              )}:</span
                            >
                            <span class="text-textLight font-pixel text-small"
                              >0</span
                            >
                          </div>
                        </div>
                      </div>

                      <div class="space-y-4">
                        <div class="flex items-center gap-4">
                          <p class="text-textGrey">
                            ${translateText("help_modal.ui_playeroverlay_desc")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "radial"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.radial_title")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.radial_desc")}
                      </p>
                      <div class="space-y-4">
                        <div class="flex items-center gap-4">
                          <div class="w-6 flex-shrink-0">
                            <o-icon
                              src="icons/wrench.svg"
                              size="large"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <p class="text-textGrey">
                            ${translateText("help_modal.radial_build")}
                          </p>
                        </div>
                        <div class="flex items-center gap-4">
                          <div class="w-6 flex-shrink-0">
                            <o-icon
                              src="icons/info.svg"
                              size="large"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <p class="text-textGrey">
                            ${translateText("help_modal.radial_info")}
                          </p>
                        </div>
                        <div class="flex items-center gap-4">
                          <div class="w-6 flex-shrink-0">
                            <o-icon
                              src="icons/ship.svg"
                              size="large"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <p class="text-textGrey">
                            ${translateText("help_modal.radial_boat")}
                          </p>
                        </div>
                        <div class="flex items-center gap-4">
                          <div class="w-6 flex-shrink-0">
                            <o-icon
                              src="icons/handshake.svg"
                              size="large"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <p class="text-textGrey">
                            ${translateText("help_modal.info_alliance")}
                          </p>
                        </div>
                        <div class="flex items-center gap-4">
                          <div class="w-6 flex-shrink-0">
                            <o-icon
                              src="icons/swords.svg"
                              size="large"
                              color="var(--text-color-light)"
                            ></o-icon>
                          </div>
                          <p class="text-textGrey">
                            ${translateText("help_modal.ally_betray")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "info"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.info_title")}
                    </h3>
                    <div class="p-4 background-panel">
                      <h4
                        class="font-pixel text-medium leading-7 text-textLight mb-4"
                      >
                        ${translateText("help_modal.info_enemy_panel")}
                      </h4>
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.info_enemy_desc")}
                      </p>
                      <div
                        class=" p-4 max-w-xs mx-auto bg- p-3 bg-backgroundDarkLighter mb-4"
                      >
                        <!-- Player Name -->
                        <div class="text-center mb-4">
                          <h5 class="text-textLight font-title text-medium">
                            Anon69
                          </h5>
                        </div>

                        <!-- Stats Grid -->
                        <div class="space-y-3">
                          <div class="grid grid-cols-2 gap-4">
                            <div class="p-3 bg-backgroundDark">
                              <div
                                class="text-textGrey font-title text-small mb-1"
                              >
                                ${translateText("player_info_overlay.gold")}
                              </div>
                              <div class="text-textLight font-pixel text-small">
                                1.37K
                              </div>
                            </div>
                            <div class=" p-3 bg-backgroundDark">
                              <div
                                class="text-textGrey font-title text-small mb-1"
                              >
                                ${translateText("player_panel.troops")}
                              </div>
                              <div class="text-textLight font-title text-small">
                                6.82K
                              </div>
                            </div>
                          </div>

                          <div class=" p-3 bg-backgroundDark">
                            <div
                              class="text-textGrey font-title text-small mb-1"
                            >
                              ${translateText("player_panel.traitor")}
                            </div>
                            <div class="text-textLight font-title text-small">
                              ${translateText("player_panel.no")}
                            </div>
                          </div>

                          <div class=" p-3 bg-backgroundDark">
                            <div
                              class="text-textGrey font-title text-small mb-1"
                            >
                              ${translateText("player_panel.betrayals")}
                            </div>
                            <div class="text-textLight font-title text-small">
                              0
                            </div>
                          </div>

                          <div class=" p-3 bg-backgroundDark">
                            <div
                              class="text-textGrey font-title text-small mb-1"
                            >
                              ${translateText("player_panel.embargo")}
                            </div>
                            <div class="text-textLight font-title text-small">
                              ${translateText("player_panel.no")}
                            </div>
                          </div>
                        </div>

                        <!-- Action Buttons -->
                        <div class="flex justify-center gap-3 mt-4">
                          <button
                            class="w-8 h-8 bg-slate-600 rounded flex items-center justify-center hover:bg-slate-500 transition-colors"
                          >
                            <span class="text-white text-sm"
                              ><o-icon
                                src="icons/message-square-more.svg"
                                size="large"
                                color="var(--text-color-light)"
                              ></o-icon
                            ></span>
                          </button>
                          <button
                            class="w-8 h-8 bg-slate-600 rounded flex items-center justify-center hover:bg-slate-500 transition-colors"
                          >
                            <span class="text-white text-sm">
                              <o-icon
                                src="icons/smile.svg"
                                size="large"
                                color="var(--text-color-light)"
                              ></o-icon
                            ></span>
                          </button>
                        </div>
                      </div>
                      <div class="space-y-4">
                        ${this.infoMenuActions.map(
                          (action) => html`
                            <div class="flex items-center gap-4">
                              <div class="w-6 flex-shrink-0">
                                <o-icon
                                  src=${action.icon}
                                  size="large"
                                  color="var(--text-color-light)"
                                ></o-icon>
                              </div>
                              <p class="text-textGrey">${action.description}</p>
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "ally"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.info_ally_panel")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-6">
                        ${translateText("help_modal.info_ally_desc")}
                      </p>
                      <div
                        class=" p-4 max-w-xs mx-auto bg- p-3 bg-backgroundDarkLighter mb-4"
                      >
                        <!-- Player Name -->
                        <div class="text-center mb-4">
                          <h5 class="text-textLight font-title text-medium">
                            Anon69
                          </h5>
                        </div>

                        <!-- Stats Grid -->
                        <div class="space-y-3">
                          <div class="grid grid-cols-2 gap-4">
                            <div class="p-3 bg-backgroundDark">
                              <div
                                class="text-textGrey font-title text-small mb-1"
                              >
                                ${translateText("player_info_overlay.gold")}
                              </div>
                              <div class="text-textLight font-pixel text-small">
                                1.37K
                              </div>
                            </div>
                            <div class=" p-3 bg-backgroundDark">
                              <div
                                class="text-textGrey font-title text-small mb-1"
                              >
                                ${translateText("player_panel.troops")}
                              </div>
                              <div class="text-textLight font-title text-small">
                                6.82K
                              </div>
                            </div>
                          </div>

                          <div class=" p-3 bg-backgroundDark">
                            <div
                              class="text-textGrey font-title text-small mb-1"
                            >
                              ${translateText("player_panel.traitor")}
                            </div>
                            <div class="text-textLight font-title text-small">
                              ${translateText("player_panel.no")}
                            </div>
                          </div>

                          <div class=" p-3 bg-backgroundDark">
                            <div
                              class="text-textGrey font-title text-small mb-1"
                            >
                              ${translateText("player_panel.betrayals")}
                            </div>
                            <div class="text-textLight font-title text-small">
                              0
                            </div>
                          </div>

                          <div class=" p-3 bg-backgroundDark">
                            <div
                              class="text-textGrey font-title text-small mb-1"
                            >
                              ${translateText("player_panel.embargo")}
                            </div>
                            <div class="text-textLight font-title text-small">
                              ${translateText("player_panel.no")}
                            </div>
                          </div>
                        </div>

                        <!-- Action Buttons -->
                        <div class="flex justify-center gap-3 mt-4">
                          <button
                            class="w-8 h-8 bg-slate-600 rounded flex items-center justify-center hover:bg-slate-500 transition-colors"
                          >
                            <span class="text-white text-sm"
                              ><o-icon
                                src="icons/message-square-more.svg"
                                size="large"
                                color="var(--text-color-light)"
                              ></o-icon
                            ></span>
                          </button>
                          <button
                            class="w-8 h-8 bg-slate-600 rounded flex items-center justify-center hover:bg-slate-500 transition-colors"
                          >
                            <span class="text-white text-sm">
                              <o-icon
                                src="icons/smile.svg"
                                size="large"
                                color="var(--text-color-light)"
                              ></o-icon
                            ></span>
                          </button>
                        </div>
                      </div>
                      <div class="space-y-6">
                        ${this.allyActions.map(
                          (action) => html`
                            <div class="flex items-center gap-4">
                              <div class="w-6 flex-shrink-0">
                                <o-icon
                                  src=${action.icon}
                                  size="large"
                                  color="var(--text-color-light)"
                                ></o-icon>
                              </div>
                              <div>
                                <p class="text-textGrey">
                                  ${action.description}
                                </p>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "build"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.build_menu_title")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-4">
                        ${translateText("help_modal.build_menu_desc")}
                      </p>
                      <div class="p-4">
                        <div class="grid grid-cols-3 gap-3">
                          ${this.buildings.map(
                            (building) => html`
                              <div class="p-3 background-panel text-center">
                                <div class="text-large mb-2">
                                  <o-icon
                                    src=${building.icon}
                                    size="large"
                                    color="var(--text-color-light)"
                                  ></o-icon>
                                </div>
                                <div
                                  class="text-textLight font-pixel text-small mb-1"
                                >
                                  ${building.name}
                                </div>
                                <div
                                  class="text-textGrey font-pixel text-small mb-1"
                                >
                                  ${building.description.split(" ").length > 5
                                    ? building.description
                                        .split(" ")
                                        .slice(0, 5)
                                        .join(" ") + "..."
                                    : building.description}
                                </div>
                                <div class="text-primary font-pixel text-small">
                                  ${building.cost}
                                </div>
                              </div>
                            `,
                          )}
                        </div>
                      </div>
                    </div>
                    <div class="grid">
                      ${this.buildings.map(
                        (building) => html`
                          <div class="p-4 mb-4 background-panel">
                            <div class="flex items-center gap-4 mb-2">
                              <div class="w-6 flex-shrink-0">
                                <o-icon
                                  src=${building.icon}
                                  size="large"
                                  color="var(--text-color-light)"
                                ></o-icon>
                              </div>
                              <h4
                                class="font-pixel text-medium leading-7 text-textLight"
                              >
                                ${building.name}
                              </h4>
                            </div>
                            <p class="text-textGrey">${building.description}</p>
                          </div>
                        `,
                      )}
                    </div>
                  </div>
                `
              : ""}
            ${this.activeTab === "icons"
              ? html`
                  <div class="space-y-4">
                    <h3
                      class="font-pixel text-large leading-7 text-textLight mb-5"
                    >
                      ${translateText("help_modal.player_icons")}
                    </h3>
                    <div class="p-4 background-panel">
                      <p class="text-textGrey mb-6">
                        ${translateText("help_modal.icon_desc")}
                      </p>
                      <div class="grid gap-4">
                        ${this.playerIcons.map(
                          (icon) => html`
                            <div class="flex items-center gap-4 mb-6">
                              <div
                                class="w-12 h-12 bg-backgroundDarkLighter flex items-center justify-center text-large"
                              >
                                <o-icon
                                  src=${icon.icon}
                                  size="large"
                                  color="var(--text-color-light)"
                                ></o-icon>
                              </div>
                              <div class="flex-1">
                                <p class="text-textGrey">${icon.description}</p>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  </div>
                `
              : ""}
          </div>
        </div>
      </o-modal>
    `;
  }
}
