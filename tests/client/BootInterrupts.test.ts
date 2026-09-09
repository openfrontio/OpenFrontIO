import { describe, expect, it } from "vitest";
import {
  BOOT_INTERRUPT_KEYS,
  CLAIM_PROMPT_INTERVAL_MS,
  CLAIM_PROMPT_MAX_SHOWS,
  claimPromptDue,
  claimPromptShown,
  isCleanHomepage,
  nextBootInterrupt,
  parseClaimPromptRecord,
  runBootInterrupt,
  USERNAME_FORM_HASH,
  type BootInterrupt,
  type BootInterruptInputs,
  type BootInterruptPorts,
  type ClaimPromptRecord,
} from "../../src/client/BootInterrupts";

const ME = "player-public-id";

// Plain values in, one answer out — so the ordering is testable without a DOM,
// which is the whole reason it was extracted from Main.
function boot(
  overrides: Partial<BootInterruptInputs> = {},
): BootInterruptInputs {
  return {
    cleanHomepage: true,
    usernameStatus: "premium",
    username: "Alice",
    usernameBase: "Alice",
    lapseNoticeDue: false,
    rewardCount: 0,
    claimPromptDue: true,
    ...overrides,
  };
}

describe("nextBootInterrupt", () => {
  it("does nothing when nothing is pending", () => {
    expect(nextBootInterrupt(boot())).toBeNull();
  });

  // The deep-link rule, and the reason it is checked before anything else: the
  // player asked for a join URL or a specific modal, and an overlay on top of
  // it is a bug rather than a nudge.
  it("never interrupts anything but a clean homepage", () => {
    const everythingAtOnce = boot({
      cleanHomepage: false,
      username: null,
      usernameBase: "TEMPORARY1234",
      lapseNoticeDue: true,
      rewardCount: 4,
    });
    expect(nextBootInterrupt(everythingAtOnce)).toBeNull();
  });

  it("puts the TEMPORARY#### rename first", () => {
    expect(
      nextBootInterrupt(
        boot({
          username: "TEMPORARY1234",
          usernameBase: "TEMPORARY1234",
          lapseNoticeDue: true,
          rewardCount: 3,
        }),
      ),
    ).toBe("username-temporary");
  });

  it("prompts an entitled player who has never claimed a name", () => {
    for (const usernameStatus of ["premium", "indefinite"]) {
      expect(
        nextBootInterrupt(
          boot({ usernameStatus, username: null, usernameBase: null }),
        ),
      ).toBe("username-claim");
    }
  });

  it("does not prompt an unentitled player, whatever their name state", () => {
    for (const usernameStatus of ["unclaimed", "claimed", undefined]) {
      expect(
        nextBootInterrupt(
          boot({ usernameStatus, username: null, usernameBase: null }),
        ),
      ).toBeNull();
    }
  });

  // The population OPE-225 created. They asked, the bare name was held, and
  // they were told so at the time — re-prompting would be asking them to spend
  // a second rename on the same answer.
  it("does not prompt a player who claimed and fell back to a suffix", () => {
    expect(
      nextBootInterrupt(
        boot({ username: "Alice.2222", usernameBase: "Alice" }),
      ),
    ).toBeNull();
  });

  // Rewards is the one thing here with nothing at stake — it survives to the
  // next load unchanged — so it yields to all three.
  it("lets the claim prompt beat the rewards popup", () => {
    expect(
      nextBootInterrupt(
        boot({ username: null, usernameBase: null, rewardCount: 2 }),
      ),
    ).toBe("username-claim");
  });

  it("lets the lapse notice beat the rewards popup", () => {
    expect(
      nextBootInterrupt(boot({ lapseNoticeDue: true, rewardCount: 2 })),
    ).toBe("lapse-notice");
  });

  it("shows rewards when it is the only thing pending", () => {
    expect(nextBootInterrupt(boot({ rewardCount: 1 }))).toBe("rewards");
  });

  // The grant that makes someone a day-0 subscriber also mints the signup-bonus
  // rewards, so this exact pair is the ordinary first boot rather than a corner
  // case — and it is the collision the sequencer was built for.
  it("resolves the day-0 buyer's collision to the claim prompt", () => {
    expect(
      nextBootInterrupt(
        boot({
          usernameStatus: "premium",
          username: null,
          usernameBase: null,
          rewardCount: 3,
        }),
      ),
    ).toBe("username-claim");
  });

  // Decay does not promote the next contender past its own gate — it just
  // stops this one, and whatever is genuinely pending takes the boot.
  it("falls through to rewards once the claim prompt is spent", () => {
    expect(
      nextBootInterrupt(
        boot({
          username: null,
          usernameBase: null,
          claimPromptDue: false,
          rewardCount: 2,
        }),
      ),
    ).toBe("rewards");
  });
});

describe("claim prompt decay", () => {
  const now = Date.UTC(2026, 8, 9, 12, 0, 0);

  it("fires for a profile that has never seen it", () => {
    expect(claimPromptDue(null, now, ME)).toBe(true);
  });

  it("stays quiet inside the interval", () => {
    const record: ClaimPromptRecord = {
      publicId: ME,
      shows: 1,
      lastShownAt: now - 1000,
    };
    expect(claimPromptDue(record, now, ME)).toBe(false);
  });

  it("fires again once the interval has passed", () => {
    const record: ClaimPromptRecord = {
      publicId: ME,
      shows: 1,
      lastShownAt: now - CLAIM_PROMPT_INTERVAL_MS,
    };
    expect(claimPromptDue(record, now, ME)).toBe(true);
  });

  it("stops for good after the allowance", () => {
    const record: ClaimPromptRecord = {
      publicId: ME,
      shows: CLAIM_PROMPT_MAX_SHOWS,
      lastShownAt: now - CLAIM_PROMPT_INTERVAL_MS * 365,
    };
    expect(claimPromptDue(record, now, ME)).toBe(false);
  });

  // A clock correction, or a profile copied from a machine set to the future.
  // Treating a negative elapsed time as "long enough ago" would hand back the
  // entire allowance to a player whose clock is simply wrong.
  it("treats a backwards clock as not yet, rather than long ago", () => {
    const record: ClaimPromptRecord = {
      publicId: ME,
      shows: 1,
      lastShownAt: now + 86_400_000,
    };
    expect(claimPromptDue(record, now, ME)).toBe(false);
  });

  // The whole allowance, walked end to end: three showings a day apart, then
  // silence forever.
  it("spends exactly the allowance and then stops", () => {
    let record: ClaimPromptRecord | null = null;
    let clock = now;
    let shown = 0;
    for (let boot = 0; boot < 20; boot++) {
      if (claimPromptDue(record, clock, ME)) {
        record = claimPromptShown(record, clock, ME);
        shown++;
      }
      clock += CLAIM_PROMPT_INTERVAL_MS;
    }
    expect(shown).toBe(CLAIM_PROMPT_MAX_SHOWS);
    expect(record).toEqual({
      publicId: ME,
      shows: CLAIM_PROMPT_MAX_SHOWS,
      lastShownAt:
        now + CLAIM_PROMPT_INTERVAL_MS * (CLAIM_PROMPT_MAX_SHOWS - 1),
    });
  });

  it("does not spend the allowance on one sitting", () => {
    let record: ClaimPromptRecord | null = null;
    let shown = 0;
    // Five launches in an evening.
    for (let boot = 0; boot < 5; boot++) {
      if (claimPromptDue(record, now + boot * 60_000, ME)) {
        record = claimPromptShown(record, now + boot * 60_000, ME);
        shown++;
      }
    }
    expect(shown).toBe(1);
  });
});

describe("parseClaimPromptRecord", () => {
  it("round-trips what claimPromptShown writes", () => {
    const record = claimPromptShown(null, 1_757_000_000_000, ME);
    expect(parseClaimPromptRecord(JSON.stringify(record))).toEqual(record);
  });

  // Corrupt storage costs the player at most one extra prompt. Reading it as
  // "already spent" would cost them the only notice they get that they are
  // paying for something they never claimed.
  it("reads anything unusable as never shown", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "null",
      "42",
      '"a string"',
      "{}",
      '{"publicId":"p1","shows":"3","lastShownAt":1}',
      '{"publicId":"p1","shows":3}',
      '{"publicId":"p1","shows":3,"lastShownAt":null}',
      '{"publicId":"p1","shows":null,"lastShownAt":1}',
      // No publicId at all: cannot be shown to be this account's, so it is
      // not treated as this account's.
      '{"shows":3,"lastShownAt":1}',
      '{"publicId":"","shows":3,"lastShownAt":1}',
    ]) {
      expect(parseClaimPromptRecord(raw), String(raw)).toBeNull();
      expect(claimPromptDue(parseClaimPromptRecord(raw), Date.now(), ME)).toBe(
        true,
      );
    }
  });
});

describe("isCleanHomepage", () => {
  // The blocking case. The desktop shell serves the renderer from
  // app://openfront/index.html, so a bare pathname === "/" test is never true
  // there and every interrupt below it is unreachable on Steam — including
  // the TEMPORARY#### prompt and the rewards popup, which have both been dead
  // in the Steam build for exactly this reason.
  it("accepts the desktop shell's index.html", () => {
    expect(isCleanHomepage({ pathname: "/index.html", hash: "" }, true)).toBe(
      true,
    );
  });

  // On the web "/index.html" is a real, reachable URL that is not the
  // homepage, so widening the rule there would put an overlay somewhere it
  // has never appeared.
  it("does not accept index.html on the web", () => {
    expect(isCleanHomepage({ pathname: "/index.html", hash: "" }, false)).toBe(
      false,
    );
  });

  it("accepts the plain homepage either way", () => {
    for (const desktop of [true, false]) {
      expect(isCleanHomepage({ pathname: "/", hash: "" }, desktop)).toBe(true);
    }
  });

  it("refuses any deep link, shell or not", () => {
    for (const desktop of [true, false]) {
      for (const location of [
        { pathname: "/", hash: "#modal=account" },
        { pathname: "/index.html", hash: "#purchase-completed" },
        { pathname: "/w0/game/abc123", hash: "" },
        { pathname: "/join/abc123", hash: "" },
        { pathname: "/streamer-mode", hash: "" },
      ]) {
        expect(
          isCleanHomepage(location, desktop),
          `${location.pathname}${location.hash} desktop=${desktop}`,
        ).toBe(false);
      }
    }
  });
});

describe("claim prompt decay is per account, not per device", () => {
  const now = Date.UTC(2026, 8, 9, 12, 0, 0);
  const OTHER = "someone-else";

  // Storage is shared by every account that signs in on this machine. Without
  // the publicId a household's second player inherits a spent allowance and is
  // never told about a grant that is genuinely theirs.
  it("gives a different account its own allowance", () => {
    const spent: ClaimPromptRecord = {
      publicId: OTHER,
      shows: CLAIM_PROMPT_MAX_SHOWS,
      lastShownAt: now - 1000,
    };
    expect(claimPromptDue(spent, now, OTHER)).toBe(false);
    expect(claimPromptDue(spent, now, ME)).toBe(true);
  });

  it("starts a new account's count at one rather than continuing another's", () => {
    const theirs: ClaimPromptRecord = {
      publicId: OTHER,
      shows: 2,
      lastShownAt: now - 1000,
    };
    expect(claimPromptShown(theirs, now, ME)).toEqual({
      publicId: ME,
      shows: 1,
      lastShownAt: now,
    });
  });
});

describe("runBootInterrupt", () => {
  const now = 1_757_000_000_000;

  function ports(overrides: Partial<BootInterruptPorts> = {}) {
    const calls = {
      confirmed: [] as string[],
      navigated: [] as string[],
      stored: [] as ClaimPromptRecord[],
      rewardsOpened: 0,
    };
    const base: BootInterruptPorts = {
      // Stands in for a loaded language file: every key resolves to something
      // that is not the key.
      translate: (key) => `t(${key})`,
      confirm: async (body) => {
        calls.confirmed.push(body);
        return true;
      },
      navigate: (hash) => calls.navigated.push(hash),
      openRewards: () => calls.rewardsOpened++,
      storeClaimPrompt: (record) => calls.stored.push(record),
      now: () => now,
      ...overrides,
    };
    return { base, calls };
  }

  const context = { claimRecord: null, publicId: ME };

  async function run(
    interrupt: BootInterrupt | null,
    overrides: Partial<BootInterruptPorts> = {},
  ) {
    const { base, calls } = ports(overrides);
    await runBootInterrupt(interrupt, context, base);
    return calls;
  }

  it("sends an accepting player to the username form", async () => {
    for (const interrupt of ["username-temporary", "username-claim"] as const) {
      const calls = await run(interrupt);
      expect(calls.navigated, interrupt).toEqual([USERNAME_FORM_HASH]);
    }
  });

  it("goes nowhere when the player declines", async () => {
    for (const interrupt of ["username-temporary", "username-claim"] as const) {
      const calls = await run(interrupt, { confirm: async () => false });
      expect(calls.navigated, interrupt).toEqual([]);
    }
  });

  // Recorded whichever way they answer: declining is an answer, and re-asking
  // someone who said no is the nagging the decay rule exists to prevent.
  it("records the claim prompt on accept and on decline", async () => {
    for (const answer of [true, false]) {
      const calls = await run("username-claim", {
        confirm: async () => answer,
      });
      expect(calls.stored, String(answer)).toEqual([
        { publicId: ME, shows: 1, lastShownAt: now },
      ]);
    }
  });

  it("records nothing for the other interrupts", async () => {
    for (const interrupt of [
      "username-temporary",
      "lapse-notice",
      "rewards",
      null,
    ] as const) {
      const calls = await run(interrupt);
      expect(calls.stored, String(interrupt)).toEqual([]);
    }
  });

  // translateText echoes the key back until <lang-selector> has fetched its
  // files, and auth can resolve first. Showing the raw key is bad enough;
  // spending one of three chances to explain the perk while doing it would
  // leave a non-English player with two, then none, having never seen a
  // sentence.
  it("says nothing and spends nothing before the strings land", async () => {
    for (const key of Object.values(BOOT_INTERRUPT_KEYS)) {
      const calls = await run("username-claim", {
        // Only this one key is unresolved — enough to bail.
        translate: (k) => (k === key ? k : `t(${k})`),
      });
      const claimKey = (
        [
          BOOT_INTERRUPT_KEYS.claimBody,
          BOOT_INTERRUPT_KEYS.claimHeading,
          BOOT_INTERRUPT_KEYS.claimConfirm,
        ] as string[]
      ).includes(key);
      expect(calls.stored.length, key).toBe(claimKey ? 0 : 1);
      expect(calls.confirmed.length, key).toBe(claimKey ? 0 : 1);
    }
  });

  it("opens the rewards popup, and only for rewards", async () => {
    expect((await run("rewards")).rewardsOpened).toBe(1);
    for (const interrupt of [
      "username-temporary",
      "username-claim",
      "lapse-notice",
      null,
    ] as const) {
      expect((await run(interrupt)).rewardsOpened, String(interrupt)).toBe(0);
    }
  });

  // <username-input> owns that alert and has already shown it. Naming it here
  // is what stops anything else opening on the same boot.
  it("does nothing at all for the lapse notice", async () => {
    const calls = await run("lapse-notice");
    expect(calls).toEqual({
      confirmed: [],
      navigated: [],
      stored: [],
      rewardsOpened: 0,
    });
  });

  it("does nothing at all when there is no interrupt", async () => {
    const calls = await run(null);
    expect(calls).toEqual({
      confirmed: [],
      navigated: [],
      stored: [],
      rewardsOpened: 0,
    });
  });
});
