import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCosmetics } from "../../src/client/Cosmetics";
import "../../src/client/Store";
import type { StoreModal } from "../../src/client/Store";
import type { TribesPanel } from "../../src/client/components/TribesPanel";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// The store's own network is out of scope here: the tribes panel fetches the
// player's tribe names as soon as it learns the player is logged in, and the
// catalog is fetched on every userMeResponse.
vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getMyTribeNames: vi.fn(async () => false as const),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(async () => null),
}));

const steamOnly = {
  user: { steam: { id: "76561198000000000" } },
  player: { publicId: "p", flares: [], currency: { hard: 0, soft: 0 } },
} as unknown as UserMeResponse;

function fireUserMe(detail: UserMeResponse | false) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

/**
 * OPE-338: the store must never show a logged-out state to a logged-in
 * player. Its account state starts out indistinguishable from "no session"
 * (`false`) until Main's first userMeResponse broadcast, which on desktop
 * waits on a Steam ticket exchange -- so every logged-out rendering has to be
 * held back until auth has actually settled, not merely defaulted off.
 */
describe("StoreModal while auth is pending", () => {
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;
  let store: StoreModal;

  beforeEach(async () => {
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
  });

  afterEach(() => {
    store.remove();
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
  });

  async function openTribes() {
    store.open({ tab: "tribes" });
    await store.updateComplete;
  }

  function warningButton() {
    return store.querySelector("not-logged-in-warning button");
  }

  function tribesPanel() {
    return store.querySelector<TribesPanel>("tribes-panel");
  }

  // The prompt's sign-in button, by label (translateText returns the key
  // without a lang-selector). Null both when the panel is absent and when it
  // renders the logged-in view, whose purchase card has buttons of its own;
  // `?.` alone would yield undefined for an absent panel, which
  // `.not.toBeNull()` accepts.
  function signInPrompt() {
    return (
      [...(tribesPanel()?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent?.trim() === "main.sign_in",
      ) ?? null
    );
  }

  async function settle() {
    await store.updateComplete;
    await tribesPanel()?.updateComplete;
  }

  it("shows neither the warning nor the tribes sign-in prompt before auth settles", async () => {
    await openTribes();
    await settle();
    expect(warningButton()).toBeNull();
    expect(tribesPanel()).toBeNull();
  });

  it("shows both once auth settles with no session", async () => {
    await openTribes();
    fireUserMe(false);
    await vi.waitFor(async () => {
      await settle();
      expect(warningButton()).not.toBeNull();
      expect(signInPrompt()).not.toBeNull();
    });
  });

  it("shows the tribes sign-in prompt as soon as auth settles, not after the catalog", async () => {
    // onUserMe() awaits fetchCosmetics() before it calls refresh(); a settled
    // no-session result must schedule its own render rather than sit behind
    // a slow (here: never-resolving) catalog request.
    vi.mocked(fetchCosmetics).mockReturnValue(new Promise(() => {}));
    await openTribes();
    fireUserMe(false);
    await vi.waitFor(async () => {
      await settle();
      expect(signInPrompt()).not.toBeNull();
    });
    expect(warningButton()).not.toBeNull();
  });

  it("shows the logged-in tribes panel as soon as auth settles, not after the catalog", async () => {
    vi.mocked(fetchCosmetics).mockReturnValue(new Promise(() => {}));
    await openTribes();
    fireUserMe(steamOnly);
    await vi.waitFor(async () => {
      await settle();
      expect(tribesPanel()).not.toBeNull();
    });
    expect(warningButton()).toBeNull();
    expect(signInPrompt()).toBeNull();
  });

  it("never shows a logged-out state to a logged-in player, before or after auth settles", async () => {
    await openTribes();
    await settle();
    expect(warningButton()).toBeNull();
    expect(tribesPanel()).toBeNull();

    fireUserMe(steamOnly);
    await vi.waitFor(async () => {
      await settle();
      expect(tribesPanel()).not.toBeNull();
    });
    expect(warningButton()).toBeNull();
    // The panel's logged-in view has a purchase card, not a sign-in prompt.
    expect(tribesPanel()!.textContent).not.toContain(
      "store.tribes_login_required",
    );
    expect(signInPrompt()).toBeNull();
  });
});
