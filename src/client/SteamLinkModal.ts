import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import type { UserMeResponse } from "../core/ApiSchemas";
import { responseHasLinkedIdentity } from "./AccountIdentity";
import { getUserMe, invalidateUserMe } from "./Api";
import { isLoggedIn } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  answerSteamLinkConflict,
  fetchSteamLinkTicket,
  isValidSteamLinkCode,
  normalizeSteamLinkCode,
  type PendingLink,
  redeemSteamLink,
  redeemSteamLinkCode,
  stashPendingCodeEntry,
  stashPendingLink,
  type SteamConflictAccount,
  type SteamLinkConflict,
} from "./SteamLink";
import { translateText } from "./Utils";

// "code_entry" is a step before "loading"/"ready"/"load_error" exist at all —
// the player hasn't given us a code yet, so there's nothing to fetch.
type LoadState = "code_entry" | "loading" | "ready" | "load_error";
type RedeemState = "idle" | "redeeming" | "success" | "failed";
// "conflict" is the website's entry point, and the only mode that opens
// straight onto the discard confirmation: its refusal already happened, over
// on the Steam OpenID redirect, so there is no ticket, no code and nothing to
// redeem here — just the question of whether to discard the account in the
// way. See openForConflict.
type Mode = "token" | "code" | "conflict";

// Known machine-readable refusal reasons from POST /auth/steam/link (see the
// status-code mapping in SteamLink.ts's redeemSteamLink/redeemSteamLinkCode).
// Each gets its own message — the reason is surfaced verbatim by the server
// precisely so the UI doesn't have to collapse it into one generic failure.
// A reason this build doesn't recognise (e.g. a future addition) falls back
// to the generic key rather than rendering a raw server code.
//
// "rate_limited" is client-synthesized (not a server reason string) by
// SteamLink.ts when the throttle returns 429 — it must render its own
// "please wait" message rather than the generic failure key, since the
// throttle refuses even a correct token/code and "that was wrong" would be
// actively misleading.
const REASON_KEYS: Record<string, string> = {
  account_already_has_steam:
    "steam_link_modal.reason_account_already_has_steam",
  steam_linked_elsewhere: "steam_link_modal.reason_steam_linked_elsewhere",
  steam_has_progress: "steam_link_modal.reason_steam_has_progress",
  expired: "steam_link_modal.reason_expired",
  rate_limited: "steam_link_modal.reason_rate_limited",
  // Answers to the discard confirmation, from POST /auth/steam/link/discard.
  // `discard_blocked` is the generic "support has to do this one"; the paid
  // case gets its own message below, because naming the reason is what stops
  // the player from opening a ticket to ask what it was.
  discard_blocked: "steam_link_modal.reason_discard_blocked",
  // Client-synthesized (the server sends reason `discard_blocked` with
  // `block: "paid"`); see applyConflict.
  discard_blocked_paid: "steam_link_modal.reason_discard_blocked_paid",
  discard_deferred: "steam_link_modal.reason_discard_deferred",
  offer_unavailable: "steam_link_modal.reason_offer_unavailable",
};
const DEFAULT_REASON_KEY = "common.error_generic";

// The one identity rule this file applies, in the three places `userMe`
// decides whether the confirm step may be reached. Factored out because those
// three reads are NOT guaranteed to agree: getUserMe() memoises its answer,
// but Api.ts deliberately un-caches an aborted/timed-out attempt (and a 401
// clears the session outright), so the gate below can pass on an unreadable
// `false` and a later read then succeed — returning the guest profile the
// gate never got to see. One copy of the rule, applied at every read, is what
// closes that window.
//
// `false` is NOT a guest. It means signed-out OR a transient failure (5xx,
// timeout — Api.ts returns the same value for all three), and the callers
// have already established that a session exists, so the only remaining
// meanings are transient. Uncertainty is not a guest: those fall through to
// the modal's own load-error state rather than bouncing a signed-in player to
// the login screen over a network blip.
function isGuestAccount(userMe: UserMeResponse | false): boolean {
  return userMe !== false && !responseHasLinkedIdentity(userMe);
}

// "rate_limited" is the one reason whose message takes a parameter
// (Retry-After's seconds, when the server sent one) — every other reason is
// a fixed string, so only this one needs the params argument at all.
// Module-level (not a method) so both the ready-state render and the
// code-mode failure handling in handleConfirm can reuse it.
function reasonMessage(
  reason: string | null,
  retryAfterSeconds: number | null,
): string {
  const reasonKey = REASON_KEYS[reason ?? ""] ?? DEFAULT_REASON_KEY;
  if (reason === "rate_limited") {
    return translateText(reasonKey, { seconds: retryAfterSeconds ?? 0 });
  }
  return translateText(reasonKey);
}

const BUTTON_BASE =
  "flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl " +
  "transition-all disabled:opacity-50 disabled:pointer-events-none border-0";

/**
 * Confirmation modal for the Steam <-> web account linking handoff.
 *
 * Opened from Main.ts's boot hook when the URL carries a
 * `#steam-link?token=...` hash (see SteamLink.ts's parseSteamLinkToken), or
 * when resuming a stashed token after a login completes.
 *
 * Security note — this is the point of the whole component. The link token
 * is opaque and carries nothing about either account, and on a shared
 * machine the browser may be logged into someone else's OpenFront session.
 * So the two names shown here come from two different, specific places, and
 * mixing them up is the defect this component exists to avoid:
 *   - the Steam persona comes from GET /auth/steam/link_ticket/:token
 *     (server-resolved from the verified Steam ticket the desktop minted);
 *   - the web account name comes from the logged-in session's /users/@me —
 *     NEVER from the token, which is attacker-controllable.
 *
 * Also opened via openForCodeEntry() when the browser handoff itself fails
 * (wrong default browser, an odd Linux setup, Steam's overlay browser) and
 * the desktop gate falls back to showing an 8-character code instead. That
 * path has no token, so no GET /auth/steam/link_ticket/:token lookup is
 * possible either — there is nothing that resolves a persona from a code
 * alone, and this component does not invent one. The confirm step still
 * appears (still names the *web* account from /users/@me, still requires an
 * explicit click); the prompt just uses a dedicated no-persona phrasing
 * (steam_link_modal.confirm_prompt_no_persona) rather than filling the
 * generic template's {persona} slot with a placeholder noun, which reads as
 * a doubled "Steam ... Steam account".
 */
@customElement("steam-link-modal")
export class SteamLinkModal extends BaseModal {
  private mode: Mode = "token";
  private loadState: LoadState = "loading";
  private redeemState: RedeemState = "idle";
  private failureReason: string | null = null;
  // Only meaningful when failureReason === "rate_limited"; see
  // SteamLink.ts's Retry-After parsing.
  private retryAfterSeconds: number | null = null;

  private token: string | null = null;
  private personaName: string | null = null;
  private username: string | null = null;

  // Code-entry state. `code` is the normalized, validated code once the
  // player has submitted one; `codeDraft` mirrors the input's live value so
  // the field stays controlled; `codeError` holds an inline validation
  // message when the submitted draft doesn't parse.
  private code: string | null = null;
  private codeDraft = "";
  private codeError: string | null = null;

  // The account the player would destroy by confirming. Non-null ONLY while
  // the discard confirmation is the screen being shown: it is both the render
  // data and the "is there an unanswered offer" flag that onClose reads, so
  // every path that answers the offer clears it first.
  private conflict: SteamConflictAccount | null = null;
  // Whether the offer above has already been SPENT — a discard or a cancel
  // has gone to the server. Separate from `conflict` because the confirmation
  // stays on screen while the discard is in flight (it is the screen that says
  // "Deleting…"), so "still showing it" and "still ours to cancel" stop being
  // the same question the moment the button is pressed.
  private conflictAnswered = false;

  // Guards a stale open()'s fetch/redeem continuation from clobbering state
  // that belongs to a later call (a re-open with a different token, or a
  // close while a request is still in flight).
  private requestId = 0;

  protected modalConfig() {
    return { maxWidth: "480px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("steam_link_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  // Is there a real account on the other side of this link, or only a
  // session?
  //
  // A session is NOT enough, and that distinction is the whole point of this
  // function. POST /auth/refresh with no cookie does not reject — it creates
  // a guest account and returns a signed JWT (see the API's createGuestAccount
  // branch), so isLoggedIn() is true for a visitor who has never signed in to
  // anything. Gating on it alone let a guest walk to the confirm step, where
  // the account line renders as a bare publicId, and bind their Steam account
  // to a throwaway player. POST /auth/steam/link then records that player as
  // the steamId's owner, so linking from their REAL account afterwards is
  // refused with steam_has_progress — a dead end the player cannot undo.
  //
  // responseHasLinkedIdentity is the repo's one identity predicate
  // (AccountIdentity.ts, whose own comment records the last time a second
  // copy of this question drifted from it). The nav account button already
  // decides "signed in" this way, which is why a guest sees a signed-out nav
  // while this modal used to think they were logged in.
  //
  // Ordering is load-bearing. isLoggedIn() runs FIRST so a genuinely
  // signed-out visitor short-circuits without an extra /users/@me call, and
  // so `false` from getUserMe below can only mean a transient failure (5xx,
  // timeout — Api.ts returns the same `false` for that as for signed-out).
  // Treating that as "guest" would bounce a signed-in player to the login
  // screen over a network blip; falling through instead opens the modal,
  // which renders its own load-error state. Uncertainty is not a guest.
  private async needsAccountLogin(): Promise<boolean> {
    if (!(await isLoggedIn())) return true;
    return isGuestAccount(await getUserMe());
  }

  // The single destination for "you need a real account first", shared by the
  // entry gate above and by the two post-open reads (onOpen/handleCodeSubmit)
  // that can be the first to actually see a guest profile. Stash so the flow
  // survives the login redirect, then hand the player to the account modal,
  // which shows the login options. No new user-visible copy: the outcome IS
  // the gate's outcome, so it reuses the gate's exact behaviour rather than
  // inventing a second, near-identical message for the same situation.
  //
  // `pending` is passed rather than read off `this` because the entry gate
  // runs BEFORE mode/token are assigned, and because close() below clears
  // `this.token` on its way out. Bumping requestId first supersedes any read
  // still in flight, so a slower one can't land on a now-closed modal and
  // drag it back to "ready".
  private routeToAccountLogin(pending: PendingLink): void {
    this.requestId++;
    if (pending.kind === "token") {
      stashPendingLink(pending.token);
    } else {
      stashPendingCodeEntry();
    }
    if (this.isOpen()) this.close();
    window.location.hash = "modal=account";
  }

  // Entry point. The confirm step needs the *logged-in* account's name, so
  // if nobody is logged in there is nothing to confirm yet: stash the token
  // (survives the login redirect) and send the player to log in instead of
  // opening a confirm dialog with a blank side — that would either show
  // nothing useful or, worse, tempt a fallback to something token-derived.
  public async openWithToken(token: string): Promise<void> {
    if (await this.needsAccountLogin()) {
      this.routeToAccountLogin({ kind: "token", token });
      return;
    }
    this.mode = "token";
    this.token = token;
    this.open();
  }

  // Entry point for the fallback code (see the class doc comment above).
  // Same login precondition as openWithToken and for the same reason: the
  // confirm step needs the logged-in account's name. Unlike a token, there's
  // no code to preserve yet (the player hasn't typed one) — but the *intent*
  // to resume the code-entry form still has to survive the login redirect,
  // or the whole point of this fallback (a route through when the browser
  // handoff fails) evaporates on the one step most likely to interrupt it.
  // See SteamLink.ts's stashPendingCodeEntry/resumePendingSteamLink and
  // Main.ts's onUserMe for the resume side of this.
  public async openForCodeEntry(): Promise<void> {
    if (await this.needsAccountLogin()) {
      this.routeToAccountLogin({ kind: "code_entry" });
      return;
    }
    this.mode = "code";
    this.token = null;
    this.open();
  }

  // Entry point for the WEBSITE's link flow (LinkResult.ts). That flow's
  // refusal already happened on the Steam OpenID redirect, so there is
  // nothing left to redeem — the only question is whether to discard the
  // account in the way, and this opens straight onto it.
  //
  // No login gate, unlike the two entry points above: reaching this state at
  // all required an authenticated /auth/link/steam round trip, and the offer
  // it produced is keyed to that very session server-side. A guest cannot
  // hold one.
  public async openForConflict(account: SteamConflictAccount): Promise<void> {
    this.mode = "conflict";
    this.token = null;
    this.conflict = account;
    this.open();
  }

  protected onOpen(): void {
    const myRequestId = ++this.requestId;
    this.redeemState = "idle";
    this.failureReason = null;
    this.retryAfterSeconds = null;
    this.personaName = null;
    this.username = null;

    if (this.mode === "code") {
      this.loadState = "code_entry";
      this.code = null;
      this.codeDraft = "";
      this.codeError = null;
      return;
    }

    if (this.mode === "conflict") {
      // The persona travels with the offer (the server resolved it), so the
      // only thing still to fetch is the name of the account being KEPT —
      // which is half of what this screen is for. Render immediately rather
      // than behind a spinner: the destructive half is already known, and a
      // missing name degrades to the no-name phrasing below.
      this.loadState = "ready";
      this.personaName = this.conflict?.personaName ?? null;
      void getUserMe().then((userMe) => {
        if (myRequestId !== this.requestId) return; // superseded
        if (userMe === false) return;
        // Same `username ?? publicId` convention as the confirm step above:
        // a placeholder noun here would gut the point of naming the account
        // the player keeps.
        this.username = userMe.player.username ?? userMe.player.publicId;
        this.requestUpdate();
      });
      return;
    }

    this.loadState = "loading";
    const token = this.token;
    if (token === null) {
      this.loadState = "load_error";
      return;
    }

    void Promise.all([fetchSteamLinkTicket(token), getUserMe()]).then(
      ([ticket, userMe]) => {
        if (myRequestId !== this.requestId) return; // superseded
        // Checked before the ticket, so the identity rule never depends on an
        // unrelated network result: a guest must be sent to log in whether or
        // not the ticket happened to load. The stash is re-read after login,
        // and a genuinely dead ticket lands in load_error on that pass.
        if (isGuestAccount(userMe)) {
          this.routeToAccountLogin({ kind: "token", token });
          return;
        }
        if (!ticket.ok || userMe === false) {
          this.loadState = "load_error";
          this.requestUpdate();
          return;
        }
        this.personaName = ticket.personaName;
        // player.username is null for anyone who has never claimed one — the
        // default state, not an edge case (usernameStatus starts
        // "unclaimed"). Falling back to a placeholder noun there would gut
        // the whole point of this screen: identifying which web account is
        // about to be linked. Follows the repo-wide `username ?? publicId`
        // convention (ApiSchemas.ts, PlayerName.ts) instead.
        this.username = userMe.player.username ?? userMe.player.publicId;
        this.loadState = "ready";
        this.requestUpdate();
      },
    );
  }

  protected onClose(): void {
    // Closing on an unanswered discard offer IS declining it — but only on the
    // desktop paths, and the asymmetry is deliberate rather than an oversight.
    //
    // A token/code flow has the game sitting behind it polling a link ticket
    // the server left open precisely because a question was outstanding.
    // Walking away without telling it means the gate spins for the ticket's
    // full ten minutes; declining releases it now, and the player sees the
    // refusal immediately instead of a hang.
    //
    // The website flow (mode "conflict") has no ticket and nothing waiting, so
    // there is nothing to release — and spending the offer there would cost a
    // player who closed the dialog to think about it another full trip through
    // Steam. It is left to expire on its own instead.
    if (
      this.conflict !== null &&
      !this.conflictAnswered &&
      this.mode !== "conflict"
    ) {
      // Not awaited, and failures are ignored: this is a courtesy to the
      // desktop, and the ticket expires by itself if it never lands.
      void answerSteamLinkConflict("cancel");
    }
    this.conflict = null;
    this.conflictAnswered = false;
    this.token = null;
    this.code = null;
    this.codeDraft = "";
    this.codeError = null;
    this.requestId++;
  }

  private handleCodeInput(e: Event): void {
    this.codeDraft = (e.target as HTMLInputElement).value;
  }

  // Validates client-side before touching the network at all: a malformed
  // code (wrong length, or containing a character the alphabet deliberately
  // excludes — see SteamLink.ts) is rejected here rather than guessed at or
  // sent to the server to reject.
  private handleCodeSubmit(): void {
    const normalized = normalizeSteamLinkCode(this.codeDraft);
    if (!isValidSteamLinkCode(normalized)) {
      this.codeError = translateText("steam_link_modal.invalid_code");
      this.requestUpdate();
      return;
    }

    const myRequestId = this.requestId;
    this.code = normalized;
    this.codeError = null;
    this.loadState = "loading";
    this.requestUpdate();

    // No ticket to fetch for a code (see the class doc comment) — just the
    // logged-in account's name. personaName stays null, which the ready-state
    // render below renders via the dedicated no-persona prompt.
    void getUserMe().then((userMe) => {
      if (myRequestId !== this.requestId) return; // superseded
      // Same rule as onOpen's, and for the same reason — this can be the
      // first read that actually returns a profile (see isGuestAccount).
      if (isGuestAccount(userMe)) {
        this.routeToAccountLogin({ kind: "code_entry" });
        return;
      }
      if (userMe === false) {
        this.loadState = "load_error";
        this.requestUpdate();
        return;
      }
      this.personaName = null;
      // See the same fallback in onOpen() above — publicId, never a
      // placeholder noun, when the account has no claimed username yet.
      this.username = userMe.player.username ?? userMe.player.publicId;
      this.loadState = "ready";
      this.requestUpdate();
    });
  }

  private async handleConfirm(): Promise<void> {
    if (
      this.loadState !== "ready" ||
      this.redeemState === "redeeming" ||
      this.redeemState === "success"
    ) {
      return;
    }

    let redeem: () => ReturnType<typeof redeemSteamLink>;
    if (this.mode === "code") {
      const code = this.code;
      if (code === null) return;
      redeem = () => redeemSteamLinkCode(code);
    } else {
      const token = this.token;
      if (token === null) return;
      redeem = () => redeemSteamLink(token);
    }

    const myRequestId = this.requestId;
    this.redeemState = "redeeming";
    this.failureReason = null;
    this.retryAfterSeconds = null;
    this.requestUpdate();

    const result = await redeem();
    if (myRequestId !== this.requestId) return; // closed/reopened meanwhile

    // A refusal the player can still answer: the Steam id belongs to an
    // account that holds it and nothing else, and the server is offering to
    // discard it. Show the confirmation instead of the dead end — including
    // on the code path, whose usual "back to the field" handling below is
    // exactly wrong here (the code was right; there is nothing to retype).
    if (!result.ok && result.conflict !== undefined) {
      this.applyConflict(result.conflict);
      this.requestUpdate();
      return;
    }

    if (result.ok) {
      invalidateUserMe();
      this.redeemState = "success";
    } else if (this.mode === "code") {
      // A refused code has nothing left to fix on this confirm screen —
      // Confirm would just resubmit the exact same, already-refused code.
      // The alphabet still has eye-confusable pairs (B/8, S/5, 2/Z, G/6), so
      // a one-character mistranscription is a realistic way to land here,
      // and the only other action was Cancel — which closes the modal for
      // good (Main.ts's strip() already removed #steam-link from the URL,
      // so a refresh can't reopen it). Go back to the field instead, with
      // the refusal explained inline, so the player can correct a character
      // and try again without leaving the modal. Reset the confirm state
      // too, so a later, successful resubmission doesn't render this stale
      // failure the instant it reaches "ready" again.
      this.loadState = "code_entry";
      this.codeError = reasonMessage(
        result.reason,
        result.retryAfterSeconds ?? null,
      );
      this.redeemState = "idle";
      this.failureReason = null;
      this.retryAfterSeconds = null;
    } else {
      this.redeemState = "failed";
      this.failureReason = result.reason;
      this.retryAfterSeconds = result.retryAfterSeconds ?? null;
    }
    this.requestUpdate();
  }

  // Route a server-supplied conflict to the right screen: the confirmation
  // when there is a way through, and a reason-specific refusal when there is
  // not. `block` is why support has to do it — only "paid" gets its own
  // message, since naming that one is what stops the player opening a ticket
  // to ask what the problem was.
  private applyConflict(conflict: SteamLinkConflict): void {
    if (conflict.discardable) {
      this.conflict = conflict.account;
      this.conflictAnswered = false;
      this.personaName = conflict.account.personaName ?? this.personaName;
      this.redeemState = "idle";
      this.loadState = "ready";
      return;
    }
    this.conflict = null;
    this.redeemState = "failed";
    this.failureReason =
      conflict.block === "paid" ? "discard_blocked_paid" : "discard_blocked";
  }

  // Confirmed: delete the other account and take its Steam id.
  private async handleDiscard(): Promise<void> {
    if (this.conflict === null || this.redeemState === "redeeming") return;

    const myRequestId = this.requestId;
    // Marked spent BEFORE the request, not after it: the offer is single-use
    // server-side, so a close racing this call must not also fire a cancel
    // against something already being spent.
    this.conflictAnswered = true;
    this.redeemState = "redeeming";
    this.failureReason = null;
    this.requestUpdate();

    const result = await answerSteamLinkConflict("discard");
    if (myRequestId !== this.requestId) return; // closed/reopened meanwhile

    if (result.ok) {
      invalidateUserMe();
      this.conflict = null;
      this.redeemState = "success";
    } else {
      this.redeemState = "failed";
      this.failureReason = result.reason;
      // `discard_deferred` is the ONE refusal the server leaves the offer
      // standing for — a purchase on that account is still settling, which
      // clears by itself in minutes. So the confirmation stays answerable:
      // the button works again, and closing still releases the desktop's
      // ticket. Every other refusal has spent the offer for good.
      this.conflictAnswered = result.reason !== "discard_deferred";
    }
    this.requestUpdate();
  }

  // Declined. Tells the server so the desktop's ticket is released now rather
  // than at expiry, then closes — same destination as the Cancel on every
  // other step of this modal.
  private handleDeclineConflict(): void {
    this.conflictAnswered = true;
    void answerSteamLinkConflict("cancel");
    this.close();
  }

  protected renderBody(): TemplateResult {
    if (this.loadState === "load_error") {
      // The token path's copy ("...try again from Steam") is the wrong
      // instruction on the code path — the player is already on the
      // website holding a code, not going back through Steam.
      const loadErrorMessage =
        this.mode === "code"
          ? translateText("steam_link_modal.load_error_code")
          : translateText("steam_link_modal.load_error");
      return html`
        <div class="flex flex-col gap-4 p-6 text-center">
          <p
            class="steam-link-load-error-text text-red-300 text-sm font-medium"
          >
            ${loadErrorMessage}
          </p>
          <button
            class="${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
            @click=${() => this.close()}
          >
            ${translateText("common.close")}
          </button>
        </div>
      `;
    }

    if (this.redeemState === "success") {
      return html`
        <div class="flex flex-col gap-4 p-6 text-center">
          <p class="text-white/90 text-sm font-medium">
            ${translateText("steam_link_modal.success")}
          </p>
          <button
            class="${BUTTON_BASE} bg-malibu-blue text-white hover:bg-aquarius"
            @click=${() => this.close()}
          >
            ${translateText("common.close")}
          </button>
        </div>
      `;
    }

    // The discard confirmation. Deliberately the only screen in this modal
    // whose primary action is destructive, and it is laid out to be read in
    // that order: what is being deleted, what is being kept, that it cannot be
    // undone. The account line is the safeguard — a player who is about to
    // delete the account they actually wanted should be able to see that from
    // the name, the age and the games count before they click.
    if (this.conflict !== null) {
      const conflict = this.conflict;
      const deleting = this.redeemState === "redeeming";
      const kept = this.username ?? "";
      const created =
        conflict.createdAt === null
          ? null
          : new Date(conflict.createdAt).toLocaleDateString();
      const games = conflict.gamesPlayedCapped
        ? translateText("steam_link_modal.conflict_games_capped", {
            games: conflict.gamesPlayed,
          })
        : translateText("steam_link_modal.conflict_games", {
            games: conflict.gamesPlayed,
          });
      // Same rule as the link prompt above: no placeholder noun for a missing
      // Steam name, a dedicated phrasing instead, or the copy reads as a
      // doubled "Steam ... Steam account".
      const prompt =
        conflict.personaName === null
          ? translateText("steam_link_modal.conflict_prompt_no_persona")
          : translateText("steam_link_modal.conflict_prompt", {
              persona: conflict.personaName,
            });

      return html`
        <div class="flex flex-col gap-4 p-6">
          <p class="text-white text-base font-medium text-center">${prompt}</p>
          <p class="text-white/70 text-sm text-center">
            ${translateText("steam_link_modal.conflict_explain")}
          </p>
          <div
            class="steam-link-conflict-account flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center"
          >
            <span class="text-white text-sm font-semibold"
              >${conflict.username ?? conflict.publicId}</span
            >
            <span class="text-white/50 text-xs">
              ${games}${created === null ? "" : ` · ${created}`}
            </span>
          </div>
          <p class="text-white/70 text-sm text-center">
            ${translateText("steam_link_modal.conflict_keep", {
              username: kept,
            })}
          </p>
          <p class="text-red-400 text-sm text-center font-medium">
            ${translateText("steam_link_modal.conflict_warning")}
          </p>
          ${this.redeemState === "failed"
            ? html`<p class="text-red-400 text-sm text-center">
                ${reasonMessage(this.failureReason, this.retryAfterSeconds)}
              </p>`
            : null}
          <div class="flex gap-3">
            <button
              class="steam-link-cancel-btn ${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
              ?disabled=${deleting}
              @click=${() => this.handleDeclineConflict()}
            >
              ${translateText("common.cancel")}
            </button>
            <button
              class="steam-link-discard-btn ${BUTTON_BASE} bg-red-500/90 text-white hover:bg-red-500"
              ?disabled=${deleting}
              @click=${() => this.handleDiscard()}
            >
              ${translateText(
                deleting
                  ? "steam_link_modal.conflict_deleting"
                  : "steam_link_modal.conflict_confirm",
              )}
            </button>
          </div>
        </div>
      `;
    }

    if (this.loadState === "code_entry") {
      return html`
        <div class="flex flex-col gap-4 p-6">
          <p class="text-white text-sm text-center">
            ${translateText("steam_link_modal.code_prompt")}
          </p>
          <input
            type="text"
            class="steam-link-code-input w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-center tracking-widest uppercase placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium"
            placeholder=${translateText("steam_link_modal.code_placeholder")}
            .value=${this.codeDraft}
            @input=${(e: Event) => this.handleCodeInput(e)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") this.handleCodeSubmit();
            }}
          />
          ${this.codeError
            ? html`<p class="text-red-400 text-sm text-center">
                ${this.codeError}
              </p>`
            : null}
          <div class="flex gap-3">
            <button
              class="steam-link-cancel-btn ${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
              @click=${() => this.close()}
            >
              ${translateText("common.cancel")}
            </button>
            <button
              class="steam-link-code-submit-btn ${BUTTON_BASE} bg-malibu-blue text-white hover:bg-aquarius"
              @click=${() => this.handleCodeSubmit()}
            >
              ${translateText("steam_link_modal.code_submit")}
            </button>
          </div>
        </div>
      `;
    }

    const ready = this.loadState === "ready";
    // this.username is only ever set from userMe.player.username ?? publicId
    // (see onOpen/handleCodeSubmit) — always a real, identifying string once
    // ready. The `?? ""` here is just a defensive TS-null guard, never
    // expected to actually render; there is deliberately no "unknown
    // account" placeholder text, since a shared-machine confirm screen that
    // can't name the account defeats the point of asking at all.
    const account = ready ? (this.username ?? "") : "…";

    // Once ready, a null personaName means there is genuinely no Steam name
    // to show — always true for the code path (no ticket lookup exists for
    // a code), and rarely also true for the token path when Steam itself
    // declines to resolve one. Filling the generic template's {persona} slot
    // with a placeholder noun in that case reads as "Link Steam your Steam
    // account with account ..." — a doubled "Steam" — so it gets its own
    // template instead of trying to make one string serve both cases.
    const prompt =
      ready && this.personaName === null
        ? translateText("steam_link_modal.confirm_prompt_no_persona", {
            username: account,
          })
        : translateText("steam_link_modal.confirm_prompt", {
            persona: ready ? (this.personaName as string) : "…",
            username: account,
          });

    // "success" is handled by the early return above — by construction it
    // can't reach here, so only "redeeming" needs to gate the button.
    const confirmDisabled = !ready || this.redeemState === "redeeming";
    const confirmLabel =
      this.redeemState === "redeeming"
        ? translateText("steam_link_modal.linking")
        : translateText("steam_link_modal.confirm");

    return html`
      <div class="flex flex-col gap-6 p-6">
        <p class="text-white text-lg font-medium text-center">${prompt}</p>
        ${this.redeemState === "failed"
          ? html`<p class="text-red-400 text-sm text-center">
              ${reasonMessage(this.failureReason, this.retryAfterSeconds)}
            </p>`
          : null}
        <div class="flex gap-3">
          <button
            class="steam-link-cancel-btn ${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
            ?disabled=${this.redeemState === "redeeming"}
            @click=${() => this.close()}
          >
            ${translateText("common.cancel")}
          </button>
          <button
            class="steam-link-confirm-btn ${BUTTON_BASE} bg-malibu-blue text-white hover:bg-aquarius"
            ?disabled=${confirmDisabled}
            @click=${() => this.handleConfirm()}
          >
            ${confirmLabel}
          </button>
        </div>
      </div>
    `;
  }
}
