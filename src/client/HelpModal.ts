import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";
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
      <o-modal id="helpModal" title="Instructions" translationKey="main.instructions">
        <div class="flex flex-col items-center">
          <div data-i18n="help_modal.hotkeys" class="text-center text-2xl font-bold mb-4">Hotkeys</div>
          <table>
            <thead>
            <tr>
              <th data-i18n="help_modal.table_key">Key</th>
              <th data-i18n="help_modal.table_action">Action</th>
            </tr>
            </thead>
            <tbody class="text-left">
            <tr>
              <td>Space</td>
              <td data-i18n="help_modal.action_alt_view">Alternate view (terrain/countries)</td>
            </tr>
            <tr>
              <td>Shift + left click</td>
              <td data-i18n="help_modal.action_attack_altclick">Attack (when left click is set to open menu)</td>
            </tr>
            <tr>
              <td>Ctrl + left click</td>
              <td data-i18n="help_modal.action_build">Open build menu</td>
            </tr>
            <tr>
              <td>C</td>
              <td data-i18n="help_modal.action_center">Center camera on player</td>
            </tr>
            <tr>
              <td>Q / E</td>
              <td data-i18n="help_modal.action_zoom">Zoom out/in</td>
            </tr>
            <tr>
              <td>W / A / S / D</td>
              <td data-i18n="help_modal.action_move_camera">Move camera</td>
            </tr>
            <tr>
              <td>1 / 2</td>
              <td data-i18n="help_modal.action_ratio_change">Decrease/Increase attack ratio</td>
            </tr>
            <tr>
              <td>Shift + scroll down / scroll up</td>
              <td data-i18n="help_modal.action_ratio_change">Decrease/Increase attack ratio</td>
            </tr>
            <tr>
              <td>ALT + R</td>
              <td data-i18n="help_modal.action_reset_gfx">Reset graphics</td>
            </tr>
            </tbody>
          </table>
        </div>

        <hr class="mt-6 mb-4">

        <div data-i18n="help_modal.ui_section" class="text-2xl font-bold text-center mb-4">Game UI</div>
        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div data-i18n="help_modal.ui_leaderboard" class="text-gray-300">Leaderboard</div>
            <img src="/images/helpModal/leaderboard.webp" alt="Leaderboard" title="Leaderboard" />
          </div>
          <div>
            <p data-i18n="help_modal.ui_leaderboard_desc">Shows the top players of the game and their names, % owned land and gold.</p>
          </div>
        </div>

        <hr class="mt-6 mb-4">

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center w-full md:w-[80%]">
            <div data-i18n="help_modal.ui_control" class="text-gray-300">Control panel</div>
            <img src="/images/helpModal/controlPanel.webp" alt="Control panel" title="Control panel" />
          </div>
          <div>
            <p data-i18n="help_modal.ui_control_desc" class="mb-4">The control panel contains the following elements:</p>
            <ul>
              <li data-i18n="help_modal.ui_pop" class="mb-4">Pop - The amount of units you have, your max population and the rate at which you gain them.</li>
              <li data-i18n="help_modal.ui_gold" class="mb-4">Gold - The amount of gold you have and the rate at which you gain it.</li>
              <li data-i18n="help_modal.ui_troops_workers" class="mb-4">Troops and Workers - The amount of allocated troops and workers. Troops are used to attack or defend against attacks. Workers are used to generate gold. You can adjust the number of troops and workers using the slider.</li>
              <li data-i18n="help_modal.ui_attack_ratio" class="mb-4">Attack ratio - The amount of troops that will be used when you attack. You can adjust the attack ratio using the slider.</li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4">

        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col items-center">
            <div data-i18n="help_modal.ui_options" class="text-gray-300">Options</div>
            <img src="/images/helpModal/options.webp" alt="Options" title="Options" />
          </div>
          <div>
            <p data-i18n="help_modal.ui_options_desc" class="mb-4">The following elements can be found inside:</p>
            <ul>
              <li data-i18n="help_modal.option_pause" class="mb-4">Pause/Unpause the game - Only available in single player mode.</li>
              <li data-i18n="help_modal.option_timer" class="mb-4">Timer - Time passed since the start of the game.</li>
              <li data-i18n="help_modal.option_exit" class="mb-4">Exit button.</li>
              <li data-i18n="help_modal.option_settings" class="mb-4">Settings - Open the settings menu. Inside you can toggle the Alternate View, Dark Mode, Emojis and action on left click.</li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4">

        <div data-i18n="radial_title" class="text-2xl font-bold text-center">Radial menu</div>

        <div class="flex flex-col md:flex-row gap-4">
          <img src="/images/helpModal/radialMenu.webp" alt="Radial menu" title="Radial menu", class="radial-menu-image" />
          <div>
            <p data-i18n="help_modal.radial_desc" class="mb-4">Right clicking (or touch on mobile) opens the radial menu. From there you can:</p>
            <ul>
              <li class="mb-4"><div class="inline-block icon build-icon"></div><span data-i18n="help_modal.radial_build"> - Open the build menu.</span></li>
              <li class="mb-4">
                <img src="/images/InfoIcon.svg" class="inline-block icon" style="fill: white; background: transparent;"/><span data-i18n="help_modal.radial_info"> - Open the Info menu.</span></li>
              <li class="mb-4"><div class="inline-block icon boat-icon"></div><span data-i18n="help_modal.radial_boat"> - Send a boat to attack at the selected location (only available if you have access to water).</span></li>
              <li class="mb-4"><div class="inline-block icon cancel-icon"></div><span data-i18n="help_modal.radial_close"> - Close the menu.</span></li>
            </ul>
          </div>
        </div>

        <hr class="mt-6 mb-4">

        <div>
          <div data-i18n="help_modal.info_title" class="text-2xl font-bold text-center">Info menu</div>
          <div class="flex flex-col md:flex-row gap-4 mt-2">
            <div class="flex flex-col items-center w-full md:w-[80%]">
              <div data-i18n="help_modal.info_enemy_panel" class="text-gray-300">Enemy info panel</div>
              <img src="/images/helpModal/infoMenu.webp" alt="Enemy info panel" title="Enemy info panel" />
            </div>
            <div class="pt-4">
              <p data-i18n="help_modal.info_enemy_desc" class="mb-4">
                Contains information such for the selected player name, gold, troops, and if the player is a traitor. Traitor is a player who betrayed and attacked a player who was in an alliance with them. The icons below represent the following interactions:
              </p>
              <ul>
                <li class="mb-4"><div class="inline-block icon target-icon"></div><span data-i18n="help_modal.info_target"> - Place a target mark on the player, marking it for all allies, used to coordinate attacks.</span></li>
                <li class="mb-4"><div class="inline-block icon alliance-icon"></div><span data-i18n="help_modal.info_alliance"> - Send an alliance request to the player. Allies can share resources and troops, but can't attack each other.</span></li>
                <li><div class="inline-block icon emoji-icon"></div><span data-i18n="help_modal.info_emoji"> - Send an emoji to the player.</span></li>
              </ul>
            </div>
          </div>

          <hr class="mt-6 mb-4">

          <div class="flex flex-col md:flex-row gap-4">
            <div class="flex flex-col items-center w-full md:w-[62%]">
              <div data-i18n="help_modal.info_ally_panel" class="text-gray-300">Ally info panel</div>
              <img src="/images/helpModal/infoMenuAlly.webp" alt="Ally info panel" title="Ally info panel" />
            </div>
            <div class="pt-4">
              <p data-i18n="help_modal.info_ally_desc" class="mb-4">
                When you ally with a player, the following new icons become available:
              </p>
              <ul>
                <li class="mb-4"><div class="inline-block icon betray-icon"></div><span data-i18n="help_modal.ally_betray"> - Betray your ally, ending the alliance. You will now have a permanent icon stuck next to your name. Bots are less likely to ally with you and players will think twice before doing so.</span></li>
                <li class="mb-4"><div class="inline-block icon donate-icon"></div><span data-i18n="help_modal.ally_donate"> - Donate some of your troops to your ally. Used when they're low on troops and are being attacked, or when they need that extra power to crush an enemy.</span></li>
              </ul>
            </div>
          </div>
        </div>

        <hr class="mt-6 mb-4">

        <div>
          <div data-i18n="help_modal.build_menu_title" class="text-2xl font-bold mb-4 text-center">Build menu</div>
          <table>
            <thead>
            <tr>
              <th data-i18n="help_modal.build_name">Name</th>
              <th data-i18n="help_modal.build_icon">Icon</th>
              <th data-i18n="help_modal.build_desc">Description</th>
            </tr>
            </thead>
            <tbody class="text-left">
            <tr>
              <td data-i18n="help_modal.build_city">City</td>
              <td><div class="icon city-icon"></div></td>
              <td data-i18n="help_modal.build_city_desc">
                Increases your max population. Useful when you can't
                expand your territory or you're about to hit your
                population limit.
              </td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_defense">Defense Post</td>
              <td><div class="icon defense-post-icon"></div></td>
              <td data-i18n="help_modal.build_defense_desc">
                Increases defenses around nearby borders. Attacks from
                enemies are slower and have more casualties.
              </td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_port">Port</td>
              <td><div class="icon port-icon"></div></td>
              <td data-i18n="help_modal.build_port_desc">
                Automatically sends trade ships between ports of your
                country and other countries (except if you clicked "stop
                trade" on them or they clicked "stop trade on you"), giving
                gold to both sides. Allows building Battleships. Can only
                be built near water.
              </td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_warship">Warship</td>
              <td><div class="icon warship-icon"></div></td>
              <td data-i18n="help_modal.build_warship_desc">
                Patrols in an area, capturing trade ships and destroying
                enemy Warships and Boats. Spawns from the nearest Port and
                patrols the area you first clicked to build it.
              </td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_silo">Missile Silo</td>
              <td><div class="icon missile-silo-icon"></div></td>
              <td data-i18n="help_modal.build_silo_desc">Allows launching missiles.</td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_sam">SAM Launcher</td>
              <td><div class="icon sam-launcher-icon"></div></td>
              <td data-i18n="help_modal.build_sam_desc">Has a 75% chance to intercept enemy missiles in it's 100 pixel range.
                The SAM has a 7.5 second cooldown and can not intercept MIRVs.</td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_atom">Atom Bomb</td>
              <td><div class="icon atom-bomb-icon"></div></td></td>
              <td data-i18n="help_modal.build_atom_desc">Small explosive bomb that destroys territory, buildings, ships and boats. Spawns from the nearest Missile Silo and lands in the area you first clicked to build it.</td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_hydrogen">Hydrogen Bomb</td>
              <td><div class="icon hydrogen-bomb-icon"></div></td></td>
              <td data-i18n="help_modal.build_hydrogen_desc">Large explosive bomb. Spawns from the nearest Missile Silo and lands in the area you first clicked to build it.</td>
            </tr>
            <tr>
              <td data-i18n="help_modal.build_mirv">MIRV</td>
              <td><div class="icon mirv-icon"></div></td>
              <td data-i18n="help_modal.build_mirv_desc">The most powerful bomb in the game. Splits up into smaller bombs that will cover a huge range of territory. Only damages the player that you first clicked on to build it. Spawns from the nearest Missile Silo and lands in the area you first clicked to build it.</td>
            </tr>
            </tbody>
          </table>
        </div>

        <hr class="mt-6 mb-4">

        <div>
          <div data-i18n="help_modal.player_icons" class="text-2xl font-bold text-center">Player icons</div>
          <p data-i18n="help_modal.icon_desc">Examples of some of the ingame icons you will encounter and what they mean:</p>
          <div class="flex flex-col md:flex-row gap-4 mt-2">
            <div class="flex flex-col items-center">
              <div data-i18n="help_modal.icon_crown" class="text-gray-300">Crown - This is the number 1 player in the leaderboard</div>
              <img src="/images/helpModal/number1.webp" alt="Number 1 player" title="Number 1 player" />
            </div>

            <div class="flex flex-col items-center">
              <div data-i18n="help_modal.icon_traitor" class="text-gray-300">Crossed swords - Traitor. This player attacked an ally.</div>
              <img src="/images/helpModal/traitor.webp" alt="Traitor" title="Traitor" />
            </div>

            <div class="flex flex-col items-center">
              <div data-i18n="help_modal.icon_ally" class="text-gray-300">Handshake - Ally. This player is your ally.</div>
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
