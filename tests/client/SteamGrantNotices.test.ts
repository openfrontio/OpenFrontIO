import { describe, expect, it } from "vitest";
import {
  parseSteamGrantStore,
  recordSteamGrant,
  STEAM_GRANT_NOTICE_MAX_ACCOUNTS,
  steamGrantEnded,
  steamGrantEndedDue,
  steamGrantEndedShown,
  steamGrantOf,
  steamGrantWelcomed,
  steamGrantWelcomeDue,
  type SteamGrantStore,
} from "../../src/client/SteamGrantNotices";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

const ME = "player-public-id";
const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const MONTH_END = "2026-10-15T00:00:00.000Z";
const MONTH_END_MS = Date.parse(MONTH_END);

type Sub = NonNullable<UserMeResponse["player"]["subscription"]>;

function me(subscription: Partial<Sub> | null): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: ME,
      subscription:
        subscription === null
          ? null
          : ({
              tier: "warlord",
              status: "active",
              cancelAtPeriodEnd: false,
              currentPeriodEnd: new Date(MONTH_END),
              provider: null,
              ...subscription,
            } as Sub),
    },
  } as unknown as UserMeResponse;
}

const steamMonth = () => me({});
const adminComp = () => me({ currentPeriodEnd: null });
const paid = () => me({ provider: "stripe" });
const nothing = () => me(null);

function recorded(overrides: Partial<SteamGrantStore[string]> = {}) {
  return {
    [ME]: {
      periodEnd: MONTH_END,
      tier: "warlord",
      welcomed: false,
      endedShown: false,
      seenAt: NOW,
      ...overrides,
    },
  };
}

describe("steamGrantOf", () => {
  it("recognises a dated grant as the Steam month", () => {
    expect(steamGrantOf(steamMonth())).toEqual({
      tier: "warlord",
      periodEnd: new Date(MONTH_END),
    });
  });

  // The admin comp endpoint also writes provider-null rows, with no end. The
  // account panel draws the same line; a comped player must not be told their
  // access came from a Steam purchase.
  it("does not mistake an open-ended admin comp for a Steam month", () => {
    expect(steamGrantOf(adminComp())).toBeNull();
  });

  it("ignores paid subscriptions, an absent provider, and no account", () => {
    expect(steamGrantOf(paid())).toBeNull();
    expect(steamGrantOf(me({ provider: undefined }))).toBeNull();
    expect(steamGrantOf(nothing())).toBeNull();
    expect(steamGrantOf(false)).toBeNull();
    expect(steamGrantOf(null)).toBeNull();
  });
});

describe("parseSteamGrantStore", () => {
  it("reads back what it wrote", () => {
    const store = recorded();
    expect(parseSteamGrantStore(JSON.stringify(store))).toEqual(store);
  });

  it("drops unusable entries without discarding the rest", () => {
    const raw = JSON.stringify({
      ...recorded(),
      "": recorded()[ME],
      other: { periodEnd: "not a date", tier: "x", welcomed: false },
      another: null,
    });
    expect(parseSteamGrantStore(raw)).toEqual(recorded());
  });

  it("treats garbage as empty", () => {
    expect(parseSteamGrantStore(null)).toEqual({});
    expect(parseSteamGrantStore("{")).toEqual({});
    expect(parseSteamGrantStore("[]")).toEqual({});
  });
});

describe("recordSteamGrant", () => {
  it("records a Steam month the first time it is seen", () => {
    expect(recordSteamGrant({}, steamMonth(), NOW)).toEqual(recorded());
  });

  it("returns the same store when nothing changed", () => {
    for (const userMe of [nothing(), adminComp(), false, null] as const) {
      const store = recorded();
      expect(recordSteamGrant(store, userMe, NOW)).toBe(store);
    }
  });

  it("keeps the flags and refreshes seenAt on a later boot", () => {
    const store = recorded({ welcomed: true, seenAt: NOW - 1000 });
    expect(recordSteamGrant(store, steamMonth(), NOW)).toEqual(
      recorded({ welcomed: true, seenAt: NOW }),
    );
  });

  // The Deluxe DLC extends the same row to a later end. That is a new span
  // the player has not been told about, so it gets its own welcome.
  it("starts over when the end date moves", () => {
    const later = "2026-11-14T00:00:00.000Z";
    const store = recorded({ welcomed: true, endedShown: true });
    expect(
      recordSteamGrant(
        store,
        me({ tier: "sovereign", currentPeriodEnd: new Date(later) }),
        NOW,
      ),
    ).toEqual({
      [ME]: {
        periodEnd: later,
        tier: "sovereign",
        welcomed: false,
        endedShown: false,
        seenAt: NOW,
      },
    });
  });

  // Someone who has since subscribed must never be told their month ended and
  // they are on the free game now; and a later lapse of THAT subscription must
  // get the ordinary lapse notice, not the after-grant one.
  it("forgets the grant once the player pays", () => {
    expect(recordSteamGrant(recorded(), paid(), NOW)).toEqual({});
    // An older server cannot say which it is; treated as paid, the safe side.
    expect(
      recordSteamGrant(recorded(), me({ provider: undefined }), NOW),
    ).toEqual({});
  });

  it("keeps the record while nothing at all is entitled", () => {
    const store = recorded();
    expect(recordSteamGrant(store, nothing(), NOW)).toBe(store);
  });

  it("caps the map, keeping the account just recorded", () => {
    let store: SteamGrantStore = {};
    for (let i = 0; i < STEAM_GRANT_NOTICE_MAX_ACCOUNTS + 3; i++) {
      store[`p${i}`] = { ...recorded()[ME], seenAt: NOW + i };
    }
    store = recordSteamGrant(store, steamMonth(), NOW - 1_000_000);
    expect(Object.keys(store)).toHaveLength(STEAM_GRANT_NOTICE_MAX_ACCOUNTS);
    expect(store[ME]).toBeDefined();
    // The least recently seen of the others went.
    expect(store.p0).toBeUndefined();
  });
});

describe("steamGrantWelcomeDue", () => {
  it("is owed for a recorded, running, unwelcomed grant", () => {
    expect(steamGrantWelcomeDue(recorded(), steamMonth(), NOW)).toBe(true);
  });

  it("is owed once per grant", () => {
    expect(
      steamGrantWelcomeDue(recorded({ welcomed: true }), steamMonth(), NOW),
    ).toBe(false);
    expect(
      steamGrantWelcomeDue(
        steamGrantWelcomed(recorded(), ME),
        steamMonth(),
        NOW,
      ),
    ).toBe(false);
  });

  // The record is what runBootInterrupt reads the tier and date from, so a
  // grant that has not been recorded yet cannot be welcomed.
  it("is not owed without a matching record", () => {
    expect(steamGrantWelcomeDue({}, steamMonth(), NOW)).toBe(false);
    expect(
      steamGrantWelcomeDue(
        recorded({ periodEnd: "2026-01-01T00:00:00.000Z" }),
        steamMonth(),
        NOW,
      ),
    ).toBe(false);
  });

  it("is not owed for a month that has already run out", () => {
    expect(
      steamGrantWelcomeDue(recorded(), steamMonth(), MONTH_END_MS + 1),
    ).toBe(false);
  });

  it("is not owed for anything that is not a Steam month", () => {
    expect(steamGrantWelcomeDue(recorded(), adminComp(), NOW)).toBe(false);
    expect(steamGrantWelcomeDue(recorded(), paid(), NOW)).toBe(false);
    expect(steamGrantWelcomeDue(recorded(), nothing(), NOW)).toBe(false);
  });
});

describe("steamGrantEnded", () => {
  const after = MONTH_END_MS + 1;

  // The server's sweep has expired the row, so it is gone from /users/@me.
  it("finds an ended month once the server has dropped the row", () => {
    expect(steamGrantEnded(recorded(), nothing(), after)).toEqual(
      recorded()[ME],
    );
  });

  // Between the period end and the sweep the row is still on the wire.
  it("finds an ended month the server has not swept yet", () => {
    expect(steamGrantEnded(recorded(), steamMonth(), after)).toEqual(
      recorded()[ME],
    );
  });

  it("finds nothing while the month is still running", () => {
    expect(steamGrantEnded(recorded(), steamMonth(), NOW)).toBeNull();
    expect(steamGrantEnded(recorded(), nothing(), NOW)).toBeNull();
  });

  // Support comped the account after the purchase. The comp is a provider-null
  // row with no end date, so it is neither paid nor a running dated grant, and
  // telling that player their access ended would be exactly the lie this
  // module exists to stop.
  it("finds nothing while an open-ended admin comp is live", () => {
    expect(steamGrantEnded(recorded(), adminComp(), after)).toBeNull();
    expect(steamGrantEndedDue(recorded(), adminComp(), after)).toBe(false);
  });

  it("finds nothing once the player pays or gets a newer grant", () => {
    expect(steamGrantEnded(recorded(), paid(), after)).toBeNull();
    const renewed = me({
      currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(steamGrantEnded(recorded(), renewed, after)).toBeNull();
  });

  it("finds nothing without a record or an account", () => {
    expect(steamGrantEnded({}, nothing(), after)).toBeNull();
    expect(steamGrantEnded(recorded(), false, after)).toBeNull();
  });

  it("owes the sign-off exactly once", () => {
    expect(steamGrantEndedDue(recorded(), nothing(), after)).toBe(true);
    expect(
      steamGrantEndedDue(
        steamGrantEndedShown(recorded(), ME),
        nothing(),
        after,
      ),
    ).toBe(false);
  });
});

describe("marking", () => {
  it("leaves an unknown account alone", () => {
    const store = recorded();
    expect(steamGrantWelcomed(store, "someone-else")).toBe(store);
    expect(steamGrantEndedShown(store, "someone-else")).toBe(store);
  });

  it("does not disturb other accounts", () => {
    const store = { ...recorded(), other: { ...recorded()[ME] } };
    const marked = steamGrantWelcomed(store, ME);
    expect(marked.other).toEqual(store.other);
    expect(marked[ME].welcomed).toBe(true);
  });
});
