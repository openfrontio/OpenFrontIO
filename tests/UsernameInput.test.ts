import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../src/core/ApiSchemas";
import { MAX_USERNAME_LENGTH } from "../src/core/validations/username";

// The identity bar pulls in the whole client bootstrap (auth, Steam,
// CrazyGames, the clan API). Stub the boundaries so the test exercises the
// component's own behaviour — tag selection, verified-name swapping — rather
// than the network.
const getUserMe = vi.fn(async (): Promise<UserMeResponse | false> => false);
vi.mock("../src/client/Api", () => ({ getUserMe: () => getUserMe() }));
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
vi.mock("../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => false),
}));
// Partial: only translateText is stubbed (echoing keys so assertions read as
// i18n keys). The rest of Utils stays real, so an unrelated import added to
// this graph later doesn't fail on a missing export.
vi.mock("../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/Utils")>()),
  translateText: (key: string) => key,
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
  checkClanTagOwnership.mockReset();
  checkClanTagOwnership.mockImplementation(async (tag: string) => ({
    tag,
    error: null,
  }));
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

    const manual = q<HTMLInputElement>(el, "#clan-tag-manual")!;
    manual.value = "OF";
    manual.dispatchEvent(new Event("input"));
    await el.updateComplete;

    // The field is seeded from a separate draft, so a tag that happens to
    // match one of the listed clans must not blank it mid-keystroke.
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
  it("renders the free-text field and an off-state toggle by default", async () => {
    const el = await mount();
    await signIn(el, premiumUser());

    expect(el.isVerified()).toBe(false);
    // Only the active trailing button exists, so neither can be tabbed to or
    // read out while it doesn't apply.
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
