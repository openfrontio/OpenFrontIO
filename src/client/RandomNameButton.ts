import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";

@customElement("random-name-button")
export class RandomNameButton extends LitElement {
  private userSettings: UserSettings = new UserSettings();
  @state() private randomName: boolean = this.userSettings.anonymousNames();

  createRenderRoot() {
    return this;
  }

  toggleRandomName() {
    this.userSettings.toggleRandomName();
    this.randomName = this.userSettings.anonymousNames();
  }

  render() {
    return html`
      <button
        title="Random Name"
        class="absolute top-0 left-0 md:top-[10px] md:left-[10px] border-none bg-none cursor-pointer text-2xl"
        @click=${() => this.toggleRandomName()}
      >
        ${this.randomName ? "🥷" : "🕵️"}
      </button>
    `;
  }
}
