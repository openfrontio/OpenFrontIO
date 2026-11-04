import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { party, partyInviteLink, type PartyView } from "../PartyClient";
import { copyToClipboard, translateText } from "../Utils";

// The party box on the play page: create or join a party, share the invite,
// and (for the leader) manage members. Following the leader into games is
// wired in Main (setupParty); this is only the menu side.
@customElement("party-panel")
export class PartyPanel extends LitElement {
  @state() private view: PartyView = party.view();
  @state() private code = "";
  @state() private copied = false;
  @state() private expanded = false;
  private unsubscribe: (() => void) | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = party.subscribe((view) => {
      this.view = view;
      if (view.state !== null) this.expanded = true;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
  }

  private async copyInvite() {
    const id = this.view.state?.partyID;
    if (id === undefined) return;
    await copyToClipboard(partyInviteLink(id));
    this.copied = true;
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => (this.copied = false), 2000);
  }

  private joinByCode(e: Event) {
    e.preventDefault();
    const raw = this.code.trim();
    // Accept a pasted invite link as well as the bare code.
    const code = raw.includes("#party=") ? raw.split("#party=")[1] : raw;
    party.join(code);
    this.code = "";
  }

  private errorText(): string | null {
    switch (this.view.error) {
      case "kicked":
        return translateText("party.error_kicked");
      case "full":
        return translateText("party.error_full");
      case "not_found":
      case "invalid":
        return translateText("party.error_not_found");
      case "unreachable":
        return translateText("party.error_unreachable");
      default:
        return null;
    }
  }

  private renderIdle() {
    const error = this.errorText();
    if (!this.expanded) {
      return html`
        <button
          class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-surface border border-white/10 text-white/90 hover:bg-white/5 transition-colors"
          @click=${() => (this.expanded = true)}
        >
          <span class="font-semibold">${translateText("party.title")}</span>
          <span class="text-sm text-white/60"
            >${translateText("party.collapsed_hint")}</span
          >
        </button>
      `;
    }
    const busy = this.view.status !== "idle";
    return html`
      <div
        class="flex flex-col gap-2 px-3 py-2 rounded-xl bg-surface border border-white/10 text-white/90"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold">${translateText("party.title")}</span>
          <button
            class="text-white/50 hover:text-white text-sm"
            aria-label=${translateText("party.close")}
            @click=${() => (this.expanded = false)}
          >
            ✕
          </button>
        </div>
        <p class="text-sm text-white/60">
          ${translateText("party.description")}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold"
            ?disabled=${busy}
            @click=${() => party.create()}
          >
            ${translateText("party.create")}
          </button>
          <form
            class="flex flex-1 min-w-[12rem] gap-2"
            @submit=${this.joinByCode}
          >
            <input
              class="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-white/40"
              .value=${this.code}
              placeholder=${translateText("party.code_placeholder")}
              aria-label=${translateText("party.code_placeholder")}
              @input=${(e: Event) =>
                (this.code = (e.target as HTMLInputElement).value)}
            />
            <button
              type="submit"
              class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 font-semibold"
              ?disabled=${busy || this.code.trim() === ""}
            >
              ${translateText("party.join")}
            </button>
          </form>
        </div>
        ${
          busy
            ? html`<p class="text-sm text-white/60">
                ${translateText("party.connecting")}
              </p>`
            : nothing
        }
        ${
          error !== null
            ? html`<p class="text-sm text-red-400" role="alert">${error}</p>`
            : nothing
        }
      </div>
    `;
  }

  private renderParty() {
    const s = this.view.state!;
    const isLeader = s.leaderID === s.selfID;
    return html`
      <div
        class="flex flex-col gap-2 px-3 py-2 rounded-xl bg-surface border border-white/10 text-white/90"
      >
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="font-semibold">
            ${translateText("party.title")}
            <span class="text-white/50 font-normal">(${s.members.length})</span>
          </span>
          <div class="flex items-center gap-2">
            <code
              class="px-2 py-0.5 rounded bg-black/30 text-sm select-all"
              title=${translateText("party.code")}
              >${s.partyID}</code
            >
            <button
              class="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
              @click=${() => void this.copyInvite()}
            >
              ${
                this.copied
                  ? translateText("party.copied")
                  : translateText("party.copy_invite")
              }
            </button>
            <button
              class="px-2 py-1 rounded-lg bg-red-600/70 hover:bg-red-600 text-sm"
              @click=${() => party.leave()}
            >
              ${translateText("party.leave")}
            </button>
          </div>
        </div>
        ${
          this.view.status === "reconnecting"
            ? html`<p class="text-sm text-amber-300">
                ${translateText("party.reconnecting")}
              </p>`
            : nothing
        }
        <ul class="flex flex-col gap-1">
          ${s.members.map(
            (m) => html`
              <li
                class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-black/20"
              >
                <span
                  class="truncate ${m.connected ? "" : "text-white/40"}"
                  title=${m.connected ? "" : translateText("party.disconnected")}
                >
                  ${
                    m.memberID === s.leaderID
                      ? html`<span
                          aria-label=${translateText("party.leader")}
                          title=${translateText("party.leader")}
                          >👑</span
                        >`
                      : nothing
                  }
                  ${m.clanTag ? `[${m.clanTag}] ` : ""}${m.username}
                  ${
                    m.memberID === s.selfID
                      ? html`<span class="text-white/50 text-sm"
                          >(${translateText("party.you")})</span
                        >`
                      : nothing
                  }
                </span>
                ${
                  isLeader && m.memberID !== s.selfID
                    ? html`<span class="flex gap-1 shrink-0">
                        <button
                          class="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-xs"
                          @click=${() => party.promote(m.memberID)}
                        >
                          ${translateText("party.promote")}
                        </button>
                        <button
                          class="px-2 py-0.5 rounded bg-red-600/60 hover:bg-red-600 text-xs"
                          @click=${() => party.kick(m.memberID)}
                        >
                          ${translateText("party.kick")}
                        </button>
                      </span>`
                    : nothing
                }
              </li>
            `,
          )}
        </ul>
        <p class="text-sm text-white/60">
          ${
            isLeader
              ? translateText("party.leader_hint")
              : translateText("party.member_hint")
          }
        </p>
        ${
          !isLeader && s.gameID !== undefined
            ? html`<button
                class="self-start px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold"
                @click=${() =>
                  document.dispatchEvent(
                    new CustomEvent("party-follow", { detail: s.gameID }),
                  )}
              >
                ${translateText("party.join_leader")}
              </button>`
            : nothing
        }
      </div>
    `;
  }

  render() {
    return this.view.state === null ? this.renderIdle() : this.renderParty();
  }
}
