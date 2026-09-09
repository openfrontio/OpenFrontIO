import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Drives Main's boot sequence against a REAL <username-input>, because the
// thing under test is an interaction between the two: whether the lapse notice
// actually spoke. A stubbed component would answer whatever the stub was told
// to, which is exactly the assumption that was wrong.
const { onCrazyGames, showInGameAlert, translations } = vi.hoisted(() => ({
  onCrazyGames: { value: false },
  showInGameAlert: vi.fn(async (_message: string) => true),
  // Stands in for <lang-selector>: when false, translateText echoes the key
  // back, which is what it really does before the language files land.
  translations: { loaded: true },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: (message: string) => showInGameAlert(message),
  showInGameConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, vars?: Record<string, unknown>) =>
    translations.loaded ? `t(${key})${vars ? JSON.stringify(vars) : ""}` : key,
  showToast: vi.fn(),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => onCrazyGames.value,
    getUsername: vi.fn(async () => null),
    addAuthListener: vi.fn(),
  },
}));
vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false, getUser: vi.fn(async () => null) },
}));

import {
  nextBootInterrupt,
  runBootInterrupt,
  type BootInterruptPorts,
} from "../../src/client/BootInterrupts";
import { LAPSE_NOTICE_KEY, lapseNoticeDue } from "../../src/client/PlayerName";
import { UsernameInput } from "../../src/client/UsernameInput";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// Lapsed, still inside the grace window, and holding unclaimed rewards — the
// pair that collides.
function lapsedWithRewards(): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "p",
      usernameStatus: "claimed",
      usernameBase: "RyanTheGreat",
      username: "RyanTheGreat",
      usernameClaimExpiresAt: "2099-01-01T00:00:00.000Z",
      nextUsernameChangeAt: null,
      rewards: [{ id: "r1" }],
    },
  } as unknown as UserMeResponse;
}

describe("boot sequencing against a real <username-input>", () => {
  let el: UsernameInput;

  // Main's onUserMe, reduced to the parts that decide which interrupt wins.
  // Kept in the same order as Main.ts: snapshot, dispatch, compare, sequence.
  async function boot(userMe: UserMeResponse) {
    // 1. Snapshot BEFORE the dispatch — announceLapse writes its marker before
    //    opening its alert, so afterwards the answer is always "already shown".
    const snapshot = localStorage.getItem(LAPSE_NOTICE_KEY);
    const wasDue = lapseNoticeDue(userMe, snapshot);

    // 2. The dispatch. <username-input> announces the lapse from here.
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: userMe, bubbles: true }),
    );
    await el.updateComplete;

    // 3. Shown is decided by the WRITE, not by the prediction in step 1.
    const shown =
      wasDue && !lapseNoticeDue(userMe, localStorage.getItem(LAPSE_NOTICE_KEY));

    const calls = { navigated: [] as string[], rewardsOpened: 0 };
    const ports: BootInterruptPorts = {
      translate: (key) => `t(${key})`,
      confirm: async () => false,
      navigate: (hash) => calls.navigated.push(hash),
      openRewards: () => calls.rewardsOpened++,
      storeClaimPrompt: () => {},
      now: () => Date.now(),
    };
    const player = userMe.player;
    const interrupt = nextBootInterrupt({
      cleanHomepage: true,
      usernameStatus: player.usernameStatus,
      username: player.username,
      usernameBase: player.usernameBase,
      lapseNoticeDue: shown,
      rewardCount: (player.rewards ?? []).length,
      claimPromptDue: true,
    });
    await runBootInterrupt(interrupt, { claimStore: {}, publicId: "p" }, ports);
    return { interrupt, ...calls };
  }

  // Exactly ONE element for the whole file. <username-input> registers its
  // userMeResponse listener on `document` and never removes it, so a detached
  // instance still announces — a second element would answer the dispatch
  // alongside this one and write the marker under it.
  beforeAll(async () => {
    if (!customElements.get("username-input")) {
      customElements.define("username-input", UsernameInput);
    }
    el = document.createElement("username-input") as UsernameInput;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterAll(() => {
    el?.remove();
  });

  beforeEach(() => {
    localStorage.clear();
    translations.loaded = true;
    showInGameAlert.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("stands aside for a lapse notice that actually spoke", async () => {
    const result = await boot(lapsedWithRewards());
    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(result.interrupt).toBe("lapse-notice");
    // The whole point of naming it in the ordering: nothing else opens on top.
    expect(result.rewardsOpened).toBe(0);
  });

  // The same bail, for the other reason announceLapse has: translateText
  // echoes the key back until the language files land, and announcing the
  // literal string "username.lapse_notice" would burn the one-shot marker.
  it("falls through to rewards when the strings have not landed", async () => {
    translations.loaded = false;
    const result = await boot(lapsedWithRewards());
    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(result.interrupt).toBe("rewards");
    expect(result.rewardsOpened).toBe(1);
  });

  // Second boot: the marker is already stored, so nothing is owed and nothing
  // was written this time either. Rewards gets its turn.
  it("gives rewards the next boot, once the notice has been said", async () => {
    await boot(lapsedWithRewards());
    showInGameAlert.mockClear();
    const result = await boot(lapsedWithRewards());
    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(result.interrupt).toBe("rewards");
    expect(result.rewardsOpened).toBe(1);
  });
});
