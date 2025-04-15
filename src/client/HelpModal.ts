import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/Difficulties";
import "./components/Maps";

@customElement("help-modal")
export class HelpModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  render() {
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
                <td><span class="key">Space</span></td>
                <td>${translateText("help_modal.action_alt_view")}</td>
              </tr>
              <tr>
                <td>
                  <div class="scroll-combo-horizontal">
                    <span class="key">Shift</span>
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
                    <span class="key">Ctrl</span>
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
                    <span class="key">Alt</span>
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
                <td><span class="key">C</span></td>
                <td>${translateText("help_modal.action_center")}</td>
              </tr>
              <tr>
                <td><span class="key">Q</span> / <span class="key">E</span></td>
                <td>${translateText("help_modal.action_zoom")}</td>
              </tr>
              <tr>
                <td><span class="key">W</span> <span class="key">A</span> <span class="key">S</span> <span class="key">D</span></td>
                <td>${translateText("help_modal.action_move_camera")}</td>
              </tr>
              <tr>
                <td><span class="key">1</span> / <span class="key">2</span></td>
                <td>${translateText("help_modal.action_ratio_change")}</td>
              </tr>
              <tr>
                <td>
                  <div class="scroll-combo-horizontal">
                    <span class="key">Shift</span>
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
                <td><span class="key">ALT</span> + <span class="key">R</span></td>
                <td>${translateText("help_modal.action_reset_gfx")}</td>
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
            <div class="text-gray-300">
              ${translateText("help_modal.ui_leaderboard")}
            </div>
            <img
              src="/images/helpModal/leaderboard.webp"
              alt="Leaderboard"
              title="Leaderboard"
            />
          </div>
          <div>
            <p>${translateText("help_modal.ui_leaderboard_desc")}</p>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center w-full md:w-[80%]">
            <div class="text-gray-300">
              ${translateText("help_modal.ui_control")}
            </div>
            <img
              src="/images/helpModal/controlPanel.webp"
              alt="Control panel"
              title="Control panel"
            />
          </div>
          <div>
            <p class="mb-4">${translateText("help_modal.ui_control_desc")}</p>
            <ul>
              <li class="mb-4">${translateText("help_modal.ui_pop")}</li>
              <li class="mb-4">${translateText("help_modal.ui_gold")}</li>
              <li class="mb-4">
                ${translateText("help_modal.ui_troops_workers")}
              </li>
              <li class="mb-4">
                ${translateText("help_modal.ui_attack_ratio")}
              </li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div class="text-gray-300">
              ${translateText("help_modal.ui_options")}
            </div>
            <img
              src="/images/helpModal/options.webp"
              alt="Options"
              title="Options"
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

        <div class="text-2xl font-bold text-center">
          ${translateText("help_modal.radial_title")}
        </div>

        <div class="flex flex-col md:flex-row gap-4">
          <img
            src="/images/helpModal/radialMenu.webp"
            alt="Radial menu"
            title="Radial menu"
            ,
            class="radial-menu-image"
          />
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
                />
                <span>${translateText("help_modal.radial_info")}</span>
              </li>
              <li class="mb-4">
                <div class="inline-block icon boat-icon"></div>
                <span>${translateText("help_modal.radial_boat")}</span>
              </li>
              <li class="mb-4">
                <div class="inline-block icon cancel-icon"></div>
                <span>${translateText("help_modal.radial_close")}</span>
              </li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div>
          <div class="text-2xl font-bold text-center">
            ${translateText("help_modal.info_title")}
          </div>

          <div class="flex flex-col md:flex-row gap-4 mt-2">
            <div class="flex flex-col items-center w-full md:w-[80%]">
              <divclass="text-gray-300">
                ${translateText("help_modal.info_enemy_panel")}
              </div>
              <img
                src="/images/helpModal/infoMenu.webp"
                alt="Enemy info panel"
                title="Enemy info panel"
              />
            </div>
            <div class="pt-4">
              <p class="mb-4">${translateText("help_modal.info_enemy_desc")}</p>
              <ul>
                <li class="mb-4">
                  <div class="inline-block icon target-icon"></div>
                  <span>${translateText("help_modal.info_target")}</span>
                </li>
                <li class="mb-4">
                  <div class="inline-block icon alliance-icon"></div>
                  <span>${translateText("help_modal.info_alliance")}</span>
                </li>
                <li>
                  <div class="inline-block icon emoji-icon"></div>
                  <span>${translateText("help_modal.info_emoji")}</span>
                </li>
              </ul>
            </div>
          </div>

          <hr class="mt-6 mb-4" />

          <div class="flex flex-col md:flex-row gap-4">
            <div class="flex flex-col items-center w-full md:w-[62%]">
              <div class="text-gray-300">
                ${translateText("help_modal.info_ally_panel")}
              </div>
              <img
                src="/images/helpModal/infoMenuAlly.webp"
                alt="Ally info panel"
                title="Ally info panel"
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
              </ul>
            </div>
          </div>
        </div>

        <hr class="mt-6 mb-4" />

        <div>
          <div class="text-2xl font-bold mb-4 text-center">
            ${translateText("help_modal.build_menu_title")}
          </div>
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
          <div class="text-2xl font-bold text-center">
            ${translateText("help_modal.player_icons")}
          </div>
          <p>${translateText("help_modal.icon_desc")}</p>
          <div class="flex flex-col md:flex-row gap-4 mt-2">
            <div class="flex flex-col items-center">
              <div class="text-gray-300">
                ${translateText("help_modal.icon_crown")}
              </div>
              <img
                src="/images/helpModal/number1.webp"
                alt="Number 1 player"
                title="Number 1 player"
              />
            </div>

            <div class="flex flex-col items-center">
              <div class="text-gray-300">
                ${translateText("help_modal.icon_traitor")}
              </div>
              <img
                src="/images/helpModal/traitor.webp"
                alt="Traitor"
                title="Traitor"
              />
            </div>

            <div class="flex flex-col items-center">
              <div class="text-gray-300">
                ${translateText("help_modal.icon_ally")}
              </div>
              <img src="/images/helpModal/ally.webp" alt="Ally" title="Ally" />
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
