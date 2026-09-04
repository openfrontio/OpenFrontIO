import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../src/core/ApiSchemas";
import { MAX_USERNAME_LENGTH } from "../src/core/validations/username";

// The identity bar pulls in the whole client bootstrap (auth, Steam,
// CrazyGames, the clan API). Stub the boundaries so the test exercises the
// component's own behaviour — tag selection, verified-name swapping — rather
// than the network.
const getUserMe = vi.fn(async (): Promise<UserMeResponse | false> => false);
const invalidateUserMe = vi.fn();
vi.mock("../src/client/Api", () => ({
  getUserMe: () => getUserMe(),
  invalidateUserMe: () => invalidateUserMe(),
}));
const checkClanTagOwnership = vi.fn(
  async (
    tag: string,
  ): Promise<{ tag: string | null; error: string | null }> => ({
    tag,
    error: null,
  }),
);
vi.mock("../src/client/ClanApi", () => ({
  checkClanTagOwnership: (tag: string) => checkClanTagOwnership(tag),
}));
vi.mock("../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUsername: async () => null,
    addAuthListener: () => {},
  },
}));
vi.mock("../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false, getUser: async () => null },
}));
const { showInGameAlert } = vi.hoisted(() => ({
  showInGameAlert: vi.fn(async (_message: string) => Promise.resolve(true)),
}));
vi.mock("../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => false),
  showInGameAlert: (message: string) => showInGameAlert(message),
}));
// Partial: only translateText is stubbed (echoing keys so assertions read as
// i18n keys). The rest of Utils stays real, so an unrelated import added to
// this graph later doesn't fail on a missing export.
vi.mock("../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/Utils")>()),
  // Interpolations are echoed after the key so assertions can read both.
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

// Side-effect import registers <username-input>; vi.mock is hoisted above it.
import "../src/client/UsernameInput";
import type { UsernameInput as UsernameInputEl } from "../src/client/UsernameInput";

function premiumUser(
  clans: { tag: string; name: string }[] = [],
): UserMeResponse {
  return {
    player: {
      username: "RyanTheGreat",
      usernameBase: "RyanTheGreat",
      usernameStatus: "premium",
      clans: clans.map((c) => ({
        ...c,
        role: "member" as const,
        joinedAt: "2024-01-01T00:00:00.000Z",
        memberCount: 3,
      })),
    },
  } as unknown as UserMeResponse;
}

async function mount(): Promise<UsernameInputEl> {
  const el = document.createElement("username-input") as UsernameInputEl;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function signIn(el: UsernameInputEl, user: UserMeResponse) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail: user }));
  await el.updateComplete;
}

const q = <T extends HTMLElement>(el: UsernameInputEl, sel: string) =>
  el.querySelector<T>(sel);

const TOGGLE = 'button[aria-pressed="false"]';
const CHANGE = 'button[aria-label="username.verified_use_custom"]';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  getUserMe.mockReset();
  getUserMe.mockResolvedValue(false);
  invalidateUserMe.mockReset();
  checkClanTagOwnership.mockReset();
  checkClanTagOwnership.mockImplementation(async (tag: string) => ({
    tag,
    error: null,
  }));
  showInGameAlert.mockClear();
});

// Lets a handler's `await getUserMe()` continuation run before asserting.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("UsernameInput clan tag picker", () => {
  it("shows the tag placeholder and no menu until opened", async () => {
    const el = await mount();
    expect(q(el, "#clan-tag-button")?.textContent).toContain("username.tag");
    expect(q(el, "#clan-tag-menu")).toBeNull();
  });

  it("lists the player's clans and selects one without typing", async () => {
    const el = await mount();
    await signIn(
      el,
      premiumUser([
        { tag: "OF", name: "OpenFront Official" },
        { tag: "WOLF", name: "Wolfpack" },
      ]),
    );

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;

    const rows = el.querySelectorAll("#clan-tag-menu .max-h-56 button");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("OpenFront Official");

    (rows[1] as HTMLElement).click();
    await el.updateComplete;

    expect(el.getClanTag()).toBe("WOLF");
    expect(localStorage.getItem("clanTag")).toBe("WOLF");
    // Picking closes the menu.
    expect(q(el, "#clan-tag-menu")).toBeNull();
  });

  it("clears the tag from the menu", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    (
      el.querySelector("#clan-tag-menu .max-h-56 button") as HTMLElement
    ).click();
    await el.updateComplete;
    expect(el.getClanTag()).toBe("OF");

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    const clear = [...el.querySelectorAll("#clan-tag-menu button")].find((b) =>
      b.textContent?.includes("username.clan_clear"),
    ) as HTMLElement;
    clear.click();
    await el.updateComplete;

    expect(el.getClanTag()).toBeNull();
  });

  it("keeps the typed tag in the free-text field when it matches an own clan", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;

    // Typed a character at a time: the bug needed the bound value to *change*
    // between renders, so "O" (not a clan, binds "O") then "OF" (a clan, used
    // to bind "") is what made Lit write the field back to empty. Setting the
    // final value in one go leaves the binding at "" throughout and passes
    // either way.
    const type = async (value: string) => {
      const input = q<HTMLInputElement>(el, "#clan-tag-manual")!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await el.updateComplete;
    };
    await type("O");
    expect(q<HTMLInputElement>(el, "#clan-tag-manual")!.value).toBe("O");
    await type("OF");

    expect(q<HTMLInputElement>(el, "#clan-tag-manual")!.value).toBe("OF");
    expect(el.getClanTag()).toBe("OF");
  });

  it("closes the menu on Escape and on an outside pointerdown", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    q(el, "#clan-tag-menu")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await el.updateComplete;
    expect(q(el, "#clan-tag-menu")).toBeNull();

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(q(el, "#clan-tag-menu")).toBeNull();
  });

  it("picks up a clan joined in the clan modal", async () => {
    const el = await mount();
    await signIn(el, premiumUser());
    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    expect(el.textContent).toContain("username.clan_none_joined");

    // The clan modal invalidates the /users/@me cache and announces the join;
    // no fresh userMeResponse is dispatched, so the component must refetch.
    getUserMe.mockResolvedValue(
      premiumUser([{ tag: "NEW", name: "Newcomers" }]),
    );
    document.dispatchEvent(
      new CustomEvent("clan-joined", {
        detail: { tag: "NEW" },
        bubbles: true,
        composed: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.textContent).toContain("Newcomers");
  });

  it("drops the selected tag when that clan is left", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));
    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    (
      el.querySelector("#clan-tag-menu .max-h-56 button") as HTMLElement
    ).click();
    await el.updateComplete;
    expect(el.getClanTag()).toBe("OF");

    getUserMe.mockResolvedValue(premiumUser());
    document.dispatchEvent(
      new CustomEvent("clan-left", {
        detail: { tag: "OF" },
        bubbles: true,
        composed: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.getClanTag()).toBeNull();
  });

  it("drops the selected tag when that clan is disbanded", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));
    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    (
      el.querySelector("#clan-tag-menu .max-h-56 button") as HTMLElement
    ).click();
    await el.updateComplete;
    expect(el.getClanTag()).toBe("OF");

    // A leader dissolving their own clan emits clan-disbanded, not clan-left.
    getUserMe.mockResolvedValue(premiumUser());
    document.dispatchEvent(
      new CustomEvent("clan-disbanded", {
        detail: { tag: "OF" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle();
    await el.updateComplete;

    expect(el.getClanTag()).toBeNull();
  });

  it("re-enables play after joining the clan whose tag was rejected", async () => {
    const el = await mount();
    await signIn(el, premiumUser());

    // Typing a real clan the player isn't in blocks play and drops the tag.
    checkClanTagOwnership.mockResolvedValue({
      tag: null,
      error: "username.tag_not_member",
    });
    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    const manual = q<HTMLInputElement>(el, "#clan-tag-manual")!;
    manual.value = "OF";
    manual.dispatchEvent(new Event("input"));
    await settle();
    await el.updateComplete;
    expect(el.canPlay()).toBe(false);
    await expect(el.getClanCheck()).resolves.toBeNull();

    // The error links into the clan modal, so joining is the usual way out of
    // it — the check has to be re-run against the new membership.
    getUserMe.mockResolvedValue(
      premiumUser([{ tag: "OF", name: "OpenFront Official" }]),
    );
    checkClanTagOwnership.mockImplementation(async (tag: string) => ({
      tag,
      error: null,
    }));
    document.dispatchEvent(
      new CustomEvent("clan-joined", {
        detail: { tag: "OF" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle();
    await settle();
    await el.updateComplete;

    expect(el.canPlay()).toBe(true);
    await expect(el.getClanCheck()).resolves.toBe("OF");
  });

  it("keeps the account snapshot when a refresh fails", async () => {
    localStorage.setItem("useVerifiedName", "true");
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));
    expect(el.isVerified()).toBe(true);

    // A network error or non-200 also resolves to false — and is cached, so
    // treating it as a sign-out would strand the player for the session.
    getUserMe.mockResolvedValue(false);
    document.dispatchEvent(
      new CustomEvent("clan-joined", {
        detail: { tag: "OF" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle();
    await el.updateComplete;

    expect(el.isVerified()).toBe(true);
    expect(el.getUsername()).toBe("RyanTheGreat");
    q(el, "#clan-tag-button")!.click();
    await settle();
    await el.updateComplete;
    expect(el.textContent).toContain("OpenFront Official");
  });

  it("leaves the selected tag playable when the refresh fails", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));
    q(el, "#clan-tag-button")!.click();
    await settle();
    await el.updateComplete;
    (
      el.querySelector("#clan-tag-menu .max-h-56 button") as HTMLElement
    ).click();
    await settle();
    await el.updateComplete;
    expect(el.canPlay()).toBe(true);

    // Past the legitimate check that selecting the clan just ran.
    checkClanTagOwnership.mockClear();
    // The ownership check reads getUserMe itself, so against a cached false it
    // would take the player for a member of nothing and reject their own clan.
    getUserMe.mockResolvedValue(false);
    checkClanTagOwnership.mockResolvedValue({
      tag: null,
      error: "username.tag_not_member",
    });
    q(el, "#clan-tag-button")!.click();
    await settle();
    await settle();
    await el.updateComplete;

    expect(checkClanTagOwnership).not.toHaveBeenCalledWith("OF");
    expect(el.canPlay()).toBe(true);
    expect(el.getClanTag()).toBe("OF");
  });

  it("selects a listed clan without asking the API", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));
    q(el, "#clan-tag-button")!.click();
    await settle();
    await el.updateComplete;

    // The profile refresh fails while the picker is open, so getUserMe now
    // caches false — but the rows on screen came from the retained snapshot,
    // and picking one has to honour it. Asking the API would reject the
    // player's own clan.
    getUserMe.mockResolvedValue(false);
    checkClanTagOwnership.mockResolvedValue({
      tag: null,
      error: "username.tag_not_member",
    });
    (
      el.querySelector("#clan-tag-menu .max-h-56 button") as HTMLElement
    ).click();
    await settle();
    await el.updateComplete;

    expect(checkClanTagOwnership).not.toHaveBeenCalled();
    expect(el.canPlay()).toBe(true);
    expect(el.getClanTag()).toBe("OF");
    await expect(el.getClanCheck()).resolves.toBe("OF");
  });

  it("ignores an overlapping refresh that settles late", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OLD", name: "Old Clan" }]));

    // The picker's uncached refresh is slow; a clan join lands while it is
    // still in flight. The stale response must not reinstate the old list.
    let releaseSlow: (v: UserMeResponse) => void = () => {};
    getUserMe.mockReturnValueOnce(
      new Promise<UserMeResponse>((r) => (releaseSlow = r)),
    );
    q(el, "#clan-tag-button")!.click();
    await settle();

    getUserMe.mockResolvedValue(
      premiumUser([{ tag: "NEW", name: "Newcomers" }]),
    );
    document.dispatchEvent(
      new CustomEvent("clan-joined", {
        detail: { tag: "NEW" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle();
    await el.updateComplete;
    expect(el.textContent).toContain("Newcomers");

    releaseSlow(premiumUser([{ tag: "OLD", name: "Old Clan" }]));
    await settle();
    await el.updateComplete;

    expect(el.textContent).toContain("Newcomers");
    expect(el.textContent).not.toContain("Old Clan");
  });

  it("still clears account state on an explicit sign-out", async () => {
    localStorage.setItem("useVerifiedName", "true");
    localStorage.setItem("username", "MyCoolName");
    const el = await mount();
    await signIn(el, premiumUser());
    expect(el.isVerified()).toBe(true);

    // Distinct from a failed refresh: this one is authoritative.
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: false }),
    );
    await el.updateComplete;

    expect(el.isVerified()).toBe(false);
    expect(el.getUsername()).toBe("MyCoolName");
  });

  it("bypasses the cached profile when the picker is opened", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));

    // Being kicked, or having a join request approved, changes membership
    // server-side without invalidating this tab's cache.
    getUserMe.mockResolvedValue(
      premiumUser([{ tag: "NEW", name: "Newcomers" }]),
    );
    q(el, "#clan-tag-button")!.click();
    await settle();
    await el.updateComplete;

    expect(invalidateUserMe).toHaveBeenCalled();
    expect(el.textContent).toContain("Newcomers");
    expect(el.textContent).not.toContain("OpenFront Official");
  });

  it("leaves an unrelated clan's tag alone", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));
    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    (
      el.querySelector("#clan-tag-menu .max-h-56 button") as HTMLElement
    ).click();
    await el.updateComplete;

    document.dispatchEvent(
      new CustomEvent("clan-left", {
        detail: { tag: "WOLF" },
        bubbles: true,
        composed: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.getClanTag()).toBe("OF");
  });

  it("opens the clan modal on its browse tab from Browse clans", async () => {
    // Registered, not just created: the component waits on whenDefined, the
    // same way the existing join-modal path does.
    const opened: unknown[] = [];
    if (!customElements.get("clan-modal")) {
      customElements.define(
        "clan-modal",
        class extends HTMLElement {
          open(args: unknown) {
            opened.push(args);
          }
        },
      );
    }
    const modal = document.createElement("clan-modal") as HTMLElement & {
      open: (args: unknown) => void;
    };
    // The registered class pushes to whichever `opened` array the current run
    // closed over, so re-point it for this instance.
    modal.open = (args) => opened.push(args);
    document.body.appendChild(modal);
    const pages: string[] = [];
    (window as unknown as { showPage?: (p: string) => void }).showPage = (p) =>
      pages.push(p);

    const el = await mount();
    await signIn(el, premiumUser());
    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    const browse = [...el.querySelectorAll("#clan-tag-menu button")].find((b) =>
      b.textContent?.includes("username.clan_browse"),
    ) as HTMLElement;
    browse.click();
    await customElements.whenDefined("clan-modal").catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));

    expect(pages).toContain("page-clan");
    // Without the tab the modal lands on its default my-clans view, which is
    // not what the action is labelled.
    expect(opened).toEqual([{ tab: "browse" }]);
  });

  it("closes on Escape while the trigger still holds focus", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));

    // Opening leaves focus on the button, which is the menu's sibling — the
    // key never reaches a menu-level handler.
    const button = q(el, "#clan-tag-button")!;
    button.click();
    await el.updateComplete;
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await el.updateComplete;

    expect(q(el, "#clan-tag-menu")).toBeNull();
  });

  it("keeps the menu open for a pointerdown inside the component", async () => {
    const el = await mount();
    await signIn(el, premiumUser([{ tag: "OF", name: "OpenFront Official" }]));

    q(el, "#clan-tag-button")!.click();
    await el.updateComplete;
    q(el, "#clan-tag-manual")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(q(el, "#clan-tag-menu")).not.toBeNull();
  });
});

describe("UsernameInput name length", () => {
  it("trims a stored name that predates the cap instead of blocking play", async () => {
    const long = "a".repeat(MAX_USERNAME_LENGTH + 7);
    localStorage.setItem("username", long);

    const el = await mount();

    expect(el.getUsername()).toBe("a".repeat(MAX_USERNAME_LENGTH));
    expect(el.canPlay()).toBe(true);
  });

  it("caps what can be typed into the field", async () => {
    const el = await mount();
    expect(
      q<HTMLInputElement>(el, 'input[aria-label="username.enter_username"]')!
        .maxLength,
    ).toBe(MAX_USERNAME_LENGTH);
  });
});

describe("UsernameInput verified name", () => {
  // An eligible subscriber who has expressed no preference plays under the
  // name they paid for. The preference used to be read as `=== "true"`, which
  // collapsed "never asked" into "declined" — so every fresh profile, which is
  // every Steam install, silently opted out of the headline perk.
  it("plays verified by default when eligible and no preference is stored", async () => {
    const el = await mount();
    await signIn(el, premiumUser());

    expect(el.isVerified()).toBe(true);
    expect(el.getUsername()).toBe("RyanTheGreat");
    // Only the active trailing button exists, so neither can be tabbed to or
    // read out while it doesn't apply.
    expect(q(el, CHANGE)).not.toBeNull();
    expect(q(el, TOGGLE)).toBeNull();
  });

  // The regression this guards: before the default existed the toggle rendered
  // off and only a click wrote the preference, so an existing subscriber who
  // saw the toggle and left it alone has no key either. Defaulting them on
  // would change the name they play under, in public, with no action on their
  // part — which is the harm a privacy default is meant to avoid.
  it("stays off for an existing profile that never answered", async () => {
    // A stored username is the trace of a profile that has played here before.
    localStorage.setItem("username", "MyCoolName");
    const el = await mount();
    await signIn(el, premiumUser());

    expect(el.isVerified()).toBe(false);
    expect(el.getUsername()).toBe("MyCoolName");
    expect(q(el, TOGGLE)).not.toBeNull();
  });

  // The cohort has to be recorded, not recomputed: one boot later the new
  // profile has a stored username too, so re-deriving it would revoke the
  // default it had just granted.
  it("keeps the default across a remount, once the profile is known to be new", async () => {
    const first = await mount();
    await signIn(first, premiumUser());
    expect(first.isVerified()).toBe(true);
    // loadStoredUsername has now written a username, destroying the evidence.
    expect(localStorage.getItem("username")).not.toBeNull();

    document.body.innerHTML = "";
    const second = await mount();
    await signIn(second, premiumUser());

    expect(second.isVerified()).toBe(true);
  });

  it("decides the cohort once and does not revisit it", async () => {
    localStorage.setItem("username", "MyCoolName");
    await mount();
    expect(localStorage.getItem("verifiedNameDefaultAllowed")).toBe("false");

    // Even if the stored username is later cleared, the profile does not
    // become "new" again.
    localStorage.removeItem("username");
    document.body.innerHTML = "";
    const second = await mount();
    await signIn(second, premiumUser());

    expect(localStorage.getItem("verifiedNameDefaultAllowed")).toBe("false");
    expect(second.isVerified()).toBe(false);
  });

  // The default fills a gap; it never overrides an answer.
  it("stays off when the player has explicitly opted out", async () => {
    localStorage.setItem("useVerifiedName", "false");
    localStorage.setItem("username", "MyCoolName");
    const el = await mount();
    await signIn(el, premiumUser());

    expect(el.isVerified()).toBe(false);
    expect(el.getUsername()).toBe("MyCoolName");
    expect(q(el, TOGGLE)).not.toBeNull();
    expect(q(el, CHANGE)).toBeNull();
  });

  // Leaving the default unpersisted is what keeps a later opt-out
  // distinguishable from it.
  it("does not persist the default, and records an explicit opt-out", async () => {
    const el = await mount();
    await signIn(el, premiumUser());
    expect(localStorage.getItem("useVerifiedName")).toBeNull();

    q(el, CHANGE)!.click();
    await el.updateComplete;

    expect(localStorage.getItem("useVerifiedName")).toBe("false");
    expect(el.isVerified()).toBe(false);
  });

  it("renders the free-text field and an off-state toggle when ineligible", async () => {
    const el = await mount();
    await signIn(el, {
      player: { username: null, usernameBase: null, usernameStatus: "none" },
    } as unknown as UserMeResponse);

    expect(el.isVerified()).toBe(false);
    expect(q(el, TOGGLE)).not.toBeNull();
    expect(q(el, CHANGE)).toBeNull();
  });

  it("swaps the input for a labelled chip when playing verified", async () => {
    localStorage.setItem("useVerifiedName", "true");
    const el = await mount();
    await signIn(el, premiumUser());

    expect(el.isVerified()).toBe(true);
    expect(el.getUsername()).toBe("RyanTheGreat");
    // The name is no longer an editable field — it reads as an identity chip.
    expect(el.querySelector('input[type="text"]:not(#clan-tag-manual)')).toBe(
      null,
    );
    expect(el.textContent).toContain("RyanTheGreat");
    // The check mark alone carries the state; it is the labelled element.
    expect(
      el.querySelector('svg[aria-label="username.verified_player"]'),
    ).not.toBeNull();
    expect(q(el, CHANGE)).not.toBeNull();
    expect(q(el, TOGGLE)).toBeNull();
  });

  it("restores the stored custom name when switching back", async () => {
    // Starts opted out so the round trip begins on the free-form name; the
    // default-on case is covered above.
    localStorage.setItem("useVerifiedName", "false");
    localStorage.setItem("username", "MyCoolName");
    const el = await mount();
    await signIn(el, premiumUser());
    expect(el.getUsername()).toBe("MyCoolName");

    q(el, 'button[aria-pressed="false"]')!.click();
    await el.updateComplete;
    expect(el.isVerified()).toBe(true);
    expect(el.getUsername()).toBe("RyanTheGreat");

    q(el, 'button[aria-label="username.verified_use_custom"]')!.click();
    await el.updateComplete;
    expect(el.isVerified()).toBe(false);
    expect(el.getUsername()).toBe("MyCoolName");
  });

  it("stays on the free-text name when the account is not eligible", async () => {
    localStorage.setItem("useVerifiedName", "true");
    localStorage.setItem("username", "MyCoolName");
    const el = await mount();
    await signIn(el, {
      player: { username: null, usernameBase: null, usernameStatus: "none" },
    } as unknown as UserMeResponse);

    expect(el.isVerified()).toBe(false);
    expect(el.getUsername()).toBe("MyCoolName");
  });
});

describe("UsernameInput lapse notice", () => {
  const SOON = "2026-10-01T00:00:00.000Z";
  const GRACE = "#username-claim-grace";

  // Lapsed: no longer premium, so the name reverts — but the server still
  // reserves the bare claim until the deadline.
  function lapsedUser(overrides: Record<string, unknown> = {}): UserMeResponse {
    return {
      player: {
        username: "RyanTheGreat",
        usernameBase: "RyanTheGreat",
        usernameStatus: "claimed",
        usernameClaimExpiresAt: SOON,
        ...overrides,
      },
    } as unknown as UserMeResponse;
  }

  beforeEach(() => {
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The whole point: the toggle used to switch itself off and the name revert
  // with nothing said. This is the only channel a Steam-only account has.
  it("announces the lapse once, naming the name and the date", async () => {
    localStorage.setItem("useVerifiedName", "true");
    localStorage.setItem("username", "MyCoolName");
    const el = await mount();
    await signIn(el, lapsedUser());

    expect(el.isVerified()).toBe(false);
    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    const message = showInGameAlert.mock.calls[0][0];
    expect(message).toContain("username.lapse_notice");
    expect(message).toContain("RyanTheGreat");
  });

  it("does not announce it again on the next launch", async () => {
    localStorage.setItem("username", "MyCoolName");
    const first = await mount();
    await signIn(first, lapsedUser());
    expect(showInGameAlert).toHaveBeenCalledTimes(1);

    // A second launch on the same device: same reservation, nothing new.
    showInGameAlert.mockClear();
    document.body.innerHTML = "";
    const second = await mount();
    await signIn(second, lapsedUser());

    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  // Resubscribe clears the record, so a later lapse speaks up again. A bare
  // "already announced" flag would stay quiet for the life of the install.
  it("announces again after a resubscribe and a second lapse", async () => {
    const el = await mount();
    await signIn(el, lapsedUser());
    expect(showInGameAlert).toHaveBeenCalledTimes(1);

    showInGameAlert.mockClear();
    await signIn(el, premiumUser());
    await signIn(el, lapsedUser());

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
  });

  // Neither has a deadline attached and neither costs the player a name, so
  // neither is worth interrupting them for.
  it("stays silent for a sign-out or a TEMPORARY rename", async () => {
    localStorage.setItem("useVerifiedName", "true");
    const el = await mount();

    await signIn(el, premiumUser());
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: false }),
    );
    await el.updateComplete;
    expect(showInGameAlert).not.toHaveBeenCalled();

    await signIn(
      el,
      lapsedUser({
        username: "TEMPORARY7823",
        usernameBase: "TEMPORARY7823",
      }),
    );
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  // Silent when the server sends no deadline. infra#594 sets
  // usernameClaimExpiresAt, so this is not the common case any more — but a
  // lapse recorded before that shipped still has no date on it.
  it("stays silent while the server sends no deadline", async () => {
    const el = await mount();
    await signIn(el, lapsedUser({ usernameClaimExpiresAt: null }));

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(q(el, GRACE)).toBeNull();
  });

  it("keeps a standing line while the reservation lasts", async () => {
    const el = await mount();
    await signIn(el, lapsedUser());

    const line = q(el, GRACE);
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain("username.claim_reserved");
    expect(line!.textContent).toContain("RyanTheGreat");
  });

  // The player dismissed the one-time notice; the standing line is what they
  // still see every launch until they act or the name is gone.
  it("still shows the line on a later launch, after the notice is spent", async () => {
    const first = await mount();
    await signIn(first, lapsedUser());
    document.body.innerHTML = "";

    const second = await mount();
    await signIn(second, lapsedUser());

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(q(second, GRACE)).not.toBeNull();
  });

  // Inverted from "drops the line once the deadline has passed". That was
  // wrong: usernameClaimExpiresAt's schema comment says a past date means "at
  // risk", not "lost" — the field stays set until the name is actually taken,
  // and resubscribing still recovers it. Going silent switched the warning off
  // at the point of highest risk and lowest cost to act. The `claimed` guard in
  // verifiedClaimGrace is what ends the notice, because a name actually taken
  // moves the player out of that status.
  it("keeps warning past the deadline, in stronger terms", async () => {
    vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    const el = await mount();
    await signIn(el, lapsedUser());

    expect(q(el, GRACE)!.textContent).toContain("username.claim_at_risk");
    expect(showInGameAlert).toHaveBeenCalledTimes(1);
  });

  it("shows nothing while the subscription is still active", async () => {
    localStorage.setItem("useVerifiedName", "true");
    const el = await mount();
    await signIn(el, premiumUser());

    expect(el.isVerified()).toBe(true);
    expect(q(el, GRACE)).toBeNull();
    expect(showInGameAlert).not.toHaveBeenCalled();
  });
});

describe("UsernameInput claim grace, live behaviour", () => {
  const SOON = "2026-10-01T00:00:00.000Z";
  const GRACE = "#username-claim-grace";
  const ERROR = "#username-validation-error";

  function lapsedUser(overrides: Record<string, unknown> = {}): UserMeResponse {
    return {
      player: {
        username: "RyanTheGreat",
        usernameBase: "RyanTheGreat",
        usernameStatus: "claimed",
        usernameClaimExpiresAt: SOON,
        ...overrides,
      },
    } as unknown as UserMeResponse;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  // The grace value is only re-derived on account events, and a client sitting
  // on the main menu receives none. Without the timer the notice would keep
  // saying "reserved until {date}" after that date had passed.
  it("escalates the notice when the deadline passes while mounted", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T23:59:00.000Z") });
    const el = await mount();
    await signIn(el, lapsedUser());
    expect(q(el, GRACE)!.textContent).toContain("username.claim_reserved");

    await vi.advanceTimersByTimeAsync(61_000);
    await el.updateComplete;

    // Still shown, and now saying the name can be taken at any moment. Going
    // silent here would switch the warning off at the point of highest risk.
    const line = q(el, GRACE);
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain("username.claim_at_risk");

    // And the interruption actually fires. Asserting only on the banner missed
    // that the timer updated it silently: the one player the timer exists for
    // — sitting on the menu across their own deadline — got no alert at all.
    expect(showInGameAlert).toHaveBeenCalledTimes(2);
    expect(showInGameAlert.mock.calls[1][0]).toContain(
      "username.lapse_notice_at_risk",
    );
  });

  // Reconnecting after the deadline passed while detached. connectedCallback
  // short-circuits the getUserMe continuation when userMe is already set, so
  // this path never reaches applyVerifiedPreference: re-arming the timer alone
  // left the stale "reserved until {past date}" wording in place. Unreachable
  // in the app today — <play-page> is hidden by class toggling, not removed —
  // but the code claims to handle it, so something should hold that.
  it("escalates on reconnect when the deadline passed while detached", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const el = await mount();
    await signIn(el, lapsedUser());
    expect(q(el, GRACE)!.textContent).toContain("username.claim_reserved");
    showInGameAlert.mockClear();

    const parent = el.parentElement!;
    parent.removeChild(el);
    vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    parent.appendChild(el);
    await el.updateComplete;

    expect(q(el, GRACE)!.textContent).toContain("username.claim_at_risk");
    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(showInGameAlert.mock.calls[0][0]).toContain(
      "username.lapse_notice_at_risk",
    );
  });

  // usernameClaimExpiresAt's schema comment: "A past date means 'at risk', not
  // 'lost' — it stays set until the name is actually taken." The banner has to
  // follow that, not a clock.
  it("still warns after the deadline, while the name is takeable but not taken", async () => {
    vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    const el = await mount();
    await signIn(el, lapsedUser());

    expect(q(el, GRACE)!.textContent).toContain("username.claim_at_risk");
    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(showInGameAlert.mock.calls[0][0]).toContain(
      "username.lapse_notice_at_risk",
    );
  });

  // Crossing the deadline changes what the player has to do, so it earns one
  // more interruption — the marker is keyed on the phase, not just the name.
  it("announces again when a warned reservation lapses into at-risk", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const first = await mount();
    await signIn(first, lapsedUser());
    expect(showInGameAlert).toHaveBeenCalledTimes(1);

    showInGameAlert.mockClear();
    document.body.innerHTML = "";
    vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    const second = await mount();
    await signIn(second, lapsedUser());

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(showInGameAlert.mock.calls[0][0]).toContain(
      "username.lapse_notice_at_risk",
    );
  });

  // The error is transient and self-inflicted; the reservation is a 30-day
  // countdown the player cannot recover. Rendering them as alternatives put
  // the time-critical one last.
  it("keeps the reservation notice visible alongside a validation error", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const el = await mount();
    await signIn(el, lapsedUser());
    expect(q(el, GRACE)).not.toBeNull();

    el.validationError = "username.invalid_chars";
    await el.updateComplete;

    expect(q(el, ERROR)).not.toBeNull();
    expect(q(el, GRACE)).not.toBeNull();
  });
});
