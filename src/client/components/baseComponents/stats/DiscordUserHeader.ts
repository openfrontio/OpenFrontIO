import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DiscordUser } from "../../../../core/ApiSchemas";
import { translateText } from "../../../Utils";

@customElement("discord-user-header")
export class DiscordUserHeader extends LitElement {
  static styles = css`
    .wrap {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .avatarFrame {
      padding: 3px;
      border-radius: 9999px;
      background: #6b7280; /* bg-gray-500 */
    }
    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 9999px;
      display: block;
    }
    .name {
      font-weight: 600;
      color: white;
    }
  `;

  @state() private _data: DiscordUser | null = null;

  @property({ attribute: false })
  get data(): DiscordUser | null {
    return this._data;
  }
  set data(v: DiscordUser | null) {
    this._data = v;
    this.requestUpdate();
  }

  private get avatarUrl(): string | null {
    const u = this._data;
    if (!u) return null;
    if (u.avatar) {
      const ext = u.avatar.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}`;
    }
    if (u.discriminator !== undefined) {
      const idx = Number(u.discriminator) % 5;
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }
    return null;
  }

  private get discordDisplayName(): string {
    return this._data?.username ?? "";
  }

  render() {
    return html`
      <div class="wrap">
        ${this.avatarUrl
          ? html`
              <div class="avatarFrame">
                <img
                  class="avatar"
                  src="${this.avatarUrl}"
                  alt="${translateText("discord_user_header.avatar_alt")}"
                />
              </div>
            `
          : null}
        <span class="name">${this.discordDisplayName}</span>
      </div>
    `;
  }
}
