import { UserMeResponse } from "../core/ApiSchemas";
import { hasLinkedIdentity } from "./AccountIdentity";
import { getDiscordAvatarUrl, translateText } from "./Utils";

// Every account trigger rendered by <nav-account-menu> (the desktop nav pill
// and the mobile top-bar icon) exposes the same data-* hooks, so one update
// call keeps both in sync.
interface NavAccountElements {
  trigger: HTMLElement;
  avatar: (HTMLImageElement & { _navToken?: symbol }) | null;
  personIcon: HTMLElement | null;
  emailBadge: HTMLElement | null;
  signInText: HTMLElement | null;
}

function navAccountInstances(): NavAccountElements[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-account-trigger]"),
  ).map((trigger) => ({
    trigger,
    avatar: trigger.querySelector<HTMLImageElement & { _navToken?: symbol }>(
      "[data-account-avatar]",
    ),
    personIcon: trigger.querySelector<HTMLElement>(
      "[data-account-person-icon]",
    ),
    emailBadge: trigger.querySelector<HTMLElement>(
      "[data-account-email-badge]",
    ),
    signInText: trigger.querySelector<HTMLElement>(
      "[data-account-signin-text]",
    ),
  }));
}

// Renders the persistent account triggers from the resolved /users/@me
// response: a linked identity shows its avatar/badge, everything else shows the
// signed-out prompt. Extracted from Main.ts so the identity precedence — which
// now includes Steam — is unit-testable in jsdom.
export function updateAccountNavButton(userMeResponse: UserMeResponse | false) {
  const instances = navAccountInstances();
  if (instances.length === 0) return;

  // Auth state is resolved, so the triggers no longer show the loading spinner.
  document
    .querySelectorAll("[data-account-spinner]")
    .forEach((el) => el.classList.add("hidden"));

  for (const nav of instances) {
    updateInstance(nav, userMeResponse);
  }
}

function updateInstance(
  nav: NavAccountElements,
  userMeResponse: UserMeResponse | false,
) {
  const { trigger, avatar: avatarEl, personIcon: personIconEl } = nav;
  const emailBadgeEl = nav.emailBadge;
  const signInTextEl = nav.signInText;

  // The border only belongs on triggers that opt in (the desktop pill); the
  // mobile icon has no pill outline.
  const setBordered = (bordered: boolean) => {
    if (!trigger.hasAttribute("data-account-border")) return;
    if (bordered) {
      trigger.classList.add("border", "border-white/20");
    } else {
      trigger.classList.remove("border", "border-white/20");
    }
  };

  // Unique token for this update call
  const navToken = Symbol();
  if (avatarEl) avatarEl._navToken = navToken;

  // Logged in, but with no avatar or badge to show (e.g. Steam without a
  // cached avatar, or an avatar that failed to load): the person icon alone,
  // minus the signed-out prompt.
  const showLoggedInPlain = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.add("hidden");
    setBordered(true);
  };

  const showAvatar = (src: string, alt?: string) => {
    if (avatarEl) {
      avatarEl.alt = alt ?? translateText("main.discord_avatar_alt");
      // If the avatar fails to load (bad URL / CDN issue / offline), fall back
      // to the provider-neutral logged-in state rather than leaving a broken
      // image or a mismatched default (the button is used by Discord and Steam).
      avatarEl.onerror = () => {
        if (avatarEl._navToken !== navToken) return;
        avatarEl.onerror = null;
        showLoggedInPlain();
      };
      avatarEl.onload = () => {
        // Only handle if this is the latest update
        if (avatarEl._navToken !== navToken) return;
        // Clear error handler after a successful load.
        avatarEl.onerror = null;
      };
      avatarEl.src = src;
      avatarEl.classList.remove("hidden");
    }
    personIconEl?.classList.add("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.add("hidden");
    setBordered(false);
  };

  const showSignIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.remove("hidden");
    // Restore border when showing signin state
    setBordered(true);
  };

  const showEmailLoggedIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.remove("hidden");
    signInTextEl?.classList.add("hidden");
    setBordered(true);
  };

  const discord =
    userMeResponse !== false ? userMeResponse.user.discord : undefined;
  if (discord && avatarEl) {
    const avatarAlt = translateText("main.user_avatar_alt", {
      username: discord.username,
    });
    const url = getDiscordAvatarUrl(discord);
    if (url) {
      showAvatar(url, avatarAlt);
      return;
    }
  }

  // Steam is a first-class logged-in identity (parity with Discord). A cached
  // avatar renders like the Discord avatar; without one — the summaries fetch
  // failed or hasn't populated yet — fall back to the logged-in person icon,
  // never the signed-out prompt (the bug that made Steam desktop players look
  // like guests). Placed after Discord so a future linked account still
  // prefers the Discord avatar.
  const steam =
    userMeResponse !== false ? userMeResponse.user.steam : undefined;
  if (steam) {
    if (steam.avatarUrl && avatarEl) {
      const avatarAlt = translateText("main.user_avatar_alt", {
        username:
          steam.personaName ?? translateText("steam_user_header.default_name"),
      });
      showAvatar(steam.avatarUrl, avatarAlt);
    } else {
      showLoggedInPlain();
    }
    return;
  }

  const email =
    userMeResponse !== false ? userMeResponse.user.email : undefined;
  if (email) {
    showEmailLoggedIn();
    return;
  }

  // Google logins have no avatar; show the same person/email badge as magic-link.
  const google =
    userMeResponse !== false ? userMeResponse.user.google : undefined;
  if (google) {
    showEmailLoggedIn();
    return;
  }

  // A linked identity that reached here rendered nothing rich (e.g. a Discord
  // account whose avatar URL didn't resolve, or a missing avatar element): the
  // user is still authenticated, so show the logged-in person icon. Only a
  // session with no linked identity at all gets the sign-in prompt.
  if (userMeResponse !== false && hasLinkedIdentity(userMeResponse.user)) {
    showLoggedInPlain();
    return;
  }

  showSignIn();
}
