import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PutUsernameResponseSchema } from "../../src/core/ApiSchemas";

// The panel reaches the API and the in-game dialog; stub both boundaries so
// these exercise the branch on the response body rather than the network.
//
// vi.hoisted because vi.mock is hoisted above the imports: the spies have to
// exist before the factories can close over them. Same shape as
// UsernameVerifiedRoute.test.ts.
const { updateUsername, showInGameConfirm, showInGameAlert } = vi.hoisted(
  () => ({
    updateUsername: vi.fn(),
    showInGameConfirm: vi.fn(async (_message: string, _options?: unknown) =>
      Promise.resolve(true),
    ),
    showInGameAlert: vi.fn(async (_message: string) => Promise.resolve(true)),
  }),
);
vi.mock("../../src/client/Api", () => ({
  // Forward opts only when the caller actually passed it, so the spy's
  // recorded call arity matches what the panel really sent (mock.calls[0]
  // must read as a one-element array, not ["Ninja", undefined]).
  updateUsername: (name: string, opts?: unknown) =>
    opts === undefined ? updateUsername(name) : updateUsername(name, opts),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: (message: string, options?: unknown) =>
    showInGameConfirm(message, options),
  showInGameAlert: (message: string) => showInGameAlert(message),
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  // Echo the key and its interpolations so assertions can read both.
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import "../../src/client/components/UsernamePanel";
import type { UsernamePanel } from "../../src/client/components/UsernamePanel";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    username: "Ninja.4471",
    base: "Ninja",
    discriminator: "4471",
    usernameStatus: "premium",
    nextUsernameChangeAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PutUsernameResponseSchema bareClaim", () => {
  // This client is deliberately deployed BEFORE the API change that adds the
  // field. Requiring it would make every rename against today's API fail
  // safeParse and surface as a generic "failed".
  it("parses a response from an API that does not send the field", () => {
    const parsed = PutUsernameResponseSchema.safeParse(okBody());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.bareClaim).toBeUndefined();
  });

  it("keeps the field once the API sends it", () => {
    for (const value of ["claimed", "unavailable", "not_eligible"] as const) {
      const parsed = PutUsernameResponseSchema.safeParse(
        okBody({ bareClaim: value }),
      );
      expect(parsed.success, value).toBe(true);
      expect(parsed.success && parsed.data.bareClaim).toBe(value);
    }
  });

  // The same skew in the other direction: the client ships BEHIND the API
  // too, on every API change. This is a 200 — the rename has committed — so
  // failing the parse would report failure for a rename that succeeded and
  // burn the 30-day cooldown. Dropping the value degrades to "say nothing",
  // which is exactly how a client that predates the value should behave.
  it("drops a value outside the enum rather than failing the parse", () => {
    const parsed = PutUsernameResponseSchema.safeParse(
      okBody({ bareClaim: "nope" }),
    );
    expect(parsed.success).toBe(true);
    // Specifically `undefined`, not the raw string and not some substituted
    // enum member: `.catch("claimed")` would silently make a future
    // "unavailable"-like value say nothing AND claim it succeeded outright.
    expect(parsed.success && parsed.data.bareClaim).toBeUndefined();
  });

  // The rest of the body still has to be right — tolerating an unknown
  // bareClaim must not turn into tolerating a malformed response.
  it("still rejects a response whose other fields are wrong", () => {
    expect(
      PutUsernameResponseSchema.safeParse(okBody({ username: 42 })).success,
    ).toBe(false);
  });
});

describe("UsernamePanel bare-claim fallback", () => {
  let reload: ReturnType<typeof vi.fn>;
  const realLocation = window.location;
  const realLocationDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "location",
  )!;

  function player(
    overrides: Record<string, unknown> = {},
  ): UserMeResponse["player"] {
    return {
      publicId: "p",
      username: "Ninja",
      usernameBase: "Ninja",
      usernameStatus: "premium",
      nextUsernameChangeAt: null,
      usernameClaimExpiresAt: null,
      ...overrides,
    } as unknown as UserMeResponse["player"];
  }

  // Drives the real path a player takes: type a name, press Enter. The panel
  // has no <form> — Enter on the input and the save button both call
  // handleSave directly.
  async function submit(el: UsernamePanel, name: string) {
    const input = el.querySelector<HTMLInputElement>("#username-panel-input")!;
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // Lets the confirm dialog, the update call and any alert all settle.
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }

  async function mount(): Promise<UsernamePanel> {
    const el = document.createElement("username-panel") as UsernamePanel;
    el.player = player();
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    updateUsername.mockReset();
    showInGameConfirm.mockReset();
    showInGameConfirm.mockResolvedValue(true);
    showInGameAlert.mockReset();
    showInGameAlert.mockResolvedValue(true);
    reload = vi.fn();
    // jsdom's location.reload throws "not implemented", and `reload` itself is
    // a non-configurable own property — vi.spyOn(window.location, "reload")
    // fails with "Cannot redefine property". `window.location` as a whole IS
    // configurable here, so replacing the object is the way in.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload, hash: "" },
    });
  });

  afterEach(() => {
    // Put the real one back rather than leaving a global replaced.
    Object.defineProperty(window, "location", realLocationDescriptor);
  });

  // The whole point of this change: a fallback is a 200, so without it the
  // player reloads into a name they never chose with nothing to explain it —
  // and the rename has already consumed their 30-day cooldown.
  it("explains the suffixed name before reloading", async () => {
    updateUsername.mockResolvedValue({
      ok: true,
      data: okBody({ bareClaim: "unavailable" }),
    });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    const message = showInGameAlert.mock.calls[0][0];
    // Names both what they asked for and what they actually got...
    expect(message).toContain("Ninja.4471");
    // ...and says the rename was spent, which is the part that stings.
    expect(message).toContain("username_bare_unavailable");
    expect(reload).toHaveBeenCalled();
  });

  // The `await` on the dialog is load-bearing: without it the reload races
  // the dialog away and the player never reads why their name changed.
  //
  // Note what does NOT hold it: `showInGameAlert` is *invoked* synchronously
  // either way (an async function runs to its first await), so
  // invocationCallOrder alone still passes when the `await` is replaced with
  // `void`. What distinguishes them is whether the reload waits for the
  // dialog to be dismissed, so the alert is left pending here.
  it("does not reload until the player has dismissed the dialog", async () => {
    let dismiss!: () => void;
    showInGameAlert.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          dismiss = () => resolve(true);
        }),
    );
    updateUsername.mockResolvedValue({
      ok: true,
      data: okBody({ bareClaim: "unavailable" }),
    });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    dismiss();
    await new Promise((r) => setTimeout(r, 0));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(showInGameAlert.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0],
    );
  });

  it("names the date they can change again when the API supplies one", async () => {
    updateUsername.mockResolvedValue({
      ok: true,
      data: okBody({ bareClaim: "unavailable" }),
    });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert.mock.calls[0][0]).toContain(
      "username_bare_unavailable:",
    );
    expect(showInGameAlert.mock.calls[0][0]).not.toContain("no_date");
  });

  it("drops the date rather than showing a blank one", async () => {
    updateUsername.mockResolvedValue({
      ok: true,
      data: okBody({ bareClaim: "unavailable", nextUsernameChangeAt: null }),
    });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert.mock.calls[0][0]).toContain(
      "username_bare_unavailable_no_date",
    );
  });

  // A free player always gets a suffix — that is how free names work, and
  // saying something about it would be noise on a perfectly normal rename.
  it.each(["claimed", "not_eligible"] as const)(
    "says nothing extra for bareClaim %s",
    async (bareClaim) => {
      updateUsername.mockResolvedValue({
        ok: true,
        data: okBody({ bareClaim }),
      });
      const el = await mount();

      await submit(el, "Ninja");

      expect(showInGameAlert).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    },
  );

  // Before the API change ships, the field is simply absent. Behaviour must be
  // identical to today: reload, no dialog.
  it("says nothing when the API does not send the field", async () => {
    updateUsername.mockResolvedValue({ ok: true, data: okBody() });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  // The tests above hand the panel a hand-built body, so they never reach
  // safeParse and would not notice the schema rejecting a value. This one
  // runs the real schema over a value no client knows yet — what a client
  // sees the day infra adds a fourth one. The rename is a 200 and has
  // already committed, so the only correct outcome is "success, say
  // nothing": no dialog, no inline error, and a reload onto the new name.
  it("treats an unknown bareClaim as a success with nothing to say", async () => {
    updateUsername.mockResolvedValue({
      ok: true,
      data: PutUsernameResponseSchema.parse(
        okBody({ bareClaim: "some_future_value" }),
      ),
    });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain("username_error");
    expect(reload).toHaveBeenCalled();
  });

  it("still surfaces the 409s that survive as an inline error", async () => {
    updateUsername.mockResolvedValue({ ok: false, code: "taken" });
    const el = await mount();

    await submit(el, "Ninja");

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(el.textContent).toContain("username_error_taken");
  });

  // Spec (10 Sept 2026): a held bare name is refused with nothing written.
  // The player then chooses: the numbered form (one more request, with
  // acceptSuffixed) or another name (nothing happens).
  describe("held bare name (409 BARE_NAME_TAKEN)", () => {
    it("asks before taking the numbered form, then resubmits with acceptSuffixed", async () => {
      updateUsername
        .mockResolvedValueOnce({ ok: false, code: "bare_taken", base: "Ninja" })
        .mockResolvedValueOnce({
          ok: true,
          data: okBody({ bareClaim: "unavailable" }),
        });
      // First confirm is the ordinary "change username?"; second is the choice.
      showInGameConfirm.mockResolvedValue(true);
      const el = await mount();

      await submit(el, "Ninja");

      expect(updateUsername).toHaveBeenCalledTimes(2);
      expect(updateUsername.mock.calls[0]).toEqual(["Ninja"]);
      expect(updateUsername.mock.calls[1]).toEqual([
        "Ninja",
        { acceptSuffixed: true },
      ]);
      expect(showInGameConfirm).toHaveBeenCalledTimes(2);
      expect(showInGameConfirm.mock.calls[1][0]).toContain(
        'account_modal.username_bare_taken_body:{"requested":"Ninja"}',
      );
      // They chose it knowingly: no second dialog after the fact.
      expect(showInGameAlert).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    });

    it("writes nothing and re-enables the form when they choose another name", async () => {
      updateUsername.mockResolvedValueOnce({
        ok: false,
        code: "bare_taken",
        base: "Ninja",
      });
      showInGameConfirm
        .mockResolvedValueOnce(true) // change username?
        .mockResolvedValueOnce(false); // take the numbered form? no
      const el = await mount();

      await submit(el, "Ninja");

      expect(updateUsername).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
      expect(showInGameAlert).not.toHaveBeenCalled();
      const input = el.querySelector<HTMLInputElement>(
        "#username-panel-input",
      )!;
      expect(input.disabled).toBe(false);
    });

    it("does not ask twice: a second refusal after yes becomes an inline error", async () => {
      updateUsername
        .mockResolvedValueOnce({ ok: false, code: "bare_taken", base: "Ninja" })
        .mockResolvedValueOnce({
          ok: false,
          code: "bare_taken",
          base: "Ninja",
        });
      showInGameConfirm.mockResolvedValue(true);
      const el = await mount();

      await submit(el, "Ninja");

      expect(updateUsername).toHaveBeenCalledTimes(2);
      // The ordinary "change username?" confirm plus ONE choice dialog.
      expect(showInGameConfirm).toHaveBeenCalledTimes(2);
      expect(reload).not.toHaveBeenCalled();
      expect(el.textContent).toContain("username_error_taken");
      const input = el.querySelector<HTMLInputElement>(
        "#username-panel-input",
      )!;
      expect(input.disabled).toBe(false);
    });
  });
});
