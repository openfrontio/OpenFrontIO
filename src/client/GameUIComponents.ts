import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("game-ui-components")
export class GameUIComponents extends LitElement {
  createRenderRoot() {
    return this;
  }
  render() {
    return html`
      <single-player-modal></single-player-modal>
      <host-lobby-modal></host-lobby-modal>
      <join-private-lobby-modal></join-private-lobby-modal>
      <emoji-table></emoji-table>
      <leader-board></leader-board>
      <build-menu></build-menu>
      <win-modal></win-modal>
      <game-starting-modal></game-starting-modal>
      <top-bar></top-bar>
      <team-stats></team-stats>
      <player-panel></player-panel>
      <help-modal></help-modal>
      <flag-modal></flag-modal>
      <login-modal></login-modal>
      <news-modal></news-modal>
      <chat-modal></chat-modal>
      <user-setting></user-setting>
      <multi-tab-modal></multi-tab-modal>
      <unit-info-modal></unit-info-modal>
      <game-top-bar></game-top-bar>
      <game-right-sidebar></game-right-sidebar>
      <dark-mode-button></dark-mode-button>
      <alert-frame></alert-frame>
      <game-left-sidebar></game-left-sidebar>
      <spawn-ad></spawn-ad>
      <territory-patterns-modal></territory-patterns-modal>
    `;
  }
}
