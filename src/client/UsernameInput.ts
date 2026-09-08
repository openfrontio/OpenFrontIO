import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import { sanitizeClanTag } from "../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_CLAN_TAG_LENGTH,
  MIN_USERNAME_LENGTH,
  validateClanTag,
  validateUsername,
} from "../core/validations/username";
import { getUserMe, invalidateUserMe } from "./Api";
import { checkClanTagOwnership } from "./ClanApi";
import { verifiedBadge } from "./components/ui/VerifiedBadge";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { showInGameAlert, showInGameConfirm } from "./InGameModal";
import {
  accountVerifiedName,
  clampUsername,
  genAnonUsername,
  looksGenerated,
  resolvePlayerName,
  verifiedClaimGrace,
  verifiedNameOptIn,
  type ClaimGrace,
  type ResolvedPlayerName,
} from "./PlayerName";
import { steamSDK } from "./SteamSDK";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

const usernameKey: string = "username";
const clanTagKey: string = "clanTag";
const useVerifiedNameKey: string = "useVerifiedName";
// "The stored username is one we generated, not one the player chose." Written
// alongside the name itself; see usernameIsGenerated.
const usernameIsGeneratedKey: string = "usernameIsGenerated";
// Whether the verified-name default may apply to this profile at all. Decided
// once, the first time this code runs here, and never revisited. See
// resolveVerifiedDefaultCohort.
const verifiedDefaultAllowedKey: string = "verifiedNameDefaultAllowed";
// The reserved name we have already warned this device about; see
// announceLapse. Holds a name, not a boolean, so a later lapse still speaks up.
const lapseNoticeKey: string = "verifiedLapseNotice";
// setTimeout stores its delay in a 32-bit signed int. Anything larger does not
// saturate — Node warns and fires after 1ms.
const MAX_TIMEOUT_MS = 2_147_483_647;

// Announced by the clan modal, which invalidates /users/@me but dispatches no
// fresh userMeResponse.
const CLAN_REMOVED_EVENTS = ["clan-left", "clan-disbanded"];
const CLAN_MEMBERSHIP_EVENTS = ["clan-joined", ...CLAN_REMOVED_EVENTS];

// Decide, once per profile, whether the verified-name default is allowed to
// apply here — and record it, because the evidence is destroyed moments later.
//
// The default exists for players who have never seen the toggle. But "no
// stored preference" does not mean that on its own: before the default
// existed the toggle rendered off and the only writer of the preference was a
// click, so an existing eligible subscriber who looked at it and left it alone
// is in exactly the same state as a brand-new install. Turning that player's
// real account name on without them touching anything is a silent public
// identity change, which is the opposite of what a privacy default is for.
//
// A stored username is the only durable trace a profile leaves, and
// validateAndStore is its only writer — so at construction, before
// loadStoredUsername runs, "no stored username" means "this profile has never
// played here". That is the whole discriminator.
//
// It has to be recorded rather than recomputed: one boot later the new profile
// has a stored username too and would be indistinguishable from an old one, so
// a re-mount or a reload would revoke the default it had just granted.
function resolveVerifiedDefaultCohort(onCrazyGames: boolean): void {
  // CrazyGames never persists a username (see validateAndStore), so there is
  // no history to read, and verifiedActive is gated off there regardless.
  if (onCrazyGames) return;
  if (localStorage.getItem(verifiedDefaultAllowedKey) !== null) return;
  // An answered preference makes the default moot either way; record the
  // decision anyway so this never re-runs against a profile that has since
  // acquired a stored username.
  const answered = localStorage.getItem(useVerifiedNameKey) !== null;
  const hasPlayedHere = localStorage.getItem(usernameKey) !== null;
  localStorage.setItem(
    verifiedDefaultAllowedKey,
    String(!answered && !hasPlayedHere),
  );
}

// Same format the account modal's grace warning uses, so the two places that
// name this deadline read alike. Local rather than shared: every component in
// this codebase that shows a date formats its own (FriendsList, TribesPanel,
// SubscriptionPanel, UsernamePanel).
function formatClaimDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Shared by the input and the verified chip, which swap places: any drift in
// box or text metrics shows up as the name jumping on toggle.
const NAME_BOX =
  "min-w-0 flex-1 h-full max-h-[44px] rounded-lg bg-transparent px-2 sm:px-3";
// `line-height: normal` because that is what an <input> uses for its editor
// box; the span only lands on the same pixel when it sizes from font metrics
// too. Any fixed leading drifts a pixel under some fonts.
const NAME_TEXT =
  "text-xl/[normal] sm:text-2xl/[normal] font-medium tracking-wider " +
  "[text-shadow:0_1px_2px_rgba(0,0,0,0.9)]";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  @state() private clanTag: string = "";
  // Playing under the account's verified bare name (sub-only). The free-form
  // name stays in baseUsername/localStorage so unchecking restores it.
  @state() private verifiedActive: boolean = false;
  private userMe: UserMeResponse | false | null = null;
  // The raw Steam persona, once it lands. Kept alongside the free-form name so
  // resolution sees the same inputs the seed did (see resolvedName).
  private persona: string | null = null;
  // Minted once so re-resolving is stable: the player must never watch their
  // placeholder name change under them.
  private readonly generatedName: string = genAnonUsername();
  // Whether the name in baseUsername is one we generated rather than one the
  // player chose. Persisted, because one localStorage string cannot tell the
  // two apart and the reseed rule turns entirely on the difference.
  private usernameIsGenerated: boolean = false;
  // The bare name still reserved for this player and its deadline, while a
  // lapsed subscription's grace clock runs. Null whenever nothing is at stake.
  @state() private claimGrace: ClaimGrace | null = null;
  // Fires once, at the reservation's deadline, so a client left open across it
  // drops the notice instead of counting down to a date already past. The
  // grace value itself only changes on account events, which a sitting client
  // never receives.
  private claimGraceTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Same guard for the profile: an uncached picker refresh and a clan-event
  // refresh can overlap, and the older one settling last would reinstate the
  // membership the newer one just corrected.
  private userMeGen = 0;

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
    // Before anything can write a username: this reads the absence of one as
    // "this profile is new", and loadStoredUsername destroys that evidence.
    resolveVerifiedDefaultCohort(this.onCrazyGames);
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

  // Without this the picker keeps listing whatever clans the player had at
  // page load.
  private handleClanMembershipChange = (e: Event) => {
    const tag = (e as CustomEvent<{ tag?: string }>).detail?.tag;
    // Same as a server-side rejection (see Matchmaking). Disbanding counts.
    if (CLAN_REMOVED_EVENTS.includes(e.type) && tag) this.clearClanTag(tag);
    // The clan flows invalidate the cache before announcing.
    this.refreshMembership();
  };

  private refreshMembership(opts: { fresh?: boolean } = {}) {
    void this.refreshUserMe(opts).then((refreshed) => {
      // Only worth re-running against membership we actually have. The check
      // reads getUserMe itself, so after an inconclusive refresh it sees the
      // cached false, takes the player for a member of nothing, and reports
      // their own clan as "not a member" — disabling play until some later
      // invalidation happens to succeed.
      //
      // Re-run when it is conclusive: the "not a member" error links into the
      // clan modal, so joining is the usual way out of it, and both the error
      // and clanCheck stick until the check runs again.
      if (refreshed && this.clanTag) this.startClanCheck();
    });
  }

  private refreshUserMe(opts: { fresh?: boolean } = {}): Promise<boolean> {
    // Membership also changes server-side (kicked, or a request approved)
    // without invalidating this tab's cache, so a plain refresh would re-read
    // the page-load snapshot.
    if (opts.fresh) invalidateUserMe();
    const gen = ++this.userMeGen;
    return getUserMe().then((me) => {
      // Superseded: a newer refresh is in flight and will do this itself.
      if (gen !== this.userMeGen) return false;
      // `false` here is a transient failure — a network error or non-200,
      // cached either way — so keep the snapshot rather than silently
      // dropping the player to their free-form name. An expired session is
      // not this: clearing the session announces itself (see Auth).
      if (me === false) return false;
      this.userMe = me;
      this.applyVerifiedPreference();
      return true;
    });
  }

  private toggleClanMenu = () => {
    this.clanMenuOpen = !this.clanMenuOpen;
    if (this.clanMenuOpen) {
      this.refreshMembership({ fresh: true });
      // Tracked separately from clanTag so typing a tag that matches a listed
      // clan doesn't blank the field mid-keystroke.
      const active = this.clanTag.toUpperCase();
      this.clanDraft = this.myClans().some(
        (c) => c.tag.toUpperCase() === active,
      )
        ? ""
        : this.clanTag;
    }
  };

  // Bound for the element's lifetime rather than with the menu, so no stray
  // listener can outlive it.
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

  // API tags are already valid, so no sanitising — but the ownership check
  // still runs, keeping getClanCheck() authoritative.
  private selectClan(tag: string | null) {
    this.clanTag = tag ?? "";
    this.clanDraft = "";
    this.clanMenuOpen = false;
    this.validateAndStore();
    this.startClanCheck();
  }

  // "Browse clans" has to name the tab explicitly: showPage alone opens the
  // modal on its default my-clans tab, which is not what the label promises.
  private openClanBrowser = () => {
    this.clanMenuOpen = false;
    window.showPage?.("page-clan");
    void customElements.whenDefined("clan-modal").then(() => {
      document
        .querySelector<
          HTMLElement & { open: (args: { tab: string }) => void }
        >("clan-modal")
        ?.open({ tab: "browse" });
    });
  };

  // The bare name this player may play verified under, or null when
  // ineligible. The rule itself lives in PlayerName so the join path and the
  // resolver can't disagree with the toggle about who qualifies.
  private verifiedName(): string | null {
    return accountVerifiedName(this.userMe);
  }

  // Turn the toggle on iff the player has not opted out AND is still eligible;
  // silently off otherwise (logout, lapsed sub, TEMPORARY rename).
  //
  // "Has not opted out" rather than "opted in": the preference is tri-state,
  // and an absent one defaults on only for a profile we identified as new
  // (see verifiedNameOptIn and resolveVerifiedDefaultCohort). An existing
  // player with no stored preference is treated as having declined.
  //
  // The default is deliberately never written back into the preference. The
  // cohort marker records what we observed about the profile; recording an
  // opt-in the player never expressed is a different thing, and it is the
  // value account-level settings sync would later propagate.
  private applyVerifiedPreference() {
    this.verifiedActive =
      !this.onCrazyGames &&
      verifiedNameOptIn(
        localStorage.getItem(useVerifiedNameKey),
        localStorage.getItem(verifiedDefaultAllowedKey) === "true",
      ) &&
      this.verifiedName() !== null;
    this.refreshClaimGrace();
    this.requestUpdate();
    this.validateAndStore();
  }

  // Re-derive the reservation, re-arm the clock, and speak up if the phase
  // changed. Every path that can move this state goes through here — an
  // account event, the expiry timer, and reconnecting — so none of them can
  // do two of the three and silently skip the other. That is exactly how the
  // banner once escalated with no alert behind it, and how reconnecting past
  // a deadline left the stale wording in place.
  private refreshClaimGrace() {
    this.claimGrace = verifiedClaimGrace(this.userMe);
    this.scheduleClaimGraceExpiry();
    this.announceLapse();
  }

  // Escalate the notice the moment the reservation lapses.
  //
  // verifiedClaimGrace is evaluated only when account state changes, and a
  // client sitting on the main menu receives none — so without this the notice
  // would keep saying "reserved until {date}" after that date. Re-deriving from
  // the same userMe flips it to the at-risk wording; nothing arms afterwards,
  // because at-risk has no further deadline to wait for.
  //
  // The delay must be clamped by us. A 30-day reservation exceeds setTimeout's
  // 32-bit millisecond field, and Node does not saturate — it warns and fires
  // after 1ms, which would re-arm in a tight loop. Capping below the limit
  // makes an over-long wait fire early, re-derive to the same non-null value
  // and re-arm for the remainder: two timers across a 30-day grace, not
  // millions.
  private scheduleClaimGraceExpiry() {
    if (this.claimGraceTimer !== null) {
      clearTimeout(this.claimGraceTimer);
      this.claimGraceTimer = null;
    }
    const grace = this.claimGrace;
    if (grace === null) return;
    const ms = grace.expiresAt.getTime() - Date.now();
    if (ms <= 0) return;
    const delay = Math.min(ms, MAX_TIMEOUT_MS);
    this.claimGraceTimer = setTimeout(() => {
      this.claimGraceTimer = null;
      this.refreshClaimGrace();
    }, delay);
  }

  // Say it once, the first time we see a reservation with a clock running.
  //
  // Keyed on the name rather than a bare "already announced" flag, and cleared
  // whenever the player is eligible again, so a resubscribe-then-lapse cycle
  // announces the second lapse too. A flag alone would announce once per
  // install and then stay quiet through every later lapse.
  //
  // Deliberately scoped to the case where something is actually at stake. A
  // logout or a TEMPORARY#### rename also turns the toggle off, but neither
  // has a deadline attached and neither costs the player a name, so neither
  // interrupts them.
  private announceLapse() {
    if (this.onCrazyGames) return;
    if (this.verifiedName() !== null) {
      localStorage.removeItem(lapseNoticeKey);
      return;
    }
    const grace = this.claimGrace;
    if (grace === null) return;
    // Keyed on the phase as well as the name: crossing the deadline is a
    // material change to what the player must do (resubscribe "before then"
    // becomes "now, before someone takes it"), so it earns one more
    // interruption. Without the phase a player warned while it was still
    // reserved would never hear that it no longer is.
    const marker = `${grace.name}:${grace.atRisk ? "atrisk" : "reserved"}`;
    if (localStorage.getItem(lapseNoticeKey) === marker) return;
    const key = grace.atRisk
      ? "username.lapse_notice_at_risk"
      : "username.lapse_notice";
    const message = translateText(key, {
      name: grace.name,
      date: formatClaimDate(grace.expiresAt),
    });
    // translateText echoes the key back until <lang-selector> has fetched its
    // translation files, and auth can resolve first. Announcing here would
    // show the player the literal string "username.lapse_notice" AND burn the
    // marker, so the real notice would never fire — for a one-shot warning
    // that is the only channel a Steam-only account has.
    //
    // Bailing costs the alert for this session, not for good: the marker is
    // left unwritten, so it fires normally on the next launch. Nothing
    // re-enters this when the language files land — applyVerifiedPreference
    // only re-runs on account events, and LangSelector's requestUpdate
    // re-renders the standing banner without coming back through here. Only
    // reachable on a non-English locale, since `en` is a static import.
    if (message === key) return;
    // Recorded before the dialog, not after: the alert resolves only when the
    // player dismisses it, and an unawaited promise that never settles would
    // let a second announcement through.
    localStorage.setItem(lapseNoticeKey, marker);
    void showInGameAlert(message);
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

  /**
   * The name this player will play under, and where it came from. The single
   * seam join paths read — they take the whole result rather than asking the
   * component two separate questions and risking them disagreeing.
   *
   * `verifiedActive` already folds in eligibility and the CrazyGames exclusion
   * (see applyVerifiedPreference), so it is the opt-in the resolver wants.
   */
  public resolvedName(): ResolvedPlayerName {
    return resolvePlayerName({
      verifiedName: this.verifiedName(),
      verifiedOptIn: this.verifiedActive,
      storedName: this.baseUsername,
      persona: this.persona,
      generatedName: this.generatedName,
    });
  }

  public getUsername(): string {
    return this.resolvedName().name;
  }

  /** True when the player is playing under their verified account name. */
  public isVerified(): boolean {
    return this.resolvedName().verified;
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
    // Membership already in hand answers this. checkClanTagOwnership would
    // otherwise re-read getUserMe, which after a failed refresh holds a cached
    // false — it would take the player for a member of nothing and reject the
    // very clan they just picked from their own list. The server re-checks the
    // tag at join either way (see Matchmaking).
    if (this.myClans().some((c) => c.tag.toUpperCase() === tag.toUpperCase())) {
      this.clanCheckPending = false;
      this.clanCheck = Promise.resolve(tag);
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
    for (const type of CLAN_MEMBERSHIP_EVENTS) {
      document.addEventListener(type, this.handleClanMembershipChange);
    }
    // Refresh unconditionally, before the fetch below can short-circuit.
    // disconnectedCallback clears the timer but leaves userMe set, so a
    // detach/reattach of the same instance takes the `userMe !== null` early
    // return and never reaches applyVerifiedPreference. Re-arming alone was
    // not enough: if the deadline passed while detached, the stale grace made
    // the scheduler bail on `ms <= 0` without ever flipping to the at-risk
    // wording or announcing it. Re-deriving first is what closes that.
    //
    // This path looks unreachable today — <play-page> is hidden by class
    // toggling rather than removed — so treat it as keeping the comment
    // honest rather than fixing a live bug.
    this.refreshClaimGrace();
    // userMeResponse is dispatched once and can fire before this connects.
    // Cached, so this re-reads that response rather than refetching.
    void getUserMe().then((me) => {
      if (this.userMe !== null) return;
      this.userMe = me;
      this.applyVerifiedPreference();
    });
    // Captured before loadStoredUsername(), which — when nothing is stored —
    // fills in a fresh anon username AND persists it immediately. Checking
    // localStorage afterwards would therefore never see it as empty.
    //
    // Reseedable, not one-shot: the old gate was "nothing stored at all", so a
    // single launch before the persona landed (or before this fix, when a
    // decorated persona was rejected outright) left a generated Anon… name in
    // localStorage that nothing would ever replace. A name we generated is
    // ours to overwrite; a name the player typed never is.
    const reseedable = this.onSteam && this.storedNameIsGenerated();
    this.loadStoredUsername();
    // On CrazyGames the account username is applied here but never persisted
    // (see loadStoredUsername / validateAndStore), so logging out — which
    // reloads the whole page — falls back to a fresh guest username instead of
    // keeping the account name. addAuthListener only fires on login; CrazyGames
    // refreshes the page on logout, so there is no logout event to handle.
    crazyGamesSDK.getUsername().then((username) => {
      if (username) {
        this.baseUsername = clampUsername(username);
        this.usernameIsGenerated = false;
        this.validateAndStore();
      }
    });
    crazyGamesSDK.addAuthListener((user) => {
      if (user) {
        this.baseUsername = clampUsername(user.username);
        this.usernameIsGenerated = false;
        this.validateAndStore();
      }
    });
    // Seed the in-game name from the Steam persona whenever the name in hand
    // is one we generated. Unlike CrazyGames, Steam persists normally (see
    // validateAndStore's onCrazyGames guard), and there's no logout event to
    // handle since the Steam identity is fixed for the session.
    if (reseedable) {
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
          // Both halves matter. The text check catches the player typing
          // while getUser() was in flight; the ownership flag catches them
          // typing and then restoring the same text, which leaves the name
          // looking untouched but makes it theirs (see handleUsernameChange).
          if (this.baseUsername !== generated) return;
          if (!this.usernameIsGenerated) return;
          this.persona = user?.name ?? null;
          // storedName is deliberately null: whatever is stored is a name we
          // generated, which this is entitled to replace. So this is branch 3
          // then 4 — the sanitised persona, or the same generated name back
          // when none of it survives. Either way the player can start a game.
          const seeded = resolvePlayerName({
            verifiedName: null,
            verifiedOptIn: false,
            storedName: null,
            persona: this.persona,
            generatedName: generated,
          });
          this.baseUsername = seeded.name;
          // Still ours if nothing of the persona survived, so a later launch
          // (or a renamed Steam account) gets another go at it.
          this.usernameIsGenerated = seeded.source === "generated";
          this.validateAndStore();
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
    for (const type of CLAN_MEMBERSHIP_EVENTS) {
      document.removeEventListener(type, this.handleClanMembershipChange);
    }
    this.clanMenuOpen = false;
    if (this.claimGraceTimer !== null) {
      clearTimeout(this.claimGraceTimer);
      this.claimGraceTimer = null;
    }
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
    }
    // No persona yet — it arrives asynchronously and reseeds in
    // connectedCallback, so this settles on the stored or generated name.
    const resolved = resolvePlayerName({
      verifiedName: null,
      verifiedOptIn: false,
      storedName: storedUsername,
      persona: null,
      generatedName: this.generatedName,
    });
    this.baseUsername = resolved.name;
    this.usernameIsGenerated = storedUsername
      ? this.storedNameIsGenerated()
      : resolved.source === "generated";
    this.validateAndStore();
    if (storedUsername) this.startClanCheck();
  }

  // Whether the name already in localStorage is one we generated.
  //
  // Installs that predate the flag have no key to read, so fall back to the
  // name's shape: genAnonUsername produces "Anon" + a word from a fixed bank,
  // which is recognisable. That is what un-poisons a Steam install whose one
  // and only seed attempt happened before this fix — without it, everyone who
  // has already launched the game keeps their guest name forever.
  private storedNameIsGenerated(): boolean {
    const stored = localStorage.getItem(usernameKey);
    if (!stored) return true;
    const flag = localStorage.getItem(usernameIsGeneratedKey);
    return flag === null ? looksGenerated(stored) : flag === "true";
  }

  render() {
    return html`
      <!-- The name field takes whatever the tag picker and trailing button
           leave, so the row always fills the strip. -->
      <div class="flex items-center w-full h-full gap-1.5 sm:gap-2">
        ${this.renderClanControl()} ${this.renderNameControl()}
      </div>
      <!-- One positioned slot, stacked. An error and the reservation reminder
           are not alternatives: the error is transient and self-inflicted
           (mid-edit on a free-form name), while the reminder is a 30-day
           countdown the player cannot recover once it lapses. Hiding the
           second behind the first put the time-critical one last. -->
      ${this.validationError || this.clanTagOwnershipError || this.claimGrace
        ? html`<div
            class="absolute top-full left-0 z-50 w-full mt-1 flex flex-col gap-1"
          >
            ${this.validationError
              ? html`<div
                  id="username-validation-error"
                  class="w-full px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
                >
                  ${this.validationError}
                </div>`
              : this.clanTagOwnershipError
                ? this.renderClanTagOwnershipError()
                : null}
            ${this.renderClaimGrace()}
          </div>`
        : null}
    `;
  }

  // A standing reminder for as long as the reservation lasts. The one-time
  // notice announces the change; this is what a player who dismissed it — or
  // who was not at the keyboard when it fired — still sees, every launch,
  // until either they resubscribe or the name is gone.
  //
  // Amber rather than red: nothing is broken and play is not blocked. It
  // stacks under any validation error rather than replacing it — a player
  // mid-edit on an invalid name is exactly who still needs to know their
  // reserved name is expiring. Positioning lives on the shared wrapper.
  private renderClaimGrace() {
    const grace = this.claimGrace;
    if (grace === null) return null;
    return html`<div
      id="username-claim-grace"
      class="w-full px-3 py-2 text-sm font-medium border border-amber-500/40 rounded-lg bg-amber-950/90 text-amber-200 backdrop-blur-md shadow-lg"
    >
      ${translateText(
        grace.atRisk ? "username.claim_at_risk" : "username.claim_reserved",
        { name: grace.name, date: formatClaimDate(grace.expiresAt) },
      )}
    </div>`;
  }

  // Members pick from their own clans rather than guessing a tag and waiting
  // to be rejected; the free-text field covers everyone else.
  private renderClanControl() {
    const tag = this.clanTag;
    const invalid = this.clanTagOwnershipError !== "";
    return html`
      <!-- Escape is bound here, not on the menu: the trigger keeps focus and
           is the menu's sibling, so a menu-level handler never sees it. -->
      <div
        class="no-crazygames relative shrink-0 h-full max-h-[44px]"
        @keydown=${this.handleClanMenuKeydown}
      >
        <button
          type="button"
          id="clan-tag-button"
          class="flex h-full w-[7.25rem] items-center justify-between gap-0.5 rounded-lg bg-transparent px-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue/60 ${invalid
            ? "ring-2 ring-red-400/70"
            : this.clanMenuOpen
              ? "bg-white/10"
              : "hover:bg-white/5"}"
          aria-haspopup="dialog"
          aria-expanded=${this.clanMenuOpen ? "true" : "false"}
          aria-busy=${this.clanCheckPending ? "true" : "false"}
          aria-invalid=${invalid ? "true" : "false"}
          aria-label=${translateText("username.clan_label")}
          title=${translateText("username.clan_label")}
          @click=${this.toggleClanMenu}
        >
          <span
            class="min-w-0 flex-1 truncate text-base font-semibold uppercase text-left ${tag
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
                class="w-3 h-3 shrink-0 text-white/45"
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
    return html`
      ${this.verifiedActive
        ? this.renderVerifiedChip()
        : this.renderNameInput()}
      <!-- The buttons differ in width, so this resizes the name field — which
           is transparent and left-aligned, so only its invisible right edge
           moves. -->
      <div class="no-crazygames shrink-0 h-full max-h-[44px]">
        ${this.verifiedActive
          ? this.renderUseCustomButton()
          : this.renderUseVerifiedButton()}
      </div>
    `;
  }

  private renderVerifiedChip() {
    return html`
      <div
        class="flex items-center gap-1.5 ${NAME_BOX}"
        title=${translateText("username.verified_active_hint")}
      >
        <!-- Check trails the name, as everywhere else it is rendered. The name
             shrinks rather than grows, so the mark keeps hugging it. -->
        <span class="min-w-0 truncate text-white ${NAME_TEXT}"
          >${this.verifiedName() ?? ""}</span
        >
        ${verifiedBadge("w-5 h-5 sm:w-6 sm:h-6", "text-aquarius")}
      </div>
    `;
  }

  private renderUseCustomButton() {
    return html`
      <button
        type="button"
        class="flex h-full aspect-square items-center justify-center rounded-lg border border-white/15 bg-black/25 text-white/70 transition-colors hover:border-white/30 hover:bg-black/40 hover:text-white cursor-pointer"
        title=${translateText("username.verified_use_custom")}
        aria-label=${translateText("username.verified_use_custom")}
        @click=${this.handleVerifiedToggle}
      >
        <!-- Icon only; the label lives in title/aria-label. Sized to the
             verified badge so the two buttons read as a pair. -->
        <svg
          viewBox="0 0 24 24"
          class="w-5 h-5"
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

  private renderNameInput() {
    return html`
      <input
        type="text"
        .value=${this.baseUsername}
        @input=${this.handleUsernameChange}
        placeholder="${translateText("username.enter_username")}"
        minlength="${MIN_USERNAME_LENGTH}"
        maxlength="${MAX_USERNAME_LENGTH}"
        aria-label=${translateText("username.enter_username")}
        class="text-left text-white placeholder-white/50 transition-colors text-ellipsis hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-2 focus:ring-malibu-blue/60 ${NAME_BOX} ${NAME_TEXT}"
      />
    `;
  }

  private renderUseVerifiedButton() {
    const eligible = this.verifiedName() !== null;
    return html`
      <button
        type="button"
        class="group flex h-full w-full items-center justify-center gap-1.5 rounded-lg border px-2 transition-colors cursor-pointer select-none ${eligible
          ? "border-malibu-blue/50 bg-malibu-blue/10 hover:border-malibu-blue/80 hover:bg-malibu-blue/20"
          : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-black/35"}"
        title=${translateText("username.verified_use_hint")}
        aria-pressed="false"
        @click=${this.handleVerifiedToggle}
      >
        ${verifiedBadge(
          "w-5 h-5 transition-colors",
          eligible
            ? "text-aquarius"
            : "text-white/25 group-hover:text-white/45",
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
      "self-start px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg lg:whitespace-nowrap";

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
    // Typed by the player, so no longer ours to reseed over.
    this.usernameIsGenerated = false;
    this.validateAndStore();
  }

  private validateAndStore() {
    // The free-form field's own contents, not resolvedName(): resolution falls
    // through an emptied field to the persona or a generated name, and play
    // must stay blocked until the player puts a name back.
    const trimmedBase = this.baseUsername.trim();

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
        // Written with the name, never separately: a stale flag would either
        // strand a player on a generated name or overwrite one they chose.
        localStorage.setItem(
          usernameIsGeneratedKey,
          String(this.usernameIsGenerated),
        );
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
