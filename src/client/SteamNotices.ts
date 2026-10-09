import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { steamGrantOf } from "./SteamGrantNotices";

export const STEAM_LICENCE_INTRO_NOTICE = "steam_licence_intro";

export function steamPlusConversionNotice(conversionId: string): string {
  return `steam_plus_conversion:${conversionId}`;
}

export type SteamNotice =
  | {
      kind: "steam-plus-conversion";
      notice: string;
      fromTierName: string;
    }
  | {
      kind: "steam-licence-intro";
      notice: string;
      /** End of a running Steam-granted month, or null when there is none. */
      grantEnd: Date | null;
    };

// /users/@me is re-read several times per launch, and the seen POST is fire
// and forget, so the server's flag can lag. One notice per launch, decided
// here rather than by the boot ordering, which only sees one /users/@me.
let shownThisLaunch = false;

export function steamNoticeShown(): void {
  shownThisLaunch = true;
}

export function resetSteamNoticesForTest(): void {
  shownThisLaunch = false;
}

function seen(userMe: UserMeResponse, notice: string): boolean {
  return userMe.noticesSeen.includes(notice);
}

/**
 * The Steam notice this player is owed, or null. The conversion notice wins
 * over the licence intro; the caller shows at most one per launch.
 */
export function steamNoticeDue(
  userMe: UserMeResponse | false | null,
  desktopShell: boolean,
  now: number,
): SteamNotice | null {
  if (shownThisLaunch || userMe === null || userMe === false) return null;
  const conversion = userMe.tierConversion;
  if (conversion) {
    const notice = steamPlusConversionNotice(conversion.id);
    if (!seen(userMe, notice)) {
      return {
        kind: "steam-plus-conversion",
        notice,
        fromTierName: conversion.fromTierName,
      };
    }
  }
  if (
    desktopShell &&
    userMe.steamLicence &&
    !seen(userMe, STEAM_LICENCE_INTRO_NOTICE)
  ) {
    const grant = steamGrantOf(userMe);
    return {
      kind: "steam-licence-intro",
      notice: STEAM_LICENCE_INTRO_NOTICE,
      grantEnd:
        grant !== null && grant.periodEnd.getTime() > now
          ? grant.periodEnd
          : null,
    };
  }
  return null;
}

export const STEAM_NOTICE_KEYS = {
  conversionHeading: "steam_notices.conversion_heading",
  conversionBody: "steam_notices.conversion_body",
  conversionFromVanguard: "steam_notices.conversion_from_vanguard",
  conversionFromWarlord: "steam_notices.conversion_from_warlord",
  conversionUnchanged: "steam_notices.conversion_unchanged",
  licenceHeading: "steam_notices.licence_intro_heading",
  licenceBody: "steam_notices.licence_intro_body",
  licenceGrant: "steam_notices.licence_intro_grant",
  licencePlus: "steam_notices.licence_intro_plus",
} as const;

// fromTierName is the tier's id ("vanguard"), but match loosely in case the
// API sends a display name instead.
function conversionLineKey(fromTierName: string): string | null {
  const name = fromTierName.trim().toLowerCase();
  if (name === "vanguard") return STEAM_NOTICE_KEYS.conversionFromVanguard;
  if (name === "warlord") return STEAM_NOTICE_KEYS.conversionFromWarlord;
  return null;
}

/** The heading and paragraphs of a notice, as translation calls. */
export function steamNoticeCopy(
  notice: SteamNotice,
  translate: (key: string, params?: Record<string, string>) => string,
  formatDate: (date: Date) => string,
): { heading: string; paragraphs: string[] } {
  if (notice.kind === "steam-plus-conversion") {
    const line = conversionLineKey(notice.fromTierName);
    return {
      heading: translate(STEAM_NOTICE_KEYS.conversionHeading),
      paragraphs: [
        translate(STEAM_NOTICE_KEYS.conversionBody),
        ...(line !== null ? [translate(line)] : []),
        translate(STEAM_NOTICE_KEYS.conversionUnchanged),
      ],
    };
  }
  return {
    heading: translate(STEAM_NOTICE_KEYS.licenceHeading),
    paragraphs: [
      translate(STEAM_NOTICE_KEYS.licenceBody),
      ...(notice.grantEnd !== null
        ? [
            translate(STEAM_NOTICE_KEYS.licenceGrant, {
              date: formatDate(notice.grantEnd),
            }),
          ]
        : []),
      translate(STEAM_NOTICE_KEYS.licencePlus),
    ],
  };
}

/**
 * Same precondition as the other boot notices: translateText echoes keys back
 * until the language files land, and each notice is shown once.
 */
export function steamNoticeStringsReady(
  translate: (key: string, params: Record<string, string>) => string,
): boolean {
  const params = { date: "" };
  return Object.values(STEAM_NOTICE_KEYS).every(
    (key) => translate(key, params) !== key,
  );
}
