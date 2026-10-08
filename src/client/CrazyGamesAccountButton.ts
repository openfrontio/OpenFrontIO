import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

// On CrazyGames the player's identity comes from the CrazyGames SDK, not our
// backend user object. Show their avatar + username on every account trigger
// (<nav-account-menu> renders one in the desktop nav and one in the mobile top
// bar), or the "Sign in" affordance when they're a guest.
//
// Clicking a trigger opens the profile menu either way — signing in is the
// menu's own "Sign in" item, which hands off to the SDK prompt — so this only
// paints state.
export async function updateCrazyGamesNavButton() {
  if (!crazyGamesSDK.isOnCrazyGames()) return;
  const profile = await crazyGamesSDK.getUserProfile();
  const signInText = translateText("main.sign_in");

  // Auth state is resolved, so the triggers no longer show the loading spinner.
  document
    .querySelectorAll("[data-account-spinner]")
    .forEach((el) => el.classList.add("hidden"));
  // CrazyGames accounts have no email, so the email badge is always hidden.
  document
    .querySelectorAll("[data-account-email-badge]")
    .forEach((el) => el.classList.add("hidden"));

  document
    .querySelectorAll<HTMLElement>("[data-account-trigger]")
    .forEach((trigger) => {
      const avatarEl = trigger.querySelector<HTMLImageElement>(
        "[data-account-avatar]",
      );
      const personIconEl = trigger.querySelector<HTMLElement>(
        "[data-account-person-icon]",
      );
      const signInTextEl = trigger.querySelector<HTMLElement>(
        "[data-account-signin-text]",
      );
      const bordered = trigger.hasAttribute("data-account-border");

      if (profile) {
        if (avatarEl) {
          avatarEl.alt = profile.username;
          avatarEl.src = profile.profilePictureUrl;
          avatarEl.classList.remove("hidden");
        }
        personIconEl?.classList.add("hidden");
        if (signInTextEl) {
          // The translation pass rewrites every [data-i18n] element's text,
          // which would clobber the username — drop the attribute while it
          // holds one. The mobile trigger keeps its label hidden regardless.
          signInTextEl.removeAttribute("data-i18n");
          signInTextEl.textContent = profile.username;
          if (bordered) signInTextEl.classList.remove("hidden");
        }
        if (bordered) trigger.classList.remove("border", "border-white/20");
      } else {
        avatarEl?.classList.add("hidden");
        personIconEl?.classList.remove("hidden");
        if (signInTextEl) {
          // Restore so language changes keep the label translated.
          signInTextEl.setAttribute("data-i18n", "main.sign_in");
          signInTextEl.textContent = signInText;
          if (bordered) signInTextEl.classList.remove("hidden");
        }
        if (bordered) trigger.classList.add("border", "border-white/20");
      }
    });
}
