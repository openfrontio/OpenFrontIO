import { describe, expect, it } from "vitest";
import {
  BOOT_INTERRUPT_KEYS,
  bootInterruptsAllowed,
  CLAIM_PROMPT_INTERVAL_MS,
  CLAIM_PROMPT_MAX_ACCOUNTS,
  CLAIM_PROMPT_MAX_SHOWS,
  claimPromptDue,
  claimPromptShown,
  isCleanHomepage,
  joinOwnsInFlightFlag,
  nextBootInterrupt,
  parseClaimPromptStore,
  runBootInterrupt,
  USERNAME_FORM_HASH,
  type BootInterrupt,
  type BootInterruptInputs,
  type BootInterruptPorts,
  type ClaimPromptStore,
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
  const store = (shows: number, lastShownAt: number): ClaimPromptStore => ({
    [ME]: { shows, lastShownAt },
  });

  it("fires for an account that has never seen it", () => {
    expect(claimPromptDue({}, now, ME)).toBe(true);
  });

  it("stays quiet inside the interval", () => {
    expect(claimPromptDue(store(1, now - 1000), now, ME)).toBe(false);
  });

  it("fires again once the interval has passed", () => {
    expect(
      claimPromptDue(store(1, now - CLAIM_PROMPT_INTERVAL_MS), now, ME),
    ).toBe(true);
  });

  it("stops for good after the allowance", () => {
    expect(
      claimPromptDue(
        store(CLAIM_PROMPT_MAX_SHOWS, now - CLAIM_PROMPT_INTERVAL_MS * 365),
        now,
        ME,
      ),
    ).toBe(false);
  });

  // A clock correction, or a profile copied from a machine set to the future.
  // Treating a negative elapsed time as "long enough ago" would hand back the
  // entire allowance to a player whose clock is simply wrong.
  it("treats a backwards clock as not yet, rather than long ago", () => {
    expect(claimPromptDue(store(1, now + 86_400_000), now, ME)).toBe(false);
  });

  // The whole allowance, walked end to end: three showings a day apart, then
  // silence forever.
  it("spends exactly the allowance and then stops", () => {
    let current: ClaimPromptStore = {};
    let clock = now;
    let shown = 0;
    for (let boot = 0; boot < 20; boot++) {
      if (claimPromptDue(current, clock, ME)) {
        current = claimPromptShown(current, clock, ME);
        shown++;
      }
      clock += CLAIM_PROMPT_INTERVAL_MS;
    }
    expect(shown).toBe(CLAIM_PROMPT_MAX_SHOWS);
    expect(current[ME]).toEqual({
      shows: CLAIM_PROMPT_MAX_SHOWS,
      lastShownAt:
        now + CLAIM_PROMPT_INTERVAL_MS * (CLAIM_PROMPT_MAX_SHOWS - 1),
    });
  });

  it("does not spend the allowance on one sitting", () => {
    let current: ClaimPromptStore = {};
    let shown = 0;
    // Five launches in an evening.
    for (let boot = 0; boot < 5; boot++) {
      if (claimPromptDue(current, now + boot * 60_000, ME)) {
        current = claimPromptShown(current, now + boot * 60_000, ME);
        shown++;
      }
    }
    expect(shown).toBe(1);
  });
});

describe("claim prompt decay is per account, not per device", () => {
  const now = Date.UTC(2026, 8, 9, 12, 0, 0);
  const OTHER = "someone-else";

  it("gives a different account its own allowance", () => {
    const spent: ClaimPromptStore = {
      [OTHER]: { shows: CLAIM_PROMPT_MAX_SHOWS, lastShownAt: now - 1000 },
    };
    expect(claimPromptDue(spent, now, OTHER)).toBe(false);
    expect(claimPromptDue(spent, now, ME)).toBe(true);
  });

  it("carries every other account's record through untouched", () => {
    const theirs: ClaimPromptStore = {
      [OTHER]: { shows: 2, lastShownAt: now - 1000 },
    };
    expect(claimPromptShown(theirs, now, ME)).toEqual({
      [OTHER]: { shows: 2, lastShownAt: now - 1000 },
      [ME]: { shows: 1, lastShownAt: now },
    });
  });

  // The eviction bug. With a single unkeyed slot each account overwrote the
  // other's record on every boot, so `shows` never passed one and BOTH were
  // prompted forever — the exact opposite of a decay rule.
  it("honours each cap independently when two accounts alternate", () => {
    let current: ClaimPromptStore = {};
    let clock = now;
    const shown: Record<string, number> = { [ME]: 0, [OTHER]: 0 };
    // 40 boots, alternating sign-ins, a day apart so the interval never gates.
    for (let boot = 0; boot < 40; boot++) {
      const who = boot % 2 === 0 ? ME : OTHER;
      if (claimPromptDue(current, clock, who)) {
        current = claimPromptShown(current, clock, who);
        shown[who]++;
      }
      clock += CLAIM_PROMPT_INTERVAL_MS;
    }
    expect(shown[ME]).toBe(CLAIM_PROMPT_MAX_SHOWS);
    expect(shown[OTHER]).toBe(CLAIM_PROMPT_MAX_SHOWS);
    expect(current[ME].shows).toBe(CLAIM_PROMPT_MAX_SHOWS);
    expect(current[OTHER].shows).toBe(CLAIM_PROMPT_MAX_SHOWS);
  });

  // A clock corrected backwards, or a profile copied from a machine set ahead,
  // leaves other accounts stamped in the future. Sorting everything by
  // lastShownAt and keeping the top N would then prune the record just
  // written, so `shows` could never accumulate and the prompt would repeat
  // forever — for the one account actually using the machine.
  it("never prunes the account it just recorded, even against future stamps", () => {
    const now = Date.UTC(2026, 8, 9, 12, 0, 0);
    const future: ClaimPromptStore = {};
    for (let i = 0; i < CLAIM_PROMPT_MAX_ACCOUNTS; i++) {
      future[`ahead-${i}`] = { shows: 1, lastShownAt: now + 86_400_000 * 365 };
    }
    let current = claimPromptShown(future, now, ME);
    expect(Object.keys(current).length).toBe(CLAIM_PROMPT_MAX_ACCOUNTS);
    expect(current[ME]).toEqual({ shows: 1, lastShownAt: now });

    // And the count keeps accumulating across boots rather than resetting.
    current = claimPromptShown(current, now + CLAIM_PROMPT_INTERVAL_MS, ME);
    expect(current[ME].shows).toBe(2);
  });

  // Storage is shared by every account that ever signs in here, so the map is
  // bounded. The account being recorded is never the one dropped.
  it("prunes the least recently prompted account past the cap", () => {
    let current: ClaimPromptStore = {};
    let clock = now;
    for (let i = 0; i < CLAIM_PROMPT_MAX_ACCOUNTS + 3; i++) {
      current = claimPromptShown(current, clock, `account-${i}`);
      clock += 1000;
    }
    const ids = Object.keys(current);
    expect(ids.length).toBe(CLAIM_PROMPT_MAX_ACCOUNTS);
    expect(ids).toContain(`account-${CLAIM_PROMPT_MAX_ACCOUNTS + 2}`);
    expect(ids).not.toContain("account-0");
  });
});

describe("parseClaimPromptStore", () => {
  it("round-trips what claimPromptShown writes", () => {
    const written = claimPromptShown({}, 1_757_000_000_000, ME);
    expect(parseClaimPromptStore(JSON.stringify(written))).toEqual(written);
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
      "[]",
      "{}",
      '{"p1":{"shows":"3","lastShownAt":1}}',
      '{"p1":{"shows":3}}',
      '{"p1":{"shows":3,"lastShownAt":null}}',
      '{"p1":null}',
      '{"":{"shows":3,"lastShownAt":1}}',
      // The pre-map shape, which carried publicId inside the record.
      '{"publicId":"p1","shows":3,"lastShownAt":1}',
    ]) {
      expect(
        claimPromptDue(parseClaimPromptStore(raw), Date.now(), "p1"),
        String(raw),
      ).toBe(true);
    }
  });

  // One bad entry must not discard the good ones alongside it.
  it("keeps the usable entries beside a malformed one", () => {
    const parsed = parseClaimPromptStore(
      '{"good":{"shows":3,"lastShownAt":1},"bad":{"shows":"x"}}',
    );
    expect(parsed).toEqual({ good: { shows: 3, lastShownAt: 1 } });
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

describe("runBootInterrupt", () => {
  const now = 1_757_000_000_000;

  function ports(overrides: Partial<BootInterruptPorts> = {}) {
    const calls = {
      confirmed: [] as string[],
      navigated: [] as string[],
      stored: [] as ClaimPromptStore[],
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
      storeClaimPrompt: (store) => calls.stored.push(store),
      now: () => now,
      ...overrides,
    };
    return { base, calls };
  }

  const context = { claimStore: {}, publicId: ME };

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
        { [ME]: { shows: 1, lastShownAt: now } },
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

describe("bootInterruptsAllowed", () => {
  const home = { pathname: "/", hash: "" };
  const idle = { joinInFlight: false, lobbyHandle: null };

  it("allows an idle clean homepage", () => {
    expect(bootInterruptsAllowed(home, false, idle)).toBe(true);
    expect(
      bootInterruptsAllowed({ pathname: "/index.html", hash: "" }, true, idle),
    ).toBe(true);
  });

  // The window `lobbyHandle` does not cover. A public-lobby join awaits
  // userAuth(), whenSeeded(), cosmetics and a Turnstile token before the
  // handle is assigned, and rewrites the URL only once the handshake resolves
  // — so a /users/@me landing in it sees "/", an empty hash and a null handle,
  // and the confirm opens over a game the player has already committed to.
  it("refuses a join that has not reached a handle yet", () => {
    expect(
      bootInterruptsAllowed(home, false, {
        joinInFlight: true,
        lobbyHandle: null,
      }),
    ).toBe(false);
  });

  it("refuses once a lobby handle exists", () => {
    expect(
      bootInterruptsAllowed(home, false, {
        joinInFlight: false,
        lobbyHandle: {},
      }),
    ).toBe(false);
  });

  // Each part is necessary on its own: no single one of the three can carry
  // the gate, which is why they are composed here rather than in Main.
  it("refuses when any one part says no", () => {
    for (const [label, location, desktop, lobby] of [
      ["deep link", { pathname: "/", hash: "#modal=account" }, false, idle],
      ["web index.html", { pathname: "/index.html", hash: "" }, false, idle],
      ["joining", home, false, { joinInFlight: true, lobbyHandle: null }],
      ["in lobby", home, false, { joinInFlight: false, lobbyHandle: {} }],
    ] as const) {
      expect(bootInterruptsAllowed(location, desktop, lobby), label).toBe(
        false,
      );
    }
  });
});

// A join can fail before it ever reaches a lobby handle — getTurnstileToken()
// throwing is the live example — and the only thing that runs then is the
// `join-lobby` catch. Nothing else clears the flag, so without this every boot
// interrupt is silenced for the rest of the session.
describe("a join that fails before reaching a handle", () => {
  const home = { pathname: "/", hash: "" };

  it("re-enables the interrupts it suppressed", () => {
    // The join commits and sets the flag.
    let joinInFlight = true;
    expect(
      bootInterruptsAllowed(home, false, { joinInFlight, lobbyHandle: null }),
    ).toBe(false);

    // It rejects. Same event, so it still owns the flag.
    const joinEvent = 1234;
    if (joinOwnsInFlightFlag(joinEvent, joinEvent)) joinInFlight = false;

    expect(
      bootInterruptsAllowed(home, false, { joinInFlight, lobbyHandle: null }),
    ).toBe(true);
  });

  // handleJoinLobby awaits userAuth(), cosmetics and a Turnstile token before
  // assigning a handle, so a second join can start while the first is still
  // unwinding. The older join must not re-open the interrupts over it —
  // whichever way it ends.
  it("does not clear the flag a newer join is relying on", () => {
    let joinInFlight = true;
    const supersededJoin = 1234;
    const currentJoin = 5678;
    if (joinOwnsInFlightFlag(currentJoin, supersededJoin)) joinInFlight = false;

    expect(joinInFlight).toBe(true);
    expect(
      bootInterruptsAllowed(home, false, { joinInFlight, lobbyHandle: null }),
    ).toBe(false);
  });

  // The same hazard on the SUCCESS path, which is the likelier one: click
  // lobby A, then lobby B before A's handshake resolves. A's awaits settle
  // first, A reaches the superseded branch, and B is still awaiting cosmetics
  // and a Turnstile token with no handle yet. If A cleared the flag there, a
  // /users/@me landing in that window would open the confirm over B.
  it("does not clear the flag when a superseded join completes", () => {
    const joinA = 1000;
    const joinB = 2000;

    // A commits and sets the flag.
    let joinInFlight = true;
    let mostRecentJoinEvent = joinA;
    expect(
      bootInterruptsAllowed(home, false, { joinInFlight, lobbyHandle: null }),
    ).toBe(false);

    // While A is still the current join, A does own the flag.
    expect(joinOwnsInFlightFlag(mostRecentJoinEvent, joinA)).toBe(true);

    // B commits before A's handshake resolves. It sets the flag after A did,
    // so from here the flag is B's.
    mostRecentJoinEvent = joinB;

    // A's awaits settle and it reaches the superseded branch. Not the owner,
    // so it leaves the flag alone — B is still awaiting cosmetics and a
    // Turnstile token with no handle yet.
    if (joinOwnsInFlightFlag(mostRecentJoinEvent, joinA)) joinInFlight = false;
    expect(joinInFlight).toBe(true);
    expect(
      bootInterruptsAllowed(home, false, { joinInFlight, lobbyHandle: null }),
    ).toBe(false);

    // B then reaches its own handle and clears it.
    if (joinOwnsInFlightFlag(mostRecentJoinEvent, joinB)) joinInFlight = false;
    expect(joinInFlight).toBe(false);
  });
});
