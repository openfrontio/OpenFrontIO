import { UserMeResponse } from "../core/ApiSchemas";
import { getDiscordAvatarUrl, translateText } from "./Utils";

// Renders the persistent top-nav account button from the resolved /users/@me
// response: a linked identity shows its avatar/badge, everything else shows the
// signed-out prompt. Extracted from Main.ts so the identity precedence — which
// now includes Steam — is unit-testable in jsdom.
export function updateAccountNavButton(userMeResponse: UserMeResponse | false) {
  const button = document.getElementById("nav-account-button");
  if (!button) return;

  const avatarEl = document.getElementById("nav-account-avatar") as
    | (HTMLImageElement & { _navToken?: symbol })
    | null;
  const personIconEl = document.getElementById(
    "nav-account-person-icon",
  ) as SVGElement | null;
  const emailBadgeEl = document.getElementById(
    "nav-account-email-badge",
  ) as HTMLElement | null;
  const signInTextEl = document.getElementById(
    "nav-account-signin-text",
  ) as HTMLSpanElement | null;

  // Auth state is resolved, so the button no longer shows the loading spinner.
  document
    .getElementById("nav-account-loading-spinner")
    ?.classList.add("hidden");

  // Unique token for this update call
  const navToken = Symbol();
  if (avatarEl) avatarEl._navToken = navToken;

  const showAvatar = (src: string, alt?: string) => {
    if (avatarEl) {
      avatarEl.alt = alt ?? translateText("main.discord_avatar_alt");
      // If the avatar fails to load (bad URL / CDN issue / offline), fall back
      // to the default sign-in UI instead of leaving a broken image.
      avatarEl.onerror = () => {
        if (avatarEl._navToken !== navToken) return;
        avatarEl.onerror = null;
        avatarEl.src = "https://cdn.discordapp.com/embed/avatars/0.png";
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
    button?.classList.remove("border", "border-white/20");
  };

  const showSignIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.remove("hidden");
    // Restore border when showing signin state
    button?.classList.add("border", "border-white/20");
  };

  const showEmailLoggedIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.remove("hidden");
    signInTextEl?.classList.add("hidden");
    button?.classList.add("border", "border-white/20");
  };

  // Logged in, but with no avatar or badge to show (e.g. Steam without a
  // cached avatar): the person icon alone, minus the signed-out prompt.
  const showLoggedInPlain = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.add("hidden");
    button?.classList.add("border", "border-white/20");
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

  showSignIn();
}
