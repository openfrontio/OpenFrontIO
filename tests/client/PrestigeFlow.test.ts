import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("../../src/client/ProgressionApi", () => ({
  prestigeMe: vi.fn(),
}));

import {
  HOLD_MS,
  PrestigeFlow,
} from "../../src/client/components/PrestigeFlow";
import { ProfileCard } from "../../src/client/components/ProfileCard";
import type { PrestigeResponse, Progress } from "../../src/core/ApiSchemas";

if (!customElements.get("prestige-flow")) {
  customElements.define("prestige-flow", PrestigeFlow);
}
if (!customElements.get("profile-card")) {
  customElements.define("profile-card", ProfileCard);
}

const AT_100: Progress = {
  prestige: 3,
  level: 100,
  xpInLevel: 0,
  xpForNext: 0,
  lifetimeXp: 820000,
  legend: false,
  canPrestige: true,
};

const PRESTIGED: PrestigeResponse = {
  progress: {
    ...AT_100,
    prestige: 4,
    level: 1,
    xpForNext: 150,
    canPrestige: false,
  },
  rewards: [
    {
      id: "r1",
      currencyType: "soft",
      amount: "5000",
      reason: "prestige",
      note: null,
    },
  ],
};

describe("<prestige-flow>", () => {
  let flow: PrestigeFlow;
  let submit: Mock<PrestigeFlow["submit"]>;

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    flow = document.createElement("prestige-flow") as PrestigeFlow;
    submit = vi
      .fn<PrestigeFlow["submit"]>()
      .mockResolvedValue({ ok: true, data: PRESTIGED });
    flow.submit = submit;
    document.body.appendChild(flow);
    await flow.updateComplete;
  });

  afterEach(() => {
    flow.remove();
    vi.useRealTimers();
  });

  const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await flow.updateComplete;
  }
  const confirmButton = () => q("[data-prestige-confirm-button]")!;
  const fill = () =>
    q("[data-prestige-confirm-button] .prestige-hold-fill")!.style.transform;
  // Presses the confirm button for `ms`, then lets go.
  async function hold(ms = HOLD_MS + 100): Promise<void> {
    confirmButton().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true }),
    );
    await settle(ms);
    // Gone if the hold went through and the ceremony took over.
    q("[data-prestige-confirm-button]")?.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true }),
    );
    await settle();
  }

  it("shows the new rank, what it unlocks and what's kept", async () => {
    flow.open(AT_100);
    await settle();
    const dialog = q("[data-prestige-confirm]")!;
    expect(dialog.textContent).toContain('prestige.title:{"rank":4}');
    expect(dialog.textContent).toContain("prestige.summary");
    // No lifetime XP figure on the confirmation.
    expect(dialog.textContent).not.toContain("820,000");
    expect(q("[data-prestige-unlock='emblem']")!.textContent).toContain(
      'prestige.gain_emblem:{"rank":4}',
    );
    expect(q("[data-prestige-unlock='caps']")).not.toBeNull();
    // No exclusive cosmetic at rank 4 (only 1, 5 and 10).
    expect(q("[data-prestige-unlock='cosmetic']")).toBeNull();
  });

  it("marks earned, next and locked ranks on the track", async () => {
    flow.open(AT_100);
    await settle();
    const stateOf = (rank: string) =>
      q(`[data-prestige-track] [data-rank='${rank}']`)!.dataset.state;
    expect(stateOf("3")).toBe("earned");
    expect(stateOf("4")).toBe("next");
    expect(stateOf("5")).toBe("locked");
    expect(stateOf("legend")).toBe("locked");
  });

  it("lists the exclusive cosmetic at a cosmetic rank", async () => {
    flow.open({ ...AT_100, prestige: 4 });
    await settle();
    expect(q("[data-prestige-unlock='cosmetic']")).not.toBeNull();
  });

  it("doesn't open for a player who can't prestige", async () => {
    flow.open({ ...AT_100, canPrestige: false });
    await settle();
    expect(q("[data-prestige-confirm]")).toBeNull();
  });

  it("does nothing on a click or a short press, and Cancel closes it", async () => {
    flow.open(AT_100);
    await settle(3000);
    expect(confirmButton().textContent).toContain("prestige.confirm");
    confirmButton().click();
    await settle();
    expect(submit).not.toHaveBeenCalled();

    // Let go early: the button empties again and nothing is sent.
    confirmButton().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true }),
    );
    await settle(HOLD_MS / 2);
    expect(confirmButton().textContent).toContain("prestige.keep_holding");
    expect(fill()).not.toBe("scaleX(0)");
    confirmButton().dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true }),
    );
    await settle(HOLD_MS);
    expect(submit).not.toHaveBeenCalled();
    expect(fill()).toBe("scaleX(0)");

    [
      ...document.body.querySelectorAll<HTMLElement>(
        "[data-prestige-confirm] button",
      ),
    ]
      .find((b) => b.textContent!.includes("common.cancel"))!
      .click();
    await settle();
    expect(q("[data-prestige-confirm]")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("prestiges with the keyboard too", async () => {
    flow.open(AT_100);
    await settle();
    confirmButton().dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    await settle(HOLD_MS + 100);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("sends once however many times it's held", async () => {
    let finish!: (v: Awaited<ReturnType<PrestigeFlow["submit"]>>) => void;
    submit.mockReturnValueOnce(new Promise((r) => (finish = r)));
    flow.open(AT_100);
    await settle();
    await hold();
    await hold();
    expect(submit).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: PRESTIGED });
    await settle();
    expect(q("[data-prestige-ceremony]")).not.toBeNull();
  });

  it("prestiges on a full hold, then plays the ceremony to its end", async () => {
    const prestiged = vi.fn();
    flow.addEventListener("prestiged", (e) =>
      prestiged((e as CustomEvent).detail),
    );
    flow.open(AT_100);
    await settle();
    await hold();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(prestiged).toHaveBeenCalledWith(PRESTIGED);
    const ceremony = () => q("[data-prestige-ceremony]");
    expect(ceremony()).not.toBeNull();
    expect(ceremony()!.getAttribute("data-beat")).toBe("charge");
    // Takes over the confirmation's backdrop rather than fading in over the
    // page behind.
    expect(ceremony()!.hasAttribute("data-from-confirm")).toBe(true);
    expect(q("[data-prestige-new-badge]")).toBeNull();

    await settle(2200);
    expect(q("[data-prestige-new-badge]")).not.toBeNull();
    await settle(2500);
    expect(ceremony()!.getAttribute("data-beat")).toBe("done");
    expect(q("[data-prestige-title]")!.textContent).toContain(
      'prestige.ceremony_title:{"rank":4}',
    );
    // Just the rank: no reward chips or reset line under it.
    expect(q("[data-prestige-ceremony]")!.textContent).not.toContain("5,000");

    q("[data-prestige-continue]")!.click();
    await settle();
    expect(ceremony()).toBeNull();
    expect(flow.isOpen).toBe(false);
  });

  it("skips the ceremony to its end on a tap", async () => {
    flow.celebrate(AT_100, PRESTIGED);
    await settle(300);
    expect(
      q("[data-prestige-ceremony]")!.hasAttribute("data-from-confirm"),
    ).toBe(false);
    q("[data-prestige-ceremony]")!.click();
    await settle();
    expect(q("[data-prestige-ceremony]")!.getAttribute("data-beat")).toBe(
      "done",
    );
    expect(q("[data-prestige-continue]")).not.toBeNull();
  });

  it("says so when it fails, and retries with the same key", async () => {
    submit.mockResolvedValueOnce({ ok: false });
    flow.open(AT_100);
    await settle();
    await hold();
    expect(q("[data-prestige-error]")).not.toBeNull();
    expect(q("[data-prestige-ceremony]")).toBeNull();
    expect(fill()).toBe("scaleX(0)");

    await hold();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
    expect(q("[data-prestige-ceremony]")).not.toBeNull();
  });
});

describe("<profile-card> prestige button", () => {
  let card: ProfileCard;
  afterEach(() => card?.remove());

  async function render(props: Partial<ProfileCard>): Promise<void> {
    card = document.createElement("profile-card") as ProfileCard;
    Object.assign(card, { username: "Iamlewis", ...props });
    document.body.appendChild(card);
    await card.updateComplete;
  }

  it("offers Prestige on your own card at level 100", async () => {
    const requested = vi.fn();
    await render({ progress: AT_100, prestigeable: true, variant: "compact" });
    card.addEventListener("prestige-request", requested);
    card.querySelector<HTMLElement>("[data-profile-prestige]")!.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it("never on someone else's card, or before level 100", async () => {
    await render({ progress: AT_100, prestigeable: false });
    expect(card.querySelector("[data-profile-prestige]")).toBeNull();
    card.remove();
    await render({
      progress: { ...AT_100, level: 99, canPrestige: false },
      prestigeable: true,
    });
    expect(card.querySelector("[data-profile-prestige]")).toBeNull();
  });
});
