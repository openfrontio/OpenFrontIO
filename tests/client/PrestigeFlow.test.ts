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
  fetchProgressionConfig: vi.fn(async () => false),
}));

import { html } from "lit";
import type { FlareCosmeticView } from "../../src/client/components/FlareCosmetic";
import {
  HANDOFF_FADE_MS,
  HANDOFF_MS,
  HOLD_MS,
  PrestigeFlow,
} from "../../src/client/components/PrestigeFlow";
import { ProfileCard } from "../../src/client/components/ProfileCard";
import type {
  PrestigeResponse,
  Progress,
  ProgressionConfig,
  TrackFlare,
} from "../../src/core/ApiSchemas";

if (!customElements.get("prestige-flow")) {
  customElements.define("prestige-flow", PrestigeFlow);
}
if (!customElements.get("profile-card")) {
  customElements.define("profile-card", ProfileCard);
}

type Badge = HTMLElement & {
  prestige: number;
  level: number;
  legend: boolean;
};

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

// The config's rewards (sample): 2,500 Caps a prestige, and exclusive
// cosmetics for entering Prestige 1, 5 and 10.
const flare = (rank: number, name: string): TrackFlare => ({
  kind: "prestige",
  level: null,
  prestige: rank,
  flareName: `effect:${name}`,
  cosmetic: { type: "effect", name, url: null },
});
const CONFIG: ProgressionConfig = {
  version: 3,
  maxLevel: 100,
  maxPrestige: 10,
  levels: [],
  prestige: { caps: 2500 },
  flares: [
    {
      kind: "level",
      level: 50,
      prestige: null,
      flareName: "flag:obey_flag",
      cosmetic: { type: "flag", name: "obey_flag", url: null },
    },
    flare(1, "mito_nation"),
    flare(5, "solar_corona"),
    flare(10, "marbled"),
  ],
};

describe("<prestige-flow>", () => {
  let flow: PrestigeFlow;
  let submit: Mock<PrestigeFlow["submit"]>;
  let fetchConfig: Mock<PrestigeFlow["fetchConfig"]>;
  let describeCosmetic: Mock<PrestigeFlow["describeCosmetic"]>;

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
    fetchConfig = vi
      .fn<PrestigeFlow["fetchConfig"]>()
      .mockResolvedValue(CONFIG);
    flow.fetchConfig = fetchConfig;
    describeCosmetic = vi
      .fn<PrestigeFlow["describeCosmetic"]>()
      .mockImplementation(
        async (f): Promise<FlareCosmeticView> => ({
          name: `Name of ${f.flareName}`,
          typeLabel: "Nuke Explosion Effect",
          preview: html`<span data-test-preview>${f.flareName}</span>`,
        }),
      );
    flow.describeCosmetic = describeCosmetic;
    document.body.appendChild(flow);
    await flow.updateComplete;
  });

  afterEach(() => {
    flow.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const q = <T extends HTMLElement = HTMLElement>(sel: string) =>
    document.body.querySelector<T>(sel);
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
    // No exclusive cosmetic at rank 4: the config has none for it.
    expect(q("[data-prestige-unlock='cosmetic']")).toBeNull();
    expect(describeCosmetic).not.toHaveBeenCalled();
  });

  it("holds up the player's badge as it is now, not the new rank's", async () => {
    flow.open(AT_100);
    await settle();
    const hero = q<Badge>("[data-prestige-confirm] .prestige-emblem")!;
    expect(hero.hasAttribute("data-prestige-current-badge")).toBe(true);
    expect([hero.prestige, hero.level, hero.legend]).toEqual([3, 100, false]);
    // The new rank is what the title, the track and the tiles are about.
    const tile = q<Badge>("[data-prestige-unlock='emblem'] level-badge")!;
    expect([tile.prestige, tile.level]).toEqual([4, 1]);
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

  it("lists the rank's exclusive cosmetic from the config", async () => {
    flow.open({ ...AT_100, prestige: 4 });
    await settle();
    const tile = q("[data-prestige-unlock='cosmetic']")!;
    expect(tile).not.toBeNull();
    expect(describeCosmetic).toHaveBeenCalledWith(CONFIG.flares[2]);
    expect(tile.querySelector("[data-test-preview]")!.textContent).toBe(
      "effect:solar_corona",
    );
    expect(
      tile.querySelector("[data-prestige-cosmetic-name]")!.textContent,
    ).toBe("Name of effect:solar_corona");
    expect(tile.textContent).toContain(
      'prestige.exclusive:{"type":"Nuke Explosion Effect","rank":5}',
    );
  });

  it("says just the rank when the cosmetic's type isn't known", async () => {
    describeCosmetic.mockResolvedValueOnce({
      name: "Marbled",
      typeLabel: "",
      preview: html`<span></span>`,
    });
    flow.open({ ...AT_100, prestige: 9 });
    await settle();
    expect(q("[data-prestige-unlock='cosmetic']")!.textContent).toContain(
      'prestige.exclusive_untyped:{"rank":10}',
    );
  });

  it("shows the Caps a prestige grants, from the config", async () => {
    flow.open(AT_100);
    await settle();
    const caps = q("[data-prestige-unlock='caps']")!;
    expect(caps.querySelector("[data-prestige-caps-amount]")!.textContent).toBe(
      (2500).toLocaleString(),
    );
    expect(caps.textContent).toContain("prestige.caps");
    expect(caps.textContent).not.toContain("prestige.gain_caps");
  });

  it("falls back to the plain tiles without a config", async () => {
    fetchConfig.mockResolvedValue(false);
    flow.open({ ...AT_100, prestige: 4 });
    await settle();
    expect(q("[data-prestige-unlock='caps']")!.textContent).toContain(
      "prestige.gain_caps",
    );
    expect(q("[data-prestige-caps-amount]")).toBeNull();
    // No exclusive tile unless the config names one, at any rank.
    expect(q("[data-prestige-unlock='cosmetic']")).toBeNull();
  });

  it("leaves the exclusive tile out when the flare isn't a cosmetic", async () => {
    describeCosmetic.mockResolvedValueOnce(null);
    flow.open({ ...AT_100, prestige: 4 });
    await settle();
    expect(q("[data-prestige-unlock='cosmetic']")).toBeNull();
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
    await settle(HANDOFF_MS);
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
    // The handoff: the emblem keeps charging on the confirmation first.
    expect(ceremony()).toBeNull();
    expect(q("[data-prestige-confirm]")!.dataset.handoff).toBe("charge");

    await settle(HANDOFF_MS);
    expect(ceremony()).not.toBeNull();
    // It takes over at the flash: the charge already happened.
    expect(ceremony()!.getAttribute("data-beat")).toBe("shatter");
    expect(q("[data-prestige-ceremony] .ceremony-flash")).not.toBeNull();
    // Over the confirmation's own backdrop rather than fading in over the
    // page behind.
    expect(ceremony()!.hasAttribute("data-from-confirm")).toBe(true);
    expect(q("[data-prestige-new-badge]")).toBeNull();
    // The old badge went with the confirmation, under the flash.
    expect(q("[data-prestige-current-badge]")).toBeNull();

    await settle(300);
    // Out of the flash: the new rank's emblem.
    const revealed = q<Badge>("[data-prestige-new-badge] level-badge")!;
    expect([revealed.prestige, revealed.level]).toEqual([4, 1]);
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
    submit.mockResolvedValueOnce({ ok: false, reason: "failed" });
    flow.open(AT_100);
    await settle();
    await hold();
    expect(q("[data-prestige-error]")).not.toBeNull();
    expect(q("[data-prestige-ceremony]")).toBeNull();
    expect(fill()).toBe("scaleX(0)");

    await hold();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
    await settle(HANDOFF_MS);
    expect(q("[data-prestige-ceremony]")).not.toBeNull();
  });

  it("keeps the key when the confirmation is closed and reopened", async () => {
    submit.mockResolvedValueOnce({ ok: false, reason: "failed" });
    flow.open({ ...AT_100, prestige: 6 });
    await settle();
    await hold();
    q("[data-prestige-confirm]")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(flow.isOpen).toBe(false);

    // A lost answer may have prestiged already: the same key finds out.
    flow.open({ ...AT_100, prestige: 6 });
    await settle();
    await hold();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toBe(submit.mock.calls[0][0]);
  });

  it("reloads the page when the server refuses", async () => {
    submit.mockResolvedValueOnce({ ok: false, reason: "refused" });
    const stale = vi.fn();
    flow.addEventListener("prestige-stale", stale);
    flow.open({ ...AT_100, prestige: 7 });
    await settle();
    await hold();
    expect(stale).toHaveBeenCalledTimes(1);
    expect(flow.isOpen).toBe(false);
    expect(q("[data-prestige-error]")).toBeNull();
  });

  it("lets go of the hold when the button loses focus", async () => {
    flow.open(AT_100);
    await settle();
    confirmButton().dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    await settle(HOLD_MS / 4);
    // Tab away with the key still down: its keyup lands somewhere else.
    confirmButton().dispatchEvent(new FocusEvent("blur"));
    await settle(HOLD_MS * 2);
    expect(submit).not.toHaveBeenCalled();
    expect(fill()).toBe("scaleX(0)");
  });

  it("lets go of the hold when the window loses focus", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      flow.open(AT_100);
      await settle();
      confirmButton().dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      );
      await settle(HOLD_MS / 4);
      window.dispatchEvent(new Event("blur"));
      await settle(HOLD_MS * 2);
      expect(submit).not.toHaveBeenCalled();
    } finally {
      hasFocus.mockRestore();
    }
  });

  it("ignores a second open while one is in flight", async () => {
    let finish!: (v: Awaited<ReturnType<PrestigeFlow["submit"]>>) => void;
    submit.mockReturnValueOnce(new Promise((r) => (finish = r)));
    flow.open(AT_100);
    await settle();
    confirmButton().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true }),
    );
    await settle(HOLD_MS + 100);
    expect(submit).toHaveBeenCalledTimes(1);

    flow.open(AT_100);
    await settle();
    expect(confirmButton().textContent).toContain("prestige.submitting");
    finish({ ok: true, data: PRESTIGED });
    await settle(HANDOFF_MS);
    expect(q("[data-prestige-ceremony]")).not.toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape and Tab to itself", async () => {
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    try {
      flow.open(AT_100);
      await settle();
      expect(document.activeElement).toBe(confirmButton());

      // Tab cycles within the confirmation.
      confirmButton().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      expect(document.activeElement?.textContent).toContain("common.cancel");
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      expect(document.activeElement).toBe(confirmButton());

      confirmButton().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await settle();
      expect(flow.isOpen).toBe(false);
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }
  });

  it("Escape skips the ceremony, then closes it", async () => {
    flow.celebrate(AT_100, PRESTIGED);
    await settle(300);
    const escape = () =>
      q("[data-prestige-ceremony]")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    escape();
    await settle();
    expect(q("[data-prestige-ceremony]")!.getAttribute("data-beat")).toBe(
      "done",
    );
    escape();
    await settle();
    expect(flow.isOpen).toBe(false);
  });
  it("tells a signed-out player to sign in, not to check their connection", async () => {
    submit.mockResolvedValueOnce({ ok: false, reason: "signed_out" });
    flow.open({ ...AT_100, prestige: 8 });
    await settle();
    await hold();
    expect(q("[data-prestige-error]")!.textContent).toContain(
      "prestige.error_signed_out",
    );
  });

  it("keeps focus in the overlay while the request is out", async () => {
    let finish!: (v: Awaited<ReturnType<PrestigeFlow["submit"]>>) => void;
    submit.mockReturnValueOnce(new Promise((r) => (finish = r)));
    flow.open(AT_100);
    await settle();
    confirmButton().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true }),
    );
    await settle(HOLD_MS + 100);
    // Both buttons are disabled now: the dialog itself holds focus, and Tab
    // can't leave it.
    const root = q("[data-prestige-confirm]")!;
    expect(document.activeElement).toBe(root);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root);
    finish({ ok: true, data: PRESTIGED });
    await settle();
  });

  it("focuses the ceremony, then Continue when it ends", async () => {
    flow.open(AT_100);
    await settle();
    await hold();
    await settle(HANDOFF_MS);
    const ceremony = q("[data-prestige-ceremony]")!;
    expect(document.activeElement).toBe(ceremony);

    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    ceremony.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ceremony);

    await settle(5000);
    expect(document.activeElement).toBe(q("[data-prestige-continue]"));
  });

  describe("the hold and the handoff", () => {
    const root = () => q("[data-prestige-confirm]")!;
    const charge = () => Number(root().style.getPropertyValue("--hold"));
    const press = () =>
      confirmButton().dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      );

    it("charges the emblem with the hold, trembling near the end", async () => {
      flow.open(AT_100);
      await settle();
      press();
      await settle(HOLD_MS / 2);
      expect(charge()).toBeGreaterThan(0.4);
      expect(charge()).toBeLessThan(0.6);
      expect(root().hasAttribute("data-hot")).toBe(false);
      expect(root().hasAttribute("data-holding")).toBe(true);

      await settle(HOLD_MS * 0.35);
      expect(charge()).toBeGreaterThan(0.75);
      expect(root().hasAttribute("data-hot")).toBe(true);

      // Let go early: the charge drains with the fill.
      confirmButton().dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true }),
      );
      await settle();
      expect(charge()).toBe(0);
      expect(root().hasAttribute("data-hot")).toBe(false);
      expect(root().hasAttribute("data-holding")).toBe(false);
      expect(submit).not.toHaveBeenCalled();
    });

    it("hands over to the ceremony 2.2 s after the hold, sending at once", async () => {
      flow.open(AT_100);
      await settle();
      press();
      await settle(HOLD_MS + 20);
      // Sent the moment the hold completes, not after the handoff.
      expect(submit).toHaveBeenCalledTimes(1);
      expect(root().dataset.handoff).toBe("charge");
      expect(charge()).toBe(1);
      // The same badge keeps charging: the player's P3, no swap.
      const held = q<Badge>("[data-prestige-current-badge]")!;
      expect(held.prestige).toBe(3);
      // The honeycomb's charge layer joins the idle one, which stays.
      expect(
        q("[data-prestige-overlay] .prestige-charge-comb.hx-charge"),
      ).not.toBeNull();
      const idle = q(
        "[data-prestige-overlay] .prestige-honeycomb.hx-idle:not(.prestige-charge-comb)",
      )!;
      expect(idle).not.toBeNull();

      await settle(HANDOFF_MS - 200);
      expect(q("[data-prestige-ceremony]")).toBeNull();
      await settle(250);
      expect(q("[data-prestige-confirm]")).toBeNull();
      const ceremony = q("[data-prestige-ceremony]")!;
      expect(ceremony.dataset.beat).toBe("shatter");
      expect(held.isConnected).toBe(false);
      // The same honeycomb carries on into the ceremony, now bursting.
      expect(idle.isConnected).toBe(true);
      expect(idle.classList.contains("hx-burst")).toBe(true);
      expect(
        q("[data-prestige-overlay] .prestige-charge-comb")!.classList.contains(
          "is-off",
        ),
      ).toBe(true);

      await settle(1600);
      expect(ceremony.dataset.beat).toBe("done");
      expect(q("[data-prestige-overlay] .prestige-charge-comb")).toBeNull();
    });

    it("waits for a slow answer before the flash", async () => {
      let finish!: (v: Awaited<ReturnType<PrestigeFlow["submit"]>>) => void;
      submit.mockReturnValueOnce(new Promise((r) => (finish = r)));
      flow.open(AT_100);
      await settle();
      await hold();
      await settle(HANDOFF_MS * 2);
      expect(q("[data-prestige-ceremony]")).toBeNull();
      expect(root().dataset.handoff).toBe("charge");
      finish({ ok: true, data: PRESTIGED });
      await settle();
      expect(q("[data-prestige-ceremony]")!.dataset.beat).toBe("shatter");
    });

    it("reverses the handoff and shows the error when it fails", async () => {
      let finish!: (v: Awaited<ReturnType<PrestigeFlow["submit"]>>) => void;
      submit.mockReturnValueOnce(new Promise((r) => (finish = r)));
      flow.open(AT_100);
      await settle();
      await hold();
      expect(root().dataset.handoff).toBe("charge");
      finish({ ok: false, reason: "failed" });
      await settle();
      expect(q("[data-prestige-ceremony]")).toBeNull();
      expect(root().hasAttribute("data-handoff")).toBe(false);
      expect(q("[data-prestige-overlay] .prestige-charge-comb")).toBeNull();
      expect(q("[data-prestige-error]")).not.toBeNull();
      expect(charge()).toBe(0);
      expect(fill()).toBe("scaleX(0)");
      expect(document.activeElement).toBe(confirmButton());
      expect(q<Badge>("[data-prestige-current-badge]")!.prestige).toBe(3);
      // Nothing is left scheduled to take over later.
      await settle(HANDOFF_MS * 2);
      expect(q("[data-prestige-ceremony]")).toBeNull();
    });

    it("crossfades under reduced motion", async () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query.includes("reduce"),
          addEventListener() {},
          removeEventListener() {},
        })),
      );
      flow.open(AT_100);
      await settle();
      await hold();
      expect(root().dataset.handoff).toBe("fade");
      expect(q("[data-prestige-overlay] .prestige-charge-comb")).toBeNull();
      await settle(HANDOFF_FADE_MS);
      const ceremony = q("[data-prestige-ceremony]")!;
      expect(ceremony.dataset.beat).toBe("done");
      expect(ceremony.hasAttribute("data-from-confirm")).toBe(true);
    });
  });

  it("ignores celebrate() while the confirmation is up", async () => {
    flow.open(AT_100);
    await settle();
    flow.celebrate(AT_100, PRESTIGED);
    await settle();
    expect(q("[data-prestige-confirm]")).not.toBeNull();
    expect(q("[data-prestige-ceremony]")).toBeNull();
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
