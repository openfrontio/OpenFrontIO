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

// The CrazyGames half of BootInterruptSequencing.test.ts. Its own file because
// <username-input> reads the environment once at construction and never
// removes its document listener, so one process cannot hold both an
// on-CrazyGames and an off-CrazyGames instance without them answering the same
// dispatch.
const { onCrazyGames, showInGameAlert, translations } = vi.hoisted(() => ({
  onCrazyGames: { value: true },
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
  lapseShownAfterDispatch,
  nextBootInterrupt,
  runBootInterrupt,
  type BootInterruptPorts,
} from "../../src/client/BootInterrupts";
import { LAPSE_NOTICE_KEY } from "../../src/client/PlayerName";
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

describe("boot sequencing on CrazyGames", () => {
  let el: UsernameInput;

  // Main's onUserMe, reduced to the parts that decide which interrupt wins.
  // Kept in the same order as Main.ts: snapshot, dispatch, compare, sequence.
  async function boot(userMe: UserMeResponse) {
    // The snapshot is the caller's job and has to predate the getUserMe()
    // await; everything after it — dispatch, then compare — belongs to
    // lapseShownAfterDispatch, which is the same function Main calls. Calling
    // it here rather than re-implementing the sequence is the point: a change
    // to the order inside it fails these tests instead of passing them.
    const shown = lapseShownAfterDispatch(
      userMe,
      localStorage.getItem(LAPSE_NOTICE_KEY),
      () => {
        document.dispatchEvent(
          new CustomEvent("userMeResponse", { detail: userMe, bubbles: true }),
        );
      },
      () => localStorage.getItem(LAPSE_NOTICE_KEY),
    );
    await el.updateComplete;

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

  // announceLapse returns before writing anything on CrazyGames, so nothing
  // was said. Inferring "shown" from the marker snapshot alone would have the
  // sequencer stand aside for a dialog that never opened, and the rewards
  // popup would be suppressed on every boot for the whole grace period.
  it("falls through to rewards when the notice bails", async () => {
    const result = await boot(lapsedWithRewards());
    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(result.interrupt).toBe("rewards");
    expect(result.rewardsOpened).toBe(1);
  });
});
