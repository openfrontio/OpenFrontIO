import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same boundary stubs as UsernameBareClaim.test.ts — the panel reaches the
// API, the in-game dialog and the Steam bridge, and none of the three is what
// these exercise.
const { getUser, updateUsername } = vi.hoisted(() => ({
  getUser: vi.fn(
    async (): Promise<{ steamId: string; name: string } | null> =>
      Promise.resolve(null),
  ),
  updateUsername: vi.fn(),
}));
vi.mock("../../src/client/Api", () => ({
  updateUsername: (name: string) => updateUsername(name),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => true),
  showInGameAlert: vi.fn(async () => true),
}));
vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => true, getUser: () => getUser() },
}));

import "../../src/client/components/UsernamePanel";
import type { UsernamePanel } from "../../src/client/components/UsernamePanel";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

function player(
  overrides: Record<string, unknown> = {},
): UserMeResponse["player"] {
  return {
    publicId: "p",
    // The day-0 buyer: entitled from the moment the grant lands, and has never
    // claimed a name.
    username: null,
    usernameBase: null,
    usernameStatus: "premium",
    nextUsernameChangeAt: null,
    usernameClaimExpiresAt: null,
    ...overrides,
  } as unknown as UserMeResponse["player"];
}

async function mount(
  overrides: Record<string, unknown> = {},
): Promise<UsernamePanel> {
  const el = document.createElement("username-panel") as UsernamePanel;
  el.player = player(overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  // Let the persona promise settle and the re-render land.
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

// Scoped by tag, not by id. Two panels can be mounted at once here, and
// jsdom resolves an "#id" selector through document.getElementById first — so
// it would answer with the FIRST panel's input and then report null for the
// second.
function field(el: UsernamePanel): HTMLInputElement {
  return el.querySelector<HTMLInputElement>("input")!;
}

function fieldValue(el: UsernamePanel): string {
  return field(el).value;
}

describe("claim form prefill", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    getUser.mockReset();
    getUser.mockResolvedValue(null);
    updateUsername.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("seeds the field with the player's Steam persona", async () => {
    getUser.mockResolvedValue({ steamId: "x", name: "Ada Lovelace" });
    expect(fieldValue(await mount())).toBe("Ada Lovelace");
  });

  // The reason this uses sanitizeAccountPersona rather than sanitizePersona:
  // the in-game charset allows both of these, the account form does not, and
  // seeding the raw form would prefill a draft that fails on save.
  it("reduces a persona the account form would reject", async () => {
    getUser.mockResolvedValue({ steamId: "x", name: "Ada.Lovelace" });
    expect(fieldValue(await mount())).toBe("Ada Lovelace");
  });

  it("leaves the field empty when nothing usable survives", async () => {
    getUser.mockResolvedValue({ steamId: "x", name: "★★★" });
    expect(fieldValue(await mount())).toBe("");
  });

  it("leaves the field empty when there is no persona at all", async () => {
    getUser.mockResolvedValue(null);
    expect(fieldValue(await mount())).toBe("");
  });

  it("survives a Steam bridge that fails", async () => {
    getUser.mockRejectedValue(new Error("bridge down"));
    expect(fieldValue(await mount())).toBe("");
  });

  // A name the player already chose is never overwritten, however it is
  // spelled — the prefill is only for a form that would otherwise be blank.
  it("never overwrites a name the player already holds", async () => {
    getUser.mockResolvedValue({ steamId: "x", name: "Ada Lovelace" });
    expect(
      fieldValue(await mount({ username: "Ninja", usernameBase: "Ninja" })),
    ).toBe("Ninja");
    expect(
      fieldValue(
        await mount({ username: "Ninja.4471", usernameBase: "Ninja" }),
      ),
    ).toBe("Ninja");
  });

  it("does not clobber a name typed while the persona was in flight", async () => {
    let release: (v: { steamId: string; name: string }) => void = () => {};
    getUser.mockReturnValue(
      new Promise<{ steamId: string; name: string }>((resolve) => {
        release = resolve;
      }),
    );
    const el = document.createElement("username-panel") as UsernamePanel;
    el.player = player();
    document.body.appendChild(el);
    await el.updateComplete;

    const input = field(el);
    input.value = "MyOwnName";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    release({ steamId: "x", name: "Ada Lovelace" });
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(fieldValue(el)).toBe("MyOwnName");
  });

  // A player who already has a name must never be re-seeded, and `username`
  // alone is enough to say so: a response carrying it without `usernameBase`
  // (an older API, a partial payload) would otherwise read as nameless and
  // seed a persona into a named player's rename box.
  it("does not seed a named player whose base is missing", async () => {
    getUser.mockResolvedValue({ steamId: "x", name: "Ada Lovelace" });
    expect(
      fieldValue(await mount({ username: "Ninja", usernameBase: undefined })),
    ).toBe("");
    expect(getUser).not.toHaveBeenCalled();
  });

  // The join-name guard, at the seam rather than by construction. The seed is
  // a suggestion in a text box: the only thing it may become is the CLAIM sent
  // to the API, after which the panel reloads so every consumer — including
  // the name the player joins under — starts from a fresh /users/@me. It must
  // never become the in-game name directly.
  it("sends the seed as the claim and then reloads, storing nothing", async () => {
    const reload = vi.fn();
    const realDescriptor = Object.getOwnPropertyDescriptor(window, "location")!;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload, hash: "" },
    });
    try {
      getUser.mockResolvedValue({ steamId: "x", name: "Ada.Lovelace" });
      updateUsername.mockResolvedValue({
        ok: true,
        data: {
          username: "Ada Lovelace",
          base: "Ada Lovelace",
          discriminator: "0001",
          usernameStatus: "premium",
          nextUsernameChangeAt: null,
          bareClaim: "claimed",
        },
      });
      const el = await mount();
      expect(fieldValue(el)).toBe("Ada Lovelace");

      field(el).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

      expect(updateUsername).toHaveBeenCalledWith("Ada Lovelace");
      expect(reload).toHaveBeenCalled();
      // Nothing the join path resolves from was touched.
      expect(localStorage.getItem("username")).toBeNull();
      expect(localStorage.getItem("usernameIsGenerated")).toBeNull();
      expect(localStorage.length).toBe(0);
    } finally {
      Object.defineProperty(window, "location", realDescriptor);
    }
  });
});
