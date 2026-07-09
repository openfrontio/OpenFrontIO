import { crazyGamesSDK } from "./CrazyGamesSDK";
import { closeMobileSidebar } from "./Navigation";
import { translateText } from "./Utils";

// On CrazyGames the player's identity comes from the CrazyGames SDK, not our
// backend user object. Show their avatar + username when signed in (clicking
// opens the account modal), or a "Sign in" affordance that opens CrazyGames'
// own auth prompt when they're a guest. Applies to every account entry point:
// the desktop nav pill, the mobile hamburger item, and the homepage top bar
// (which layout is visible depends on viewport width).
export async function updateCrazyGamesNavButton() {
  if (!crazyGamesSDK.isOnCrazyGames()) return;
  const profile = await crazyGamesSDK.getUserProfile();
  const signInText = translateText("main.sign_in");

  // Bypass the data-page router (which would open the account modal) and hand
  // off to CrazyGames' own sign-in prompt instead. stopPropagation also skips
  // the router's sidebar cleanup, so close it ourselves.
  const promptSignIn = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    closeMobileSidebar();
    void crazyGamesSDK.showAuthPrompt();
  };

  // Desktop nav pill: avatar + person icon + text.
  const desktopButton = document.getElementById(
    "nav-account-button",
  ) as HTMLButtonElement | null;
  const avatarEl = document.getElementById(
    "nav-account-avatar",
  ) as HTMLImageElement | null;
  const personIconEl = document.getElementById("nav-account-person-icon");
  // CrazyGames accounts have no email, so the email badge is always hidden.
  document.getElementById("nav-account-email-badge")?.classList.add("hidden");
  const signInTextEl = document.getElementById("nav-account-signin-text");
  if (profile) {
    if (avatarEl) {
      avatarEl.alt = profile.username;
      avatarEl.src = profile.profilePictureUrl;
      avatarEl.classList.remove("hidden");
    }
    personIconEl?.classList.add("hidden");
    if (signInTextEl) {
      // The translation pass rewrites every [data-i18n] element's text, which
      // would clobber the username — drop the attribute while it holds one.
      signInTextEl.removeAttribute("data-i18n");
      signInTextEl.textContent = profile.username;
      signInTextEl.classList.remove("hidden");
    }
    desktopButton?.classList.remove("border", "border-white/20");
    if (desktopButton) desktopButton.onclick = null;
  } else {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    if (signInTextEl) {
      // Restore so language changes keep the label translated.
      signInTextEl.setAttribute("data-i18n", "main.sign_in");
      signInTextEl.textContent = signInText;
      signInTextEl.classList.remove("hidden");
    }
    desktopButton?.classList.add("border", "border-white/20");
    if (desktopButton) desktopButton.onclick = promptSignIn;
  }

  // Mobile hamburger menu item: text only. Same data-i18n handling as above.
  const mobileButton = document.getElementById(
    "mobile-nav-account-button",
  ) as HTMLButtonElement | null;
  if (mobileButton) {
    if (profile) {
      mobileButton.removeAttribute("data-i18n");
      mobileButton.textContent = profile.username;
    } else {
      mobileButton.setAttribute("data-i18n", "main.sign_in");
      mobileButton.textContent = signInText;
    }
    mobileButton.onclick = profile ? null : promptSignIn;
  }

  // Homepage top bar (narrow layout): avatar or person icon only.
  const topBarButton = document.getElementById(
    "crazygames-account-btn",
  ) as HTMLButtonElement | null;
  const topBarAvatar = document.getElementById(
    "crazygames-account-avatar",
  ) as HTMLImageElement | null;
  const topBarIcon = document.getElementById("crazygames-account-icon");
  if (profile) {
    if (topBarAvatar) {
      topBarAvatar.alt = profile.username;
      topBarAvatar.src = profile.profilePictureUrl;
      topBarAvatar.classList.remove("hidden");
    }
    topBarIcon?.classList.add("hidden");
    if (topBarButton) topBarButton.onclick = null;
  } else {
    topBarAvatar?.classList.add("hidden");
    topBarIcon?.classList.remove("hidden");
    if (topBarButton) topBarButton.onclick = promptSignIn;
  }
}
