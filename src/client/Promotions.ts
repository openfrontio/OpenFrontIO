// Store promotions on Steam: the sale banners and the end-of-game buy box.
//
// Before the Steam launch we said there would be no ads. We meant third-party
// ads (there are none on desktop), but some Steam players took it to cover our
// own promotions too. The Store itself stays — players who want it should
// find it where it always is — but what pushes it at them can be turned off:
//
// - the sale and flash-deal banners on the home screen and at the top of the
//   store (SaleBanner.ts's bannerSales), and
// - the end-of-game "Get the look" / skins box (LoadoutRow.ts's promoChoice).
//
// One switch for both: the "Show store promotions" row in Account Settings
// (UserSettings.hideSaleBanners), which existed for the banners alone. Reusing
// its key keeps the choice of everyone who already turned it off. A one-time
// prompt on the next launch (BootInterrupts.ts) offers it, so nobody has to
// find the row to learn it exists.
//
// Steam only, like the row: the web build never promised anything of the
// kind, and the Android shell pays the way the web does.

// Type-only on UserSettings: BootInterrupts imports this module, and it is
// kept free of anything heavier than DesktopShell (which imports nothing).
import { isSteamShell } from "./DesktopShell";
import type { UserSettings } from "./UserSettings";

/** Are store promotions off right now? Always false off Steam. */
export function promotionsHidden(
  settings: Pick<UserSettings, "hideSaleBanners">,
  steam: boolean = isSteamShell(),
): boolean {
  return steam && settings.hideSaleBanners();
}

// ---------------------------------------------------------------------------
// The one-time prompt
// ---------------------------------------------------------------------------

/**
 * Is the prompt owed? Steam only, once per device, whichever way they answer,
 * and not to someone who has already turned promotions off. Per device rather
 * than per account like the claim prompt: the setting it asks about is per
 * device too.
 */
export function promotionsPromptDue(
  settings: Pick<UserSettings, "promotionsPromptSeen" | "hideSaleBanners">,
  steam: boolean,
): boolean {
  return (
    steam && !settings.promotionsPromptSeen() && !settings.hideSaleBanners()
  );
}

/** Translation keys the prompt renders through. */
export const PROMOTIONS_PROMPT_KEYS = {
  heading: "promotions_prompt.heading",
  body: "promotions_prompt.body",
  confirm: "promotions_prompt.hide",
  cancel: "promotions_prompt.keep",
} as const;

/**
 * Has the prompt anything to say yet? The same precondition as the claim
 * prompt: translateText echoes the key until the language files land, and
 * this is shown once only, so spending it on raw keys would waste it.
 */
export function promotionsPromptStringsReady(
  translate: (key: string) => string,
): boolean {
  return Object.values(PROMOTIONS_PROMPT_KEYS).every(
    (key) => translate(key) !== key,
  );
}
