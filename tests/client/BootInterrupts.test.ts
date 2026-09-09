import { describe, expect, it } from "vitest";
import {
  CLAIM_PROMPT_INTERVAL_MS,
  CLAIM_PROMPT_MAX_SHOWS,
  claimPromptDue,
  claimPromptShown,
  nextBootInterrupt,
  parseClaimPromptRecord,
  type BootInterruptInputs,
  type ClaimPromptRecord,
} from "../../src/client/BootInterrupts";

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
    expect(claimPromptDue(null, now)).toBe(true);
  });

  it("stays quiet inside the interval", () => {
    const record: ClaimPromptRecord = { shows: 1, lastShownAt: now - 1000 };
    expect(claimPromptDue(record, now)).toBe(false);
  });

  it("fires again once the interval has passed", () => {
    const record: ClaimPromptRecord = {
      shows: 1,
      lastShownAt: now - CLAIM_PROMPT_INTERVAL_MS,
    };
    expect(claimPromptDue(record, now)).toBe(true);
  });

  it("stops for good after the allowance", () => {
    const record: ClaimPromptRecord = {
      shows: CLAIM_PROMPT_MAX_SHOWS,
      lastShownAt: now - CLAIM_PROMPT_INTERVAL_MS * 365,
    };
    expect(claimPromptDue(record, now)).toBe(false);
  });

  // A clock correction, or a profile copied from a machine set to the future.
  // Treating a negative elapsed time as "long enough ago" would hand back the
  // entire allowance to a player whose clock is simply wrong.
  it("treats a backwards clock as not yet, rather than long ago", () => {
    const record: ClaimPromptRecord = {
      shows: 1,
      lastShownAt: now + 86_400_000,
    };
    expect(claimPromptDue(record, now)).toBe(false);
  });

  // The whole allowance, walked end to end: three showings a day apart, then
  // silence forever.
  it("spends exactly the allowance and then stops", () => {
    let record: ClaimPromptRecord | null = null;
    let clock = now;
    let shown = 0;
    for (let boot = 0; boot < 20; boot++) {
      if (claimPromptDue(record, clock)) {
        record = claimPromptShown(record, clock);
        shown++;
      }
      clock += CLAIM_PROMPT_INTERVAL_MS;
    }
    expect(shown).toBe(CLAIM_PROMPT_MAX_SHOWS);
    expect(record).toEqual({
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
      if (claimPromptDue(record, now + boot * 60_000)) {
        record = claimPromptShown(record, now + boot * 60_000);
        shown++;
      }
    }
    expect(shown).toBe(1);
  });
});

describe("parseClaimPromptRecord", () => {
  it("round-trips what claimPromptShown writes", () => {
    const record = claimPromptShown(null, 1_757_000_000_000);
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
      '{"shows":"3","lastShownAt":1}',
      '{"shows":3}',
      '{"shows":3,"lastShownAt":null}',
      '{"shows":null,"lastShownAt":1}',
    ]) {
      expect(parseClaimPromptRecord(raw), String(raw)).toBeNull();
      expect(claimPromptDue(parseClaimPromptRecord(raw), Date.now())).toBe(
        true,
      );
    }
  });
});
