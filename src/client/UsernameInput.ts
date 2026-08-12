import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { ANON_WORDS, anonWordName } from "../core/AnonNames";
import { isTemporaryUsername, UserMeResponse } from "../core/ApiSchemas";
import { sanitizeClanTag } from "../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_CLAN_TAG_LENGTH,
  MIN_USERNAME_LENGTH,
  validateClanTag,
  validateUsername,
} from "../core/validations/username";
import { getUserMe } from "./Api";
import { checkClanTagOwnership } from "./ClanApi";
import { verifiedBadge } from "./components/ui/VerifiedBadge";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { showInGameConfirm } from "./InGameModal";
import { steamSDK } from "./SteamSDK";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

const usernameKey: string = "username";
const clanTagKey: string = "clanTag";
const useVerifiedNameKey: string = "useVerifiedName";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  @state() private clanTag: string = "";
  // Playing under the account's verified bare name (sub-only). The free-form
  // name stays in baseUsername/localStorage so unchecking restores it.
  @state() private verifiedActive: boolean = false;
  private userMe: UserMeResponse | false | null = null;

  // Clans aren't supported on CrazyGames — hide the tag input and never submit one.
  private readonly onCrazyGames = crazyGamesSDK.isOnCrazyGames();
  // Steam identity is fixed for the session (no login/logout events like
  // CrazyGames), so it's only used to seed the name once in connectedCallback.
  private readonly onSteam = steamSDK.isOnSteam();

  @property({ type: String }) validationError: string = "";
  // Ownership-check feedback (i18n key) shown inline beneath the tag input. Only
  // "not a member" gates the buttons (see emitValidity); the rest is advisory.
  @state() private clanTagOwnershipError: string = "";
  @state() private clanCheckPending: boolean = false;
  @state() private clanMenuOpen: boolean = false;
  // What the picker's free-text field shows. Separate from clanTag so it can
  // stay empty while a listed clan is selected (see toggleClanMenu).
  @state() private clanDraft: string = "";
  private _isValid: boolean = true;
  private _lastValidatedLang: string | null = null;

  // Latest in-flight ownership check. `clanCheckGen` discards stale results so
  // only the most recent keystroke updates the UI / resolves the submit value.
  private clanCheckGen = 0;
  private clanCheck: Promise<string | null> = Promise.resolve(null);

  // Resolves once the one-shot Steam name-seed has settled (or immediately for
  // non-Steam players). The join flow awaits this before reading getUsername()
  // so a fast join can't start the game under the generated anon name before
  // the Steam persona lands. Always resolves — never rejects — so a failed or
  // slow getUser() falls back to the generated name instead of blocking.
  private steamSeedReady: Promise<void> = Promise.resolve();

  // Remove static styles since we're using Tailwind

  createRenderRoot() {
    // Disable shadow DOM to allow Tailwind classes to work
    return this;
  }

  constructor() {
    super();
    // Account state for the verified-name toggle. Same document-level pattern
    // as AccountModal; Main dispatches this after auth resolves and on
    // CrazyGames sign-in.
    document.addEventListener("userMeResponse", (event: Event) => {
      this.userMe = (event as CustomEvent).detail as UserMeResponse | false;
      this.applyVerifiedPreference();
    });
  }

  // The clans this player belongs to, for the tag picker. Empty when signed
  // out or when an older API omits the field.
  private myClans(): { tag: string; name: string }[] {
    if (this.userMe === null || this.userMe === false) return [];
    return this.userMe.player.clans ?? [];
  }

  private toggleClanMenu = () => {
    this.clanMenuOpen = !this.clanMenuOpen;
    if (this.clanMenuOpen) {
      // Seed the free-text field only when the current tag isn't one of the
      // player's clans — the list already represents those. It is tracked
      // separately from clanTag so typing a tag that happens to match a clan
      // doesn't blank the field mid-keystroke.
      const active = this.clanTag.toUpperCase();
      this.clanDraft = this.myClans().some(
        (c) => c.tag.toUpperCase() === active,
      )
        ? ""
        : this.clanTag;
    }
  };

  // Any click that isn't inside this component closes the picker. Registered
  // for the lifetime of the element (cheap) rather than toggled with the menu,
  // so there's no window where a stray listener outlives the component.
  private handleDocumentPointerDown = (e: Event) => {
    if (!this.clanMenuOpen) return;
    if (e.composedPath().includes(this)) return;
    this.clanMenuOpen = false;
  };

  private handleClanMenuKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    this.clanMenuOpen = false;
    this.querySelector<HTMLElement>("#clan-tag-button")?.focus();
  }

  // Pick one of the player's own clans (or clear the tag). Tags come from the
  // API already valid, so this skips the sanitising the free-text path needs —
  // but still runs the ownership check so getClanCheck() stays authoritative.
  private selectClan(tag: string | null) {
    this.clanTag = tag ?? "";
    this.clanDraft = "";
    this.clanMenuOpen = false;
    this.validateAndStore();
    this.startClanCheck();
  }

  private openClanBrowser = () => {
    this.clanMenuOpen = false;
    window.showPage?.("page-clan");
  };

  // The server-resolved bare name this player may play verified under, or null
  // when ineligible. Sub-only by design: `claimed` (lapsed) holders and
  // TEMPORARY####-renamed players don't qualify.
  private verifiedName(): string | null {
    if (this.userMe === null || this.userMe === false) return null;
    const player = this.userMe.player;
    const status = player.usernameStatus;
    if (status !== "premium" && status !== "indefinite") return null;
    if (!player.username || isTemporaryUsername(player.usernameBase)) {
      return null;
    }
    return player.username;
  }

  // Turn the toggle on iff the player opted in previously AND is still
  // eligible; silently off otherwise (logout, lapsed sub, TEMPORARY rename).
  // Never auto-enables without a stored opt-in — players who want to stay
  // anonymous must be able to play under an unrelated name.
  private applyVerifiedPreference() {
    this.verifiedActive =
      !this.onCrazyGames &&
      localStorage.getItem(useVerifiedNameKey) === "true" &&
      this.verifiedName() !== null;
    this.requestUpdate();
    this.validateAndStore();
  }

  private async handleVerifiedToggle() {
    // verifiedActive implies eligible (applyVerifiedPreference), so this
    // covers both turning off and an eligible turn-on.
    if (this.verifiedActive || this.verifiedName() !== null) {
      this.verifiedActive = !this.verifiedActive;
      localStorage.setItem(useVerifiedNameKey, String(this.verifiedActive));
      this.validateAndStore();
      return;
    }
    // Ineligible — the toggle can't turn on.
    const player = this.userMe === false ? undefined : this.userMe?.player;
    const status = player?.usernameStatus;
    if (status === "premium" || status === "indefinite") {
      // Subscribed but no usable name yet (never set, or TEMPORARY####):
      // send them straight to the username form.
      window.location.hash = "modal=change-username";
      return;
    }
    const goStore = await showInGameConfirm(
      translateText("username.verified_sub_required"),
      {
        heading: translateText("username.verified_heading"),
        variant: "warning",
        confirmText: translateText("username.verified_sub_required_confirm"),
      },
    );
    if (goStore) {
      window.location.hash = "modal=store&tab=subscriptions";
    }
  }

  public getUsername(): string {
    if (this.verifiedActive) {
      const verified = this.verifiedName();
      if (verified !== null) return verified;
    }
    return this.baseUsername.trim();
  }

  /** True when the player is playing under their verified account name. */
  public isVerified(): boolean {
    return this.verifiedActive && this.verifiedName() !== null;
  }

  public getClanTag(): string | null {
    return this.clanTag.length >= MIN_CLAN_TAG_LENGTH &&
      this.clanTag.length <= MAX_CLAN_TAG_LENGTH &&
      validateClanTag(this.clanTag).isValid
      ? this.clanTag
      : null;
  }

  public clearClanTag(expectedTag?: string): void {
    if (
      expectedTag !== undefined &&
      this.clanTag.toUpperCase() !== expectedTag.toUpperCase()
    ) {
      return;
    }
    this.clanTag = "";
    this.clanDraft = "";
    this.clanTagOwnershipError = "";
    this.validateAndStore();
    this.startClanCheck();
    this.requestUpdate();
  }

  // Resolves to the clan tag to actually submit (null when it should be
  // dropped). The join flow awaits this so the ownership check — kicked off on
  // input — can run in parallel with the WebSocket handshake.
  public getClanCheck(): Promise<string | null> {
    return this.clanCheck;
  }

  // Resolves once the one-shot Steam name-seed has settled (immediately for
  // non-Steam players, or once nothing was left to seed). The join flow awaits
  // this before reading getUsername() so a fast join reads the Steam persona
  // rather than the interim generated anon name. Never blocks: the underlying
  // chain always resolves, even when getUser() fails or the persona is invalid.
  public whenSeeded(): Promise<void> {
    return this.steamSeedReady;
  }

  private startClanCheck() {
    const gen = ++this.clanCheckGen;
    const tag = this.clanTag;
    this.clanTagOwnershipError = "";
    this.emitValidity();
    if (tag.length === 0 || !validateClanTag(tag).isValid) {
      this.clanCheckPending = false;
      this.clanCheck = Promise.resolve(null);
      return;
    }
    this.clanCheckPending = true;
    this.clanCheck = checkClanTagOwnership(tag).then((res) => {
      if (gen === this.clanCheckGen) {
        this.clanTagOwnershipError = res.error ?? "";
        this.clanCheckPending = false;
        this.emitValidity();
      }
      return res.tag;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, {
      capture: true,
    });
    // The userMeResponse event can fire before this element connects (it is
    // dispatched once, right after auth resolves), which would leave the clan
    // picker and the verified toggle empty. getUserMe() is cached, so this is
    // a read of the same response rather than a second request.
    void getUserMe().then((me) => {
      if (this.userMe !== null) return;
      this.userMe = me;
      this.applyVerifiedPreference();
    });
    // Captured before loadStoredUsername(), which — when nothing is stored —
    // fills in a fresh anon username AND persists it immediately. Checking
    // localStorage afterwards would therefore never see it as empty.
    const noStoredUsername = this.onSteam && !localStorage.getItem(usernameKey);
    this.loadStoredUsername();
    // On CrazyGames the account username is applied here but never persisted
    // (see loadStoredUsername / validateAndStore), so logging out — which
    // reloads the whole page — falls back to a fresh guest username instead of
    // keeping the account name. addAuthListener only fires on login; CrazyGames
    // refreshes the page on logout, so there is no logout event to handle.
    crazyGamesSDK.getUsername().then((username) => {
      if (username) {
        this.baseUsername = username;
        this.validateAndStore();
      }
    });
    crazyGamesSDK.addAuthListener((user) => {
      if (user) {
        this.baseUsername = user.username;
        this.validateAndStore();
      }
    });
    // Seed the in-game name from the Steam persona, once, only when nothing
    // is stored yet. Unlike CrazyGames, Steam persists normally (see
    // validateAndStore's onCrazyGames guard), and there's no logout event to
    // handle since the Steam identity is fixed for the session.
    if (noStoredUsername) {
      // The anon name loadStoredUsername() just generated. Only overwrite it if
      // the player hasn't typed their own name while getUser() was in flight,
      // so a late Steam result never clobbers a name they entered.
      const generated = this.baseUsername;
      // Store the seeding promise so the join path can await it (see
      // whenSeeded). The chain never rejects — on any failure we keep the
      // generated name — so awaiting it can only delay, never block, a join.
      this.steamSeedReady = steamSDK
        .getUser()
        .then((user) => {
          if (this.baseUsername !== generated) return;
          // Steam personas can contain characters our usernames disallow (e.g.
          // brackets) or exceed the length limit; strip brackets, trim, and only
          // accept the persona if it validates — otherwise keep the generated
          // name so the player can always start a game.
          const candidate = user?.name?.replace(/[[\]]/g, "").trim();
          if (candidate && validateUsername(candidate).isValid) {
            this.baseUsername = candidate;
            this.validateAndStore();
          }
        })
        .catch(() => {
          // Swallow: keep the generated name so the player can always play.
        });
    }
  }

  disconnectedCallback() {
    document.removeEventListener(
      "pointerdown",
      this.handleDocumentPointerDown,
      {
        capture: true,
      },
    );
    this.clanMenuOpen = false;
    super.disconnectedCallback();
  }

  protected updated(): void {
    // Re-validate when translations become available or language changes,
    // since initial validation may run before translations are loaded.
    if (this.validationError) {
      const langSelector = document.querySelector<LangSelectorLike & Element>(
        "lang-selector",
      );
      const lang = langSelector?.currentLang;
      const hasTranslations =
        langSelector?.translations ?? langSelector?.defaultTranslations;
      if (hasTranslations && lang && lang !== this._lastValidatedLang) {
        this._lastValidatedLang = lang;
        this.validateAndStore();
      }
    }
  }

  private loadStoredUsername() {
    // On CrazyGames the username is never persisted, so ignore any stored value
    // and start from a fresh guest name; the account name (if signed in) is
    // applied afterwards in connectedCallback.
    const storedUsername = this.onCrazyGames
      ? null
      : localStorage.getItem(usernameKey);
    if (storedUsername) {
      this.clanTag = localStorage.getItem(clanTagKey) ?? "";
      this.baseUsername = storedUsername;
      this.validateAndStore();
      this.startClanCheck();
    } else {
      this.baseUsername = genAnonUsername();
      this.validateAndStore();
    }
  }

  render() {
    return html`
      <!-- Centred rather than stretched: on a wide play page (no live
           streamers, so the identity strip spans the whole column) a
           full-bleed name field is a lot of empty box. The fields keep a
           readable cap and the slack splits either side of the group. -->
      <div
        class="flex items-center justify-center w-full h-full gap-1.5 sm:gap-2"
      >
        ${this.renderClanControl()} ${this.renderNameControl()}
      </div>
      ${this.validationError
        ? html`<div
            id="username-validation-error"
            class="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
          >
            ${this.validationError}
          </div>`
        : this.clanTagOwnershipError
          ? this.renderClanTagOwnershipError()
          : null}
    `;
  }

  // Clan tag picker. Members pick from their own clans instead of guessing a
  // tag and waiting for the ownership check to reject it; the menu still
  // carries a free-text field for everyone else (signed out, or a clan they
  // have not joined yet).
  private renderClanControl() {
    const tag = this.clanTag;
    const invalid = this.clanTagOwnershipError !== "";
    return html`
      <!-- Escape is bound here rather than on the menu: the trigger keeps
           focus when the menu opens, and it is the menu's sibling, so a
           menu-level handler would never see the key. -->
      <div
        class="no-crazygames relative shrink-0 h-full max-h-[44px]"
        @keydown=${this.handleClanMenuKeydown}
      >
        <button
          type="button"
          id="clan-tag-button"
          class="flex h-full w-[8.25rem] sm:w-[9rem] items-center justify-between gap-1 rounded-lg border px-2 transition-colors cursor-pointer ${invalid
            ? "border-red-400/70 bg-red-500/10"
            : this.clanMenuOpen
              ? "border-white/40 bg-black/40"
              : "border-white/15 bg-black/25 hover:border-white/30 hover:bg-black/40"}"
          aria-haspopup="dialog"
          aria-expanded=${this.clanMenuOpen ? "true" : "false"}
          aria-busy=${this.clanCheckPending ? "true" : "false"}
          aria-invalid=${invalid ? "true" : "false"}
          aria-label=${translateText("username.clan_label")}
          title=${translateText("username.clan_label")}
          @click=${this.toggleClanMenu}
        >
          <span
            class="min-w-0 flex-1 truncate text-base sm:text-lg font-semibold uppercase tracking-wider text-left ${tag
              ? "text-white"
              : "text-white/45"}"
            >${tag || translateText("username.tag")}</span
          >
          ${this.clanCheckPending
            ? html`<span
                class="w-3 h-3 shrink-0 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"
                aria-hidden="true"
              ></span>`
            : html`<svg
                viewBox="0 0 20 20"
                fill="currentColor"
                class="w-3.5 h-3.5 shrink-0 text-white/45"
                aria-hidden="true"
              >
                <path
                  d="M5.5 7.5 10 12l4.5-4.5"
                  stroke="currentColor"
                  stroke-width="2"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>
              </svg>`}
        </button>
        ${this.clanMenuOpen ? this.renderClanMenu() : null}
      </div>
    `;
  }

  private renderClanMenu() {
    const clans = this.myClans();
    const active = this.clanTag.toUpperCase();
    return html`
      <div
        id="clan-tag-menu"
        role="dialog"
        aria-labelledby="clan-tag-button"
        class="absolute left-0 top-full z-50 mt-1.5 w-[17rem] max-w-[80vw] rounded-xl border border-white/15 bg-surface/95 p-1.5 shadow-xl backdrop-blur-md"
      >
        ${clans.length > 0
          ? html`
              <div
                class="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40"
              >
                ${translateText("username.clan_your_clans")}
              </div>
              <div class="max-h-56 overflow-y-auto">
                ${clans.map(
                  (clan) => html`
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${clan.tag.toUpperCase() ===
                      active
                        ? "bg-malibu-blue/25"
                        : "hover:bg-white/10"}"
                      @click=${() => this.selectClan(clan.tag)}
                    >
                      <span
                        class="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-sm font-bold uppercase tracking-wider text-white"
                        >${clan.tag}</span
                      >
                      <span
                        class="min-w-0 flex-1 truncate text-sm text-white/80"
                        >${clan.name}</span
                      >
                      ${clan.tag.toUpperCase() === active
                        ? html`<svg
                            viewBox="0 0 24 24"
                            class="w-4 h-4 shrink-0 text-malibu-blue"
                            aria-hidden="true"
                          >
                            <path
                              d="M5 12.5l4.5 4.5L19 7"
                              stroke="currentColor"
                              stroke-width="2.5"
                              fill="none"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            ></path>
                          </svg>`
                        : null}
                    </button>
                  `,
                )}
              </div>
            `
          : html`<div class="px-2 pt-1.5 pb-1 text-sm text-white/50">
              ${translateText("username.clan_none_joined")}
            </div>`}
        <div class="mt-1.5 border-t border-white/10 pt-1.5">
          <label
            class="block px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/40"
            for="clan-tag-manual"
            >${translateText("username.clan_custom")}</label
          >
          <input
            id="clan-tag-manual"
            type="text"
            .value=${this.clanDraft}
            @input=${this.handleClanTagChange}
            placeholder=${translateText("username.tag")}
            minlength="${MIN_CLAN_TAG_LENGTH}"
            maxlength="${MAX_CLAN_TAG_LENGTH}"
            class="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-base font-semibold uppercase tracking-wider text-white placeholder-white/30 focus:border-malibu-blue/60 focus:outline-none"
          />
        </div>
        <div
          class="mt-1.5 flex items-center gap-2 border-t border-white/10 pt-1.5"
        >
          ${this.clanTag
            ? html`<button
                type="button"
                class="rounded-lg px-2 py-1 text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                @click=${() => this.selectClan(null)}
              >
                ${translateText("username.clan_clear")}
              </button>`
            : null}
          <button
            type="button"
            class="ml-auto rounded-lg px-2 py-1 text-sm text-malibu-blue hover:bg-malibu-blue/15 transition-colors cursor-pointer"
            @click=${this.openClanBrowser}
          >
            ${translateText("username.clan_browse")}
          </button>
        </div>
      </div>
    `;
  }

  // Name field. Verified play swaps the free-text input for a badge-led chip so
  // the state reads as "this is my account name", not "the input broke".
  private renderNameControl() {
    if (this.verifiedActive) {
      return html`
        <div
          class="flex min-w-0 flex-1 max-w-[24rem] h-full max-h-[44px] items-center gap-1.5 rounded-lg border border-malibu-blue/70 bg-malibu-blue/15 px-2 sm:px-2.5"
          title=${translateText("username.verified_active_hint")}
        >
          <!-- Check trails the name, as it does everywhere else a verified
               name is rendered (PlayerName, lobby lists, profile modal). The
               name shrinks rather than growing, so the mark keeps hugging it
               instead of drifting to the far edge. -->
          <span
            class="min-w-0 truncate text-xl sm:text-2xl font-medium tracking-wider text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]"
            >${this.verifiedName() ?? ""}</span
          >
          ${verifiedBadge("w-5 h-5 sm:w-6 sm:h-6", "text-aquarius")}
          <span
            class="hidden md:inline ml-auto shrink-0 rounded bg-malibu-blue/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
            >${translateText("username.verified_toggle")}</span
          >
        </div>
        <button
          type="button"
          class="no-crazygames shrink-0 rounded-lg border border-white/15 bg-black/25 px-2 h-full max-h-[44px] text-sm font-medium text-white/70 transition-colors hover:border-white/30 hover:bg-black/40 hover:text-white cursor-pointer"
          title=${translateText("username.verified_use_custom")}
          aria-label=${translateText("username.verified_use_custom")}
          @click=${this.handleVerifiedToggle}
        >
          <span class="hidden sm:inline"
            >${translateText("username.verified_use_custom_short")}</span
          >
          <svg
            viewBox="0 0 24 24"
            class="sm:hidden w-4 h-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </button>
      `;
    }

    const eligible = this.verifiedName() !== null;
    return html`
      <input
        type="text"
        .value=${this.baseUsername}
        @input=${this.handleUsernameChange}
        placeholder="${translateText("username.enter_username")}"
        minlength="${MIN_USERNAME_LENGTH}"
        maxlength="${MAX_USERNAME_LENGTH}"
        aria-label=${translateText("username.enter_username")}
        class="min-w-0 flex-1 max-w-[24rem] h-full max-h-[44px] rounded-lg border border-white/15 bg-black/25 px-2 sm:px-3 text-xl sm:text-2xl font-medium tracking-wider text-left text-white placeholder-white/40 transition-colors hover:border-white/30 focus:border-malibu-blue/60 focus:outline-none focus:ring-0 text-ellipsis [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]"
      />
      <button
        type="button"
        class="no-crazygames group flex shrink-0 h-full max-h-[44px] items-center gap-1.5 rounded-lg border px-2 transition-colors cursor-pointer select-none ${eligible
          ? "border-malibu-blue/50 bg-malibu-blue/10 hover:border-malibu-blue/80 hover:bg-malibu-blue/20"
          : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-black/35"}"
        title=${translateText("username.verified_use_hint")}
        aria-pressed="false"
        @click=${this.handleVerifiedToggle}
      >
        ${verifiedBadge(
          "w-5 h-5 transition-colors",
          eligible ? "text-aquarius" : "text-white/25 group-hover:text-white/45",
          null,
        )}
        <span
          class="hidden sm:inline text-sm font-medium whitespace-nowrap transition-colors ${eligible
            ? "text-white"
            : "text-white/60 group-hover:text-white/90"}"
          >${translateText("username.verified_use")}</span
        >
      </button>
    `;
  }

  private renderClanTagOwnershipError() {
    const content = translateText(this.clanTagOwnershipError, {
      tag: this.clanTag,
    });
    const className =
      "absolute top-full left-0 z-50 mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg lg:whitespace-nowrap";

    if (this.clanTagOwnershipError !== "username.tag_not_member") {
      return html`<div id="clan-tag-validation-error" class=${className}>
        ${content}
      </div>`;
    }

    const tag = this.clanTag;
    return html`<button
      id="clan-tag-validation-error"
      type="button"
      class="${className} underline decoration-red-200/50 underline-offset-2 hover:bg-red-800/90 focus:outline-none focus:ring-2 focus:ring-red-200/70"
      @click=${() => this.openClanJoinModal(tag)}
    >
      ${content}
    </button>`;
  }

  private openClanJoinModal(tag: string) {
    window.showPage?.("page-clan");
    void customElements.whenDefined("clan-modal").then(() => {
      document
        .querySelector<
          HTMLElement & { open: (args: { tag: string }) => void }
        >("clan-modal")
        ?.open({ tag });
    });
  }

  private handleClanTagChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = sanitizeClanTag(originalValue);
    // Only show toast if characters were actually removed (not just uppercased)
    if (originalValue.toUpperCase() !== val) {
      input.value = val;
      // Show toast when invalid characters are removed
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.tag_invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    } else if (originalValue !== val) {
      // Just update the input without toast if only case changed
      input.value = val;
    }
    this.clanTag = val;
    this.clanDraft = val;
    this.validateAndStore();
    this.startClanCheck();
  }

  private handleUsernameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== val) {
      input.value = val;
      // Show toast when brackets are removed
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    this.baseUsername = val;
    this.validateAndStore();
  }

  private validateAndStore() {
    const trimmedBase = this.getUsername();

    const clanTagResult = validateClanTag(this.clanTag);
    if (!clanTagResult.isValid) {
      this._isValid = false;
      this.validationError = clanTagResult.error ?? "";
      this.emitValidity();
      return;
    }

    // Playing under the verified account name: it's server-issued, so skip
    // free-form validation and leave the stored free-form name untouched for
    // when the toggle turns off.
    if (this.verifiedActive) {
      this._isValid = true;
      this.validationError = "";
      if (!this.onCrazyGames) {
        localStorage.setItem(clanTagKey, this.getClanTag() ?? "");
      }
      this.emitValidity();
      return;
    }

    const result = validateUsername(trimmedBase);
    this._isValid = result.isValid;
    if (result.isValid) {
      // Never persist on CrazyGames: keeping localStorage empty means a logout
      // (page reload) restores a guest username instead of the account name.
      if (!this.onCrazyGames) {
        localStorage.setItem(usernameKey, trimmedBase);
        localStorage.setItem(clanTagKey, this.getClanTag() ?? "");
      }
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
    this.emitValidity();
  }

  // Broadcast play-eligibility so action buttons can disable themselves.
  private emitValidity() {
    window.dispatchEvent(
      new CustomEvent("username-validity-change", {
        detail: { isValid: this.canPlay() },
      }),
    );
  }

  // Play-eligibility: syntax-valid and not blocked by clan membership.
  public canPlay(): boolean {
    return (
      this._isValid && this.clanTagOwnershipError !== "username.tag_not_member"
    );
  }
}

// Whether the player is currently playing under their verified account name.
// For join paths that can't reach the component instance (Cosmetics refs).
export function isPlayingVerified(): boolean {
  const el = document.querySelector<UsernameInput>("username-input");
  return el?.isVerified() ?? false;
}

// A memorable anonymous username: "Anon" + animal (+ digit). Draws from the same
// word bank as the server-side anonymisation overlay, but keeps the "Anon" prefix
// that the overlay drops — here it tells the player their name is a placeholder.
// Client-side fallback for players who never set a name — no roster here, so it
// draws a random slot (best-effort-unique); the overlay is what guarantees
// uniqueness in-game.
//
// Rejection-sample a uniform slot in [0, bound) from the CSPRNG: drawing a raw
// uint32 and taking `% bound` would be very slightly biased (the top partial
// bucket), so we discard the unrepresentable tail first. The bias is cosmetically
// irrelevant here, but this keeps the draw provably uniform.
export function genAnonUsername(): string {
  const bound = ANON_WORDS.length * 10;
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buf = new Uint32Array(1);
  let rand: number;
  do {
    crypto.getRandomValues(buf);
    rand = buf[0] ?? 0;
  } while (rand >= limit);
  // The "Anon" prefix lives HERE, not in anonWordName: a signed-out player's
  // handle should say it is a placeholder, whereas the in-game anonymisation
  // setting makes everyone anonymous and gains nothing from repeating the word.
  return `Anon${anonWordName(rand % bound)}`;
}
