import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same boundary stubs as UsernameBareClaim.test.ts — the panel reaches the
// API, the in-game dialog and the Steam bridge, and none of the three is what
// these exercise.
const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(
    async (): Promise<{ steamId: string; name: string } | null> =>
      Promise.resolve(null),
  ),
}));
vi.mock("../../src/client/Api", () => ({
  updateUsername: vi.fn(),
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

  // The join-name guard. The prefill is a suggestion in a text box: it must
  // not become the name the player plays under, and the only way it could is
  // by reaching the keys <username-input> resolves from. After a successful
  // claim the panel reloads, so the join name comes from a fresh /users/@me —
  // see "a claimed name, not the seed" in PlayerName.test.ts.
  it("writes nothing to the stored in-game name", async () => {
    getUser.mockResolvedValue({ steamId: "x", name: "Ada Lovelace" });
    await mount();
    expect(localStorage.getItem("username")).toBeNull();
    expect(localStorage.getItem("usernameIsGenerated")).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
