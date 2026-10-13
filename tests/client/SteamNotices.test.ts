import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  nextBootInterrupt,
  runBootInterrupt,
  type BootInterruptInputs,
  type BootInterruptPorts,
} from "../../src/client/BootInterrupts";
import type { SteamGrantStore } from "../../src/client/SteamGrantNotices";
import {
  resetSteamNoticesForTest,
  STEAM_LICENCE_INTRO_NOTICE,
  STEAM_LICENCE_LAUNCH,
  STEAM_NOTICE_KEYS,
  STEAM_PLUS_WELCOME_NOTICE,
  steamNoticeCopy,
  steamNoticeDue,
  steamNoticeStringsReady,
  type SteamNotice,
} from "../../src/client/SteamNotices";

const ME = "player-public-id";
const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const GRANT_END = "2026-10-20T00:00:00.000Z";

type Sub = NonNullable<UserMeResponse["player"]["subscription"]>;

interface Fixture {
  steamLicence?: boolean;
  steamLicenceSince?: string | null;
  noticesSeen?: string[];
  tierConversion?: UserMeResponse["tierConversion"];
  subscription?: Sub | null;
}

function me(overrides: Fixture = {}): UserMeResponse {
  return {
    user: {},
    steamLicence: overrides.steamLicence ?? true,
    steamLicenceSince: overrides.steamLicenceSince ?? null,
    noticesSeen: overrides.noticesSeen ?? [],
    tierConversion: overrides.tierConversion ?? null,
    player: { publicId: ME, subscription: overrides.subscription ?? null },
  } as unknown as UserMeResponse;
}

function steamGrant(end = GRANT_END): Sub {
  return {
    tier: "steam_plus",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(end),
    provider: null,
    grantSource: "steam",
  };
}

const conversion = {
  id: "42",
  fromTierName: "warlord",
  toTierName: "steam_plus",
  convertedAt: "2026-10-01T00:00:00.000Z",
};

afterEach(() => resetSteamNoticesForTest());

describe("steamNoticeDue", () => {
  it("introduces the licence on the Steam build", () => {
    expect(steamNoticeDue(me(), true, NOW)).toEqual({
      kind: "steam-licence-intro",
      notice: STEAM_LICENCE_INTRO_NOTICE,
      grantEnd: null,
    });
  });

  it("never introduces the licence on the web", () => {
    expect(steamNoticeDue(me(), false, NOW)).toBeNull();
  });

  it("skips players without the licence", () => {
    expect(steamNoticeDue(me({ steamLicence: false }), true, NOW)).toBeNull();
  });

  it("skips a licence intro the server says was seen", () => {
    expect(
      steamNoticeDue(
        me({ noticesSeen: [STEAM_LICENCE_INTRO_NOTICE] }),
        true,
        NOW,
      ),
    ).toBeNull();
  });

  it("carries the end of a running Steam month", () => {
    const due = steamNoticeDue(me({ subscription: steamGrant() }), true, NOW);
    expect(due).toMatchObject({ grantEnd: new Date(GRANT_END) });
  });

  it("drops the grant line once the month has ended", () => {
    const due = steamNoticeDue(
      me({ subscription: steamGrant("2026-10-01T00:00:00.000Z") }),
      true,
      NOW,
    );
    expect(due).toMatchObject({ grantEnd: null });
  });

  it("drops the grant line for a paid subscription", () => {
    const due = steamNoticeDue(
      me({
        subscription: { ...steamGrant(), provider: "steam", grantSource: null },
      }),
      true,
      NOW,
    );
    expect(due).toMatchObject({ grantEnd: null });
  });

  it("announces a conversion ahead of the licence intro, on any build", () => {
    for (const desktop of [true, false]) {
      expect(
        steamNoticeDue(me({ tierConversion: conversion }), desktop, NOW),
      ).toEqual({
        kind: "steam-plus-conversion",
        notice: "steam_plus_conversion:42",
        fromTierName: "warlord",
      });
    }
  });

  it("falls through to the licence intro once the conversion is seen", () => {
    const due = steamNoticeDue(
      me({
        tierConversion: conversion,
        noticesSeen: ["steam_plus_conversion:42"],
      }),
      true,
      NOW,
    );
    expect(due?.kind).toBe("steam-licence-intro");
  });

  it("is nothing for a signed-out player", () => {
    expect(steamNoticeDue(false, true, NOW)).toBeNull();
    expect(steamNoticeDue(null, true, NOW)).toBeNull();
  });
});

describe("steamNoticeDue for owners since launch", () => {
  const AFTER = STEAM_LICENCE_LAUNCH + 60 * 60 * 1000;
  const MONTH_END = "2026-11-13T12:00:00.000Z";
  const at = (ms: number) => new Date(ms).toISOString();

  it("welcomes a new owner to their Steam Plus month", () => {
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(AFTER),
          subscription: steamGrant(MONTH_END),
        }),
        true,
        AFTER,
      ),
    ).toEqual({
      kind: "steam-plus-welcome",
      notice: STEAM_PLUS_WELCOME_NOTICE,
      grantEnd: new Date(MONTH_END),
    });
  });

  it("welcomes them once", () => {
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(AFTER),
          subscription: steamGrant(MONTH_END),
          noticesSeen: [STEAM_PLUS_WELCOME_NOTICE],
        }),
        true,
        AFTER,
      ),
    ).toBeNull();
  });

  it("says nothing to a new owner without a granted month", () => {
    expect(
      steamNoticeDue(me({ steamLicenceSince: at(AFTER) }), true, AFTER),
    ).toBeNull();
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(AFTER),
          subscription: steamGrant(at(AFTER - 1)),
        }),
        true,
        AFTER,
      ),
    ).toBeNull();
  });

  it("never welcomes on the web", () => {
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(AFTER),
          subscription: steamGrant(MONTH_END),
        }),
        false,
        AFTER,
      ),
    ).toBeNull();
  });

  it("treats a missing or unreadable date as an existing owner", () => {
    for (const steamLicenceSince of [null, "not a date"]) {
      expect(steamNoticeDue(me({ steamLicenceSince }), true, AFTER)?.kind).toBe(
        "steam-licence-intro",
      );
    }
  });

  it("splits owners exactly at the launch", () => {
    const grant = steamGrant(MONTH_END);
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(STEAM_LICENCE_LAUNCH - 1),
          subscription: grant,
        }),
        true,
        AFTER,
      )?.kind,
    ).toBe("steam-licence-intro");
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(STEAM_LICENCE_LAUNCH),
          subscription: grant,
        }),
        true,
        AFTER,
      )?.kind,
    ).toBe("steam-plus-welcome");
  });

  it("still puts a conversion first", () => {
    expect(
      steamNoticeDue(
        me({
          steamLicenceSince: at(AFTER),
          subscription: steamGrant(MONTH_END),
          tierConversion: conversion,
        }),
        true,
        AFTER,
      )?.kind,
    ).toBe("steam-plus-conversion");
  });
});

describe("steamNoticeCopy", () => {
  const translate = (key: string, params?: Record<string, string>) =>
    params?.date ? `${key}(${params.date})` : key;
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);

  function conversionFrom(fromTierName: string): SteamNotice {
    return { kind: "steam-plus-conversion", notice: "n", fromTierName };
  }

  it("names what changed for a Vanguard", () => {
    expect(
      steamNoticeCopy(conversionFrom("vanguard"), translate, formatDate),
    ).toEqual({
      heading: STEAM_NOTICE_KEYS.conversionHeading,
      paragraphs: [
        STEAM_NOTICE_KEYS.conversionBody,
        STEAM_NOTICE_KEYS.conversionFromVanguard,
        STEAM_NOTICE_KEYS.conversionLicence,
      ],
    });
  });

  it("names what changed for a Warlord, whatever the case", () => {
    expect(
      steamNoticeCopy(conversionFrom("Warlord"), translate, formatDate)
        .paragraphs,
    ).toContain(STEAM_NOTICE_KEYS.conversionFromWarlord);
  });

  it("says neither for any other tier", () => {
    expect(
      steamNoticeCopy(conversionFrom("sovereign"), translate, formatDate)
        .paragraphs,
    ).toEqual([
      STEAM_NOTICE_KEYS.conversionBody,
      STEAM_NOTICE_KEYS.conversionLicence,
    ]);
  });

  it("dates the new owner's Steam Plus month", () => {
    expect(
      steamNoticeCopy(
        {
          kind: "steam-plus-welcome",
          notice: "n",
          grantEnd: new Date(GRANT_END),
        },
        translate,
        formatDate,
      ),
    ).toEqual({
      heading: STEAM_NOTICE_KEYS.welcomeHeading,
      paragraphs: [
        STEAM_NOTICE_KEYS.welcomeBody,
        `${STEAM_NOTICE_KEYS.welcomeUntil}(2026-10-20)`,
      ],
    });
  });

  it("dates the plutonium bonus only while a Steam month runs", () => {
    const withGrant = steamNoticeCopy(
      {
        kind: "steam-licence-intro",
        notice: "n",
        grantEnd: new Date(GRANT_END),
      },
      translate,
      formatDate,
    );
    expect(withGrant.paragraphs).toEqual([
      STEAM_NOTICE_KEYS.licenceBody,
      `${STEAM_NOTICE_KEYS.licenceGrant}(2026-10-20)`,
      STEAM_NOTICE_KEYS.licencePlus,
    ]);
    const without = steamNoticeCopy(
      { kind: "steam-licence-intro", notice: "n", grantEnd: null },
      translate,
      formatDate,
    );
    expect(without.paragraphs).toEqual([
      STEAM_NOTICE_KEYS.licenceBody,
      STEAM_NOTICE_KEYS.licencePlus,
    ]);
  });
});

describe("steamNoticeStringsReady", () => {
  it("is false while keys echo back", () => {
    expect(steamNoticeStringsReady((key) => key)).toBe(false);
  });

  it("is true once every key translates", () => {
    expect(steamNoticeStringsReady((key) => `t(${key})`)).toBe(true);
  });
});

describe("the steam-notice boot interrupt", () => {
  function inputs(
    overrides: Partial<BootInterruptInputs> = {},
  ): BootInterruptInputs {
    return {
      cleanHomepage: true,
      usernameStatus: "premium",
      username: "Alice",
      usernameBase: "Alice",
      lapseNoticeDue: false,
      grantWelcomeDue: false,
      grantEndedDue: false,
      grantStringsReady: true,
      steamNotice: null,
      steamNoticeStringsReady: true,
      rewardCount: 0,
      claimPromptDue: true,
      claimStringsReady: true,
      ...overrides,
    };
  }

  const intro: SteamNotice = {
    kind: "steam-licence-intro",
    notice: STEAM_LICENCE_INTRO_NOTICE,
    grantEnd: new Date(GRANT_END),
  };

  it("ranks after the temporary rename and ahead of the grant welcome", () => {
    expect(
      nextBootInterrupt(
        inputs({
          steamNotice: intro,
          grantWelcomeDue: true,
          rewardCount: 3,
          username: null,
        }),
      ),
    ).toBe("steam-notice");
    expect(
      nextBootInterrupt(
        inputs({ steamNotice: intro, usernameBase: "TEMPORARY1234" }),
      ),
    ).toBe("username-temporary");
  });

  it("yields when its strings have not loaded", () => {
    expect(
      nextBootInterrupt(
        inputs({
          steamNotice: intro,
          steamNoticeStringsReady: false,
          rewardCount: 1,
        }),
      ),
    ).toBe("rewards");
  });

  function ports() {
    const calls = {
      seen: [] as string[],
      alerted: [] as { body: string; heading: string }[],
      grantStored: [] as SteamGrantStore[],
    };
    const base: BootInterruptPorts = {
      translate: (key) => `t(${key})`,
      confirm: async () => true,
      alert: async (body, heading) => {
        calls.alerted.push({ body, heading });
      },
      tierName: (tier) => tier,
      navigate: () => {},
      openRewards: () => {},
      storeClaimPrompt: () => {},
      updateSteamGrant: (update) => calls.grantStored.push(update(grantStore)),
      markNoticeSeen: (notice) => calls.seen.push(notice),
      now: () => NOW,
    };
    return { base, calls };
  }

  const grantStore: SteamGrantStore = {
    [ME]: {
      periodEnd: GRANT_END,
      tier: "steam_plus",
      steam: true,
      welcomed: false,
      endedShown: false,
      seenAt: NOW,
    },
  };

  it("marks nothing until the notice is dismissed", async () => {
    const { base, calls } = ports();
    let dismiss!: () => void;
    base.alert = () => new Promise<void>((resolve) => (dismiss = resolve));
    const running = runBootInterrupt(
      "steam-notice",
      { claimStore: {}, grantStore, publicId: ME, steamNotice: intro },
      base,
    );
    await Promise.resolve();
    expect(calls.seen).toEqual([]);
    expect(calls.grantStored).toEqual([]);
    dismiss();
    await running;
    expect(calls.seen).toEqual([STEAM_LICENCE_INTRO_NOTICE]);
    expect(calls.grantStored).toHaveLength(1);
  });

  it("marks the notice seen, covers the grant welcome, and shows once per launch", async () => {
    const { base, calls } = ports();
    await runBootInterrupt(
      "steam-notice",
      { claimStore: {}, grantStore, publicId: ME, steamNotice: intro },
      base,
    );
    expect(calls.seen).toEqual([STEAM_LICENCE_INTRO_NOTICE]);
    expect(calls.grantStored).toEqual([
      { [ME]: { ...grantStore[ME], welcomed: true } },
    ]);
    expect(calls.alerted).toHaveLength(1);
    expect(calls.alerted[0].heading).toBe(
      `t(${STEAM_NOTICE_KEYS.licenceHeading})`,
    );
    // One paragraph per line of copy, so the Steam Plus upsell sits apart
    // from what the player already has.
    const paragraphs = calls.alerted[0].body.split("\n\n");
    expect(paragraphs[0]).toBe(`t(${STEAM_NOTICE_KEYS.licenceBody})`);
    expect(paragraphs[paragraphs.length - 1]).toBe(
      `t(${STEAM_NOTICE_KEYS.licencePlus})`,
    );

    // A later /users/@me in the same launch, before the server has caught up.
    expect(
      steamNoticeDue(me({ tierConversion: conversion }), true, NOW),
    ).toBeNull();
  });

  it("marks the welcome seen and covers the grant welcome", async () => {
    const { base, calls } = ports();
    await runBootInterrupt(
      "steam-notice",
      {
        claimStore: {},
        grantStore,
        publicId: ME,
        steamNotice: {
          kind: "steam-plus-welcome",
          notice: STEAM_PLUS_WELCOME_NOTICE,
          grantEnd: new Date(GRANT_END),
        },
      },
      base,
    );
    expect(calls.seen).toEqual([STEAM_PLUS_WELCOME_NOTICE]);
    expect(calls.grantStored).toEqual([
      { [ME]: { ...grantStore[ME], welcomed: true } },
    ]);
    expect(calls.alerted[0].heading).toBe(
      `t(${STEAM_NOTICE_KEYS.welcomeHeading})`,
    );
  });

  it("leaves the grant store alone for a conversion", async () => {
    const { base, calls } = ports();
    await runBootInterrupt(
      "steam-notice",
      {
        claimStore: {},
        grantStore,
        publicId: ME,
        steamNotice: {
          kind: "steam-plus-conversion",
          notice: "steam_plus_conversion:42",
          fromTierName: "vanguard",
        },
      },
      base,
    );
    expect(calls.seen).toEqual([
      "steam_plus_conversion:42",
      STEAM_LICENCE_INTRO_NOTICE,
    ]);
    expect(calls.grantStored).toEqual([]);
    expect(calls.alerted[0].body).toContain(
      `t(${STEAM_NOTICE_KEYS.conversionFromVanguard})`,
    );
  });
});
