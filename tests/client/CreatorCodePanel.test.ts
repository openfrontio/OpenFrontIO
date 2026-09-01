import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted because vi.mock is hoisted above the imports: the spies have to
// exist before the factories can close over them. Same shape as
// UsernameBareClaim.test.ts / UsernameVerifiedRoute.test.ts.
const { setCreatorCode, clearCreatorCode, getUserMe } = vi.hoisted(() => ({
  setCreatorCode: vi.fn(),
  clearCreatorCode: vi.fn(),
  getUserMe: vi.fn(),
}));
vi.mock("../../src/client/Api", () => ({
  setCreatorCode: (code: string) => setCreatorCode(code),
  clearCreatorCode: () => clearCreatorCode(),
  getUserMe: () => getUserMe(),
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  // Echo the key and its interpolations so assertions can read both.
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import "../../src/client/components/CreatorCodePanel";
import type {
  CreatorChangedDetail,
  CreatorCodePanel,
} from "../../src/client/components/CreatorCodePanel";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

type CreatorBinding = NonNullable<UserMeResponse["player"]["creator"]>;

function creator(overrides: Partial<CreatorBinding> = {}): CreatorBinding {
  return {
    code: "LEWIS",
    displayName: "Lewis",
    sinceAt: "2026-08-01T00:00:00.000Z",
    canChangeAt: null,
    ...overrides,
  };
}

// The shape refreshAfterChange() reads off getUserMe()'s resolved value —
// only player.creator matters to the panel.
function userMeWith(creatorState: CreatorBinding | null) {
  return { player: { creator: creatorState } };
}

describe("CreatorCodePanel", () => {
  let reload: ReturnType<typeof vi.fn>;
  const realLocation = window.location;
  const realLocationDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "location",
  )!;

  function findOButton(
    el: CreatorCodePanel,
    translationKey: string,
  ): HTMLElement | undefined {
    return Array.from(el.querySelectorAll("o-button")).find(
      (b) => b.getAttribute("translationKey") === translationKey,
    ) as HTMLElement | undefined;
  }

  function findButton(
    el: CreatorCodePanel,
    translationKey: string,
  ): HTMLButtonElement | undefined {
    return (
      findOButton(el, translationKey)?.querySelector("button") ?? undefined
    );
  }

  function input(el: CreatorCodePanel): HTMLInputElement {
    return el.querySelector<HTMLInputElement>("#creator-code-panel-input")!;
  }

  async function mount(
    creatorState: CreatorBinding | null | undefined,
    prefillCode?: string,
  ): Promise<CreatorCodePanel> {
    const el = document.createElement("creator-code-panel") as CreatorCodePanel;
    el.creator = creatorState;
    if (prefillCode !== undefined) el.prefillCode = prefillCode;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  // Listens for the panel's `creator-changed` event, the same way AccountModal
  // does (host patches its cached player.creator and re-renders, feeding a
  // fresh `.creator` back down) — collects every emitted detail.
  function captureCreatorChanged(el: CreatorCodePanel): CreatorChangedDetail[] {
    const events: CreatorChangedDetail[] = [];
    el.addEventListener("creator-changed", (e) =>
      events.push((e as CustomEvent<CreatorChangedDetail>).detail),
    );
    return events;
  }

  async function type(el: CreatorCodePanel, value: string): Promise<void> {
    const field = input(el);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
  }

  // Lets an in-flight API call (and the state updates after it) settle.
  async function settle(el: CreatorCodePanel): Promise<void> {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    setCreatorCode.mockReset();
    clearCreatorCode.mockReset();
    getUserMe.mockReset();
    reload = vi.fn();
    // jsdom's location.reload throws "not implemented", and `reload` itself
    // is a non-configurable own property — vi.spyOn(window.location, "reload")
    // fails with "Cannot redefine property". `window.location` as a whole IS
    // configurable here, so replacing the object is the way in (mirrors
    // UsernameBareClaim.test.ts). The panel must never call this — success is
    // an in-place refresh via the `creator-changed` event, not a reload.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload, hash: "" },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", realLocationDescriptor);
  });

  it("renders nothing when creator is undefined (old backend)", async () => {
    const el = await mount(undefined);
    expect(el.textContent?.trim()).toBe("");
    expect(el.querySelectorAll("o-button").length).toBe(0);
  });

  describe("unbound", () => {
    it("shows the support input and button, but no unsupport control", async () => {
      const el = await mount(null);
      expect(input(el)).toBeTruthy();
      expect(findOButton(el, "creator_code.support")).toBeTruthy();
      expect(findOButton(el, "creator_code.unsupport")).toBeFalsy();
      expect(findOButton(el, "creator_code.change")).toBeFalsy();
    });

    it("prefills the input from prefillCode, normalized to its canonical form", async () => {
      const el = await mount(null, "wombat");
      expect(input(el).value).toBe("WOMBAT");
      expect(el.textContent).not.toContain("creator_code.errors.invalid");
    });

    it("shows an inline error for an invalid/stale prefillCode, keeping the raw value visible", async () => {
      const el = await mount(null, "ab"); // below the 3-char floor
      expect(input(el).value).toBe("ab");
      expect(el.textContent).toContain("creator_code.errors.invalid");
      // Still not armable/submittable until the value is corrected.
      expect(findButton(el, "creator_code.support")!.disabled).toBe(true);
    });

    it("does not prefill when no prefillCode is supplied", async () => {
      const el = await mount(null);
      expect(input(el).value).toBe("");
    });

    it("arms on the first click, disarms on any input change, fires on the confirming click, and refreshes in place (no reload)", async () => {
      setCreatorCode.mockResolvedValue({
        ok: true,
        creator: { code: "WOMBAT2", displayName: "Wombat2" },
      });
      const freshCreator = creator({
        code: "WOMBAT2",
        displayName: "Wombat2",
        sinceAt: "2026-09-01T00:00:00.000Z",
      });
      getUserMe.mockResolvedValue(userMeWith(freshCreator));
      const el = await mount(null);
      const events = captureCreatorChanged(el);
      await type(el, "wombat");

      findButton(el, "creator_code.support")!.click();
      await el.updateComplete;

      // Armed: same button now carries the 7-day-lock confirm copy, and the
      // request has not fired yet.
      expect(setCreatorCode).not.toHaveBeenCalled();
      expect(findOButton(el, "creator_code.confirm_lock")).toBeTruthy();
      expect(findOButton(el, "creator_code.support")).toBeFalsy();

      // Editing the code disarms it.
      await type(el, "wombat2");
      expect(findOButton(el, "creator_code.confirm_lock")).toBeFalsy();
      expect(findOButton(el, "creator_code.support")).toBeTruthy();

      // Re-arm and fire.
      findButton(el, "creator_code.support")!.click();
      await el.updateComplete;
      findButton(el, "creator_code.confirm_lock")!.click();
      await settle(el);

      expect(setCreatorCode).toHaveBeenCalledTimes(1);
      expect(setCreatorCode).toHaveBeenCalledWith("WOMBAT2");
      // In-place refresh, not a page reload.
      expect(reload).not.toHaveBeenCalled();
      expect(getUserMe).toHaveBeenCalledTimes(1);
      expect(events).toEqual([{ creator: freshCreator }]);

      // Simulate the host (AccountModal.handleCreatorChanged) feeding the
      // fresh creator back down as a new `.creator` prop.
      el.creator = events[0].creator;
      await el.updateComplete;
      expect(el.textContent).toContain(
        'creator_code.supporting:{"name":"Wombat2","code":"WOMBAT2"}',
      );
    });

    it("does not arm on a client-invalid code", async () => {
      const el = await mount(null);
      await type(el, "ab"); // below the 3-char floor

      findButton(el, "creator_code.support")!.click();
      await el.updateComplete;

      expect(findOButton(el, "creator_code.confirm_lock")).toBeFalsy();
      expect(setCreatorCode).not.toHaveBeenCalled();
    });
  });

  describe("bound", () => {
    it("shows who is supported, the code, and the since date", async () => {
      const el = await mount(creator());
      const text = el.textContent ?? "";
      expect(text).toContain(
        'creator_code.supporting:{"name":"Lewis","code":"LEWIS"}',
      );
      expect(text).toContain('creator_code.since:{"date":');
      expect(findOButton(el, "creator_code.change")).toBeTruthy();
      expect(findOButton(el, "creator_code.unsupport")).toBeTruthy();
      expect(findOButton(el, "creator_code.support")).toBeFalsy();
    });

    // Unbinding is never cooldown-gated server-side (only the NEXT bind is) —
    // so Unsupport must stay enabled through the cooldown. Only the
    // change-to-another-creator input/button lock.
    it("disables the change field/button while canChangeAt is in the future, but leaves Unsupport enabled, with a days message", async () => {
      const future = new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const el = await mount(creator({ canChangeAt: future }));

      expect(input(el).disabled).toBe(true);
      expect(findButton(el, "creator_code.change")!.disabled).toBe(true);
      expect(findButton(el, "creator_code.unsupport")!.disabled).toBe(false);
      expect(el.textContent).toContain('creator_code.cooldown_days:{"days":3}');
    });

    it("leaves controls enabled once canChangeAt has passed", async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const el = await mount(creator({ canChangeAt: past }));

      expect(input(el).disabled).toBe(false);
      expect(findButton(el, "creator_code.unsupport")!.disabled).toBe(false);
      expect(el.textContent).not.toContain("creator_code.cooldown_days");
    });

    it("switches to a new creator through the change field, arm-then-fire, and refreshes in place (no reload)", async () => {
      setCreatorCode.mockResolvedValue({
        ok: true,
        creator: { code: "OTTER", displayName: "Otter" },
      });
      const freshCreator = creator({ code: "OTTER", displayName: "Otter" });
      getUserMe.mockResolvedValue(userMeWith(freshCreator));
      const el = await mount(creator());
      const events = captureCreatorChanged(el);
      await type(el, "otter");

      findButton(el, "creator_code.change")!.click();
      await el.updateComplete;
      expect(setCreatorCode).not.toHaveBeenCalled();

      findButton(el, "creator_code.confirm_lock")!.click();
      await settle(el);

      expect(setCreatorCode).toHaveBeenCalledWith("OTTER");
      expect(reload).not.toHaveBeenCalled();
      expect(events).toEqual([{ creator: freshCreator }]);
    });

    it("arms then fires unsupport on two clicks (confirm copy warns about the next-bind lock), and refreshes in place (no reload)", async () => {
      clearCreatorCode.mockResolvedValue(true);
      getUserMe.mockResolvedValue(userMeWith(null));
      const el = await mount(creator());
      const events = captureCreatorChanged(el);

      findButton(el, "creator_code.unsupport")!.click();
      await el.updateComplete;

      expect(clearCreatorCode).not.toHaveBeenCalled();
      expect(findOButton(el, "creator_code.confirm_unsupport")).toBeTruthy();

      findButton(el, "creator_code.confirm_unsupport")!.click();
      await settle(el);

      expect(clearCreatorCode).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
      expect(events).toEqual([{ creator: null }]);

      // Simulate the host feeding `creator: null` back down.
      el.creator = events[0].creator;
      await el.updateComplete;
      expect(findOButton(el, "creator_code.support")).toBeTruthy();
      expect(findOButton(el, "creator_code.unsupport")).toBeFalsy();
    });

    // The whole point of fix #1: unbinding is never blocked, even mid-cooldown.
    it("keeps Unsupport clickable and completes the arm-then-fire flow while canChangeAt is in the future", async () => {
      clearCreatorCode.mockResolvedValue(true);
      getUserMe.mockResolvedValue(userMeWith(null));
      const future = new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const el = await mount(creator({ canChangeAt: future }));

      expect(findButton(el, "creator_code.unsupport")!.disabled).toBe(false);

      findButton(el, "creator_code.unsupport")!.click();
      await el.updateComplete;
      findButton(el, "creator_code.confirm_unsupport")!.click();
      await settle(el);

      expect(clearCreatorCode).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    });

    it("disarms an armed unsupport when the code field is edited", async () => {
      const el = await mount(creator());

      findButton(el, "creator_code.unsupport")!.click();
      await el.updateComplete;
      expect(findOButton(el, "creator_code.confirm_unsupport")).toBeTruthy();

      await type(el, "otter");
      expect(findOButton(el, "creator_code.confirm_unsupport")).toBeFalsy();
      expect(findOButton(el, "creator_code.unsupport")).toBeTruthy();
      expect(clearCreatorCode).not.toHaveBeenCalled();
    });
  });

  describe("error mapping", () => {
    const cases: Array<{
      code:
        | "invalid"
        | "not_found"
        | "self_referral"
        | "failed"
        | "rate_limited";
      expectKey: string;
    }> = [
      { code: "invalid", expectKey: "creator_code.errors.invalid" },
      { code: "not_found", expectKey: "creator_code.errors.not_found" },
      {
        code: "self_referral",
        expectKey: "creator_code.errors.self_referral",
      },
      { code: "failed", expectKey: "creator_code.errors.failed" },
      { code: "rate_limited", expectKey: "creator_code.errors.rate_limited" },
    ];

    it.each(cases)(
      "maps SetCreatorCodeResult code=$code to $expectKey",
      async ({ code, expectKey }) => {
        setCreatorCode.mockResolvedValue({ ok: false, code });
        const el = await mount(null);
        await type(el, "wombat");

        findButton(el, "creator_code.support")!.click();
        await el.updateComplete;
        findButton(el, "creator_code.confirm_lock")!.click();
        await settle(el);

        expect(el.textContent).toContain(expectKey);
        expect(reload).not.toHaveBeenCalled();
        expect(getUserMe).not.toHaveBeenCalled();
      },
    );

    it("interpolates the cooldown days from retryAfterSeconds, rounding up", async () => {
      setCreatorCode.mockResolvedValue({
        ok: false,
        code: "cooldown",
        retryAfterSeconds: 86_401, // just over 1 day -> ceils to 2
      });
      const el = await mount(null);
      await type(el, "wombat");

      findButton(el, "creator_code.support")!.click();
      await el.updateComplete;
      findButton(el, "creator_code.confirm_lock")!.click();
      await settle(el);

      expect(el.textContent).toContain('creator_code.cooldown_days:{"days":2}');
      expect(reload).not.toHaveBeenCalled();
    });

    it("shows a generic cooldown message when retryAfterSeconds is null (no Retry-After header)", async () => {
      setCreatorCode.mockResolvedValue({
        ok: false,
        code: "cooldown",
        retryAfterSeconds: null,
      });
      const el = await mount(null);
      await type(el, "wombat");

      findButton(el, "creator_code.support")!.click();
      await el.updateComplete;
      findButton(el, "creator_code.confirm_lock")!.click();
      await settle(el);

      expect(el.textContent).toContain("creator_code.errors.cooldown");
      expect(el.textContent).not.toContain("creator_code.cooldown_days");
      expect(reload).not.toHaveBeenCalled();
    });

    it("shows a generic failure message when unsupport fails", async () => {
      clearCreatorCode.mockResolvedValue(false);
      const el = await mount(creator());

      findButton(el, "creator_code.unsupport")!.click();
      await el.updateComplete;
      findButton(el, "creator_code.confirm_unsupport")!.click();
      await settle(el);

      expect(el.textContent).toContain("creator_code.errors.failed");
      expect(reload).not.toHaveBeenCalled();
      expect(getUserMe).not.toHaveBeenCalled();
    });

    it("leaves the panel showing its prior state when the post-success refresh fetch fails", async () => {
      setCreatorCode.mockResolvedValue({
        ok: true,
        creator: { code: "WOMBAT", displayName: "Wombat" },
      });
      getUserMe.mockResolvedValue(false);
      const el = await mount(null);
      const events = captureCreatorChanged(el);
      await type(el, "wombat");

      findButton(el, "creator_code.support")!.click();
      await el.updateComplete;
      findButton(el, "creator_code.confirm_lock")!.click();
      await settle(el);

      expect(reload).not.toHaveBeenCalled();
      expect(events).toEqual([]); // no event when the re-fetch itself fails
      expect(el.creator).toBeNull(); // still whatever it was mounted with
    });
  });
});
