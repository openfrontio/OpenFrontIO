import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { ANON_ANIMALS, anonAnimalName } from "../core/AnonAnimals";
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
import { checkClanTagOwnership } from "./ClanApi";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { showInGameConfirm } from "./InGameModal";

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

  @property({ type: String }) validationError: string = "";
  // Ownership-check feedback (i18n key) shown inline beneath the tag input. Only
  // "not a member" gates the buttons (see emitValidity); the rest is advisory.
  @state() private clanTagOwnershipError: string = "";
  @state() private clanCheckPending: boolean = false;
  private _isValid: boolean = true;
  private _lastValidatedLang: string | null = null;

  // Latest in-flight ownership check. `clanCheckGen` discards stale results so
  // only the most recent keystroke updates the UI / resolves the submit value.
  private clanCheckGen = 0;
  private clanCheck: Promise<string | null> = Promise.resolve(null);

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
    // A rename in the account modal mutates the shared player object in place;
    // recompute so an active verified name reflects the new name (or drops if
    // the rename made the player ineligible).
    window.addEventListener("username-changed", () => {
      this.applyVerifiedPreference();
    });
  }

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
      // send them to the account modal to pick one.
      window.location.hash = "modal=account";
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
      window.location.hash = "modal=store";
    }
  }

  public getUsername(): string {
    if (this.verifiedActive) {
      const verified = this.verifiedName();
      if (verified !== null) return verified;
    }
    return this.baseUsername.trim();
  }

  public getClanTag(): string | null {
    return this.clanTag.length >= MIN_CLAN_TAG_LENGTH &&
      this.clanTag.length <= MAX_CLAN_TAG_LENGTH &&
      validateClanTag(this.clanTag).isValid
      ? this.clanTag
      : null;
  }

  // Resolves to the clan tag to actually submit (null when it should be
  // dropped). The join flow awaits this so the ownership check — kicked off on
  // input — can run in parallel with the WebSocket handshake.
  public getClanCheck(): Promise<string | null> {
    return this.clanCheck;
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
      <div class="flex items-center w-full h-full gap-2">
        <div class="no-crazygames relative flex items-center shrink-0">
          <input
            type="text"
            .value=${this.clanTag}
            @input=${this.handleClanTagChange}
            placeholder="${translateText("username.tag")}"
            minlength="${MIN_CLAN_TAG_LENGTH}"
            maxlength="${MAX_CLAN_TAG_LENGTH}"
            aria-busy=${this.clanCheckPending ? "true" : "false"}
            aria-invalid=${this.clanTagOwnershipError ? "true" : "false"}
            class="w-[6rem] text-xl font-medium tracking-wider text-center uppercase bg-transparent text-white placeholder-white/70 focus:placeholder-transparent border-0 border-b border-white/40 focus:outline-none focus:border-white/60"
          />
          ${this.clanCheckPending
            ? html`<span
                class="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-white/30 border-t-white/80 rounded-full animate-spin pointer-events-none"
                aria-hidden="true"
              ></span>`
            : null}
        </div>
        <input
          type="text"
          .value=${this.verifiedActive
            ? (this.verifiedName() ?? "")
            : this.baseUsername}
          @input=${this.handleUsernameChange}
          placeholder="${translateText("username.enter_username")}"
          minlength="${MIN_USERNAME_LENGTH}"
          maxlength="${MAX_USERNAME_LENGTH}"
          ?disabled=${this.verifiedActive}
          class="flex-1 min-w-0 border-0 text-2xl font-medium tracking-wider text-left text-white placeholder-white/70 focus:outline-none focus:ring-0 overflow-x-auto whitespace-nowrap text-ellipsis pr-2 bg-transparent"
        />
        <button
          type="button"
          class="no-crazygames group flex items-center gap-1.5 shrink-0 cursor-pointer select-none"
          title=${translateText("username.verified_heading")}
          aria-pressed=${this.verifiedActive ? "true" : "false"}
          @click=${this.handleVerifiedToggle}
        >
          <svg
            viewBox="0 0 24 24"
            class="w-5 h-5 transition-colors ${this.verifiedActive
              ? "text-blue-400"
              : "text-white/30 group-hover:text-white/50"}"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" fill="currentColor"></circle>
            <path
              d="M7.5 12.5l3 3 6-6.5"
              stroke="white"
              stroke-width="2.2"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></path>
          </svg>
          <span
            class="hidden sm:inline text-sm font-medium transition-colors ${this
              .verifiedActive
              ? "text-blue-400"
              : "text-white/70 group-hover:text-white"}"
            >${translateText("username.verified_toggle")}</span
          >
        </button>
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

// A memorable anonymous username: "Anon" + animal (+ digit), the same handle
// format the server-side anonymisation overlay uses (anonAnimalName). Client-side
// fallback for players who never set a name — no roster here, so it draws a
// random slot (best-effort-unique); the overlay is what guarantees uniqueness
// in-game.
//
// Rejection-sample a uniform slot in [0, bound) from the CSPRNG: drawing a raw
// uint32 and taking `% bound` would be very slightly biased (the top partial
// bucket), so we discard the unrepresentable tail first. The bias is cosmetically
// irrelevant here, but this keeps the draw provably uniform.
export function genAnonUsername(): string {
  const bound = ANON_ANIMALS.length * 10;
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buf = new Uint32Array(1);
  let rand: number;
  do {
    crypto.getRandomValues(buf);
    rand = buf[0] ?? 0;
  } while (rand >= limit);
  return anonAnimalName(rand % bound);
}
