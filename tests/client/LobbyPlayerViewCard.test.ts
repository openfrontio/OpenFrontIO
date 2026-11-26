import { GameMode } from "@openfront/engine-api/game/GameTypes";
import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import type { ClientInfo } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/components/LobbyPlayerView";
import { resetCardBackdropLoadsForTests } from "../../src/client/components/card/StillCardBackdrop";
import type { LobbyTeamView } from "../../src/client/components/LobbyPlayerView";
import { UserSettings } from "../../src/client/UserSettings";
import { installFakeImage } from "../util/FakeImage";

// The lobby name tag shows a card owner's equipped background, still, under a
// dark gradient. The name comes from the server-stamped roster entry
// (ClientInfo.cardBackground); the image from the viewer's own catalogue.

const getUserMe = vi.hoisted(() =>
  vi.fn<() => Promise<UserMeResponse | false>>(async () => false),
);
vi.mock("../../src/client/Api", () => ({ getUserMe }));

const catalogue = vi.hoisted(() => ({
  cached: null as Cosmetics | null,
  fetched: null as Cosmetics | null,
  fetches: 0,
}));
vi.mock("../../src/client/Cosmetics", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Cosmetics")>()),
  getCachedCosmetics: () => catalogue.cached,
  fetchCosmetics: async () => {
    catalogue.fetches++;
    return catalogue.fetched;
  },
}));

const COSMETICS = {
  patterns: {},
  flags: {},
  cardBackgrounds: {
    bg_pacific: {
      name: "bg_pacific",
      url: "/cosmetics/bg_pacific.webp",
      rarity: "epic",
      product: null,
    },
  },
} as unknown as Cosmetics;

const client = (id: string, extra: Partial<ClientInfo> = {}): ClientInfo => ({
  clientID: id,
  username: id,
  clanTag: null,
  ...extra,
});

async function mount(
  clients: ClientInfo[],
  props: Partial<LobbyTeamView> = {},
) {
  const view = document.createElement("lobby-player-view") as LobbyTeamView;
  view.gameMode = GameMode.FFA;
  Object.assign(view, { clients, ...props });
  document.body.append(view);
  await view.updateComplete;
  // The catalogue fetch settles, then the re-render.
  await new Promise((r) => setTimeout(r, 0));
  await view.updateComplete;
  return view;
}

const tagOf = (view: LobbyTeamView, name: string) =>
  Array.from(view.querySelectorAll<HTMLElement>(".player-tag")).find((t) =>
    t.textContent?.includes(name),
  )!;

// The tag as markup, minus its inline style and Lit's comment markers: what
// must not change.
const shape = (tag: HTMLElement) => {
  const copy = tag.cloneNode(true) as HTMLElement;
  copy.removeAttribute("style");
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) (comment as ChildNode).remove();
  return copy.outerHTML;
};

describe("lobby name tag: card background", () => {
  beforeEach(() => {
    catalogue.cached = COSMETICS;
    catalogue.fetched = COSMETICS;
    catalogue.fetches = 0;
    resetCardBackdropLoadsForTests();
    installFakeImage((src) => src.includes("broken"));
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(false);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("an image that fails to load leaves today's tag exactly", async () => {
    catalogue.cached = {
      ...COSMETICS,
      cardBackgrounds: {
        bg_broken: {
          name: "bg_broken",
          url: "/cosmetics/broken.webp",
          rarity: "epic",
          product: null,
        },
      },
    } as unknown as Cosmetics;
    const view = await mount([
      client("carded", { cardBackground: "bg_broken" }),
    ]);
    expect(tagOf(view, "carded").hasAttribute("style")).toBe(false);
  });

  it("shows nothing until the image has loaded", async () => {
    const view = document.createElement("lobby-player-view") as LobbyTeamView;
    view.gameMode = GameMode.FFA;
    view.clients = [client("carded", { cardBackground: "bg_pacific" })];
    document.body.append(view);
    await view.updateComplete;
    expect(tagOf(view, "carded").hasAttribute("style")).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    await view.updateComplete;
    expect(tagOf(view, "carded").getAttribute("style")).toContain(
      "bg_pacific.webp",
    );
  });

  it("a failed catalogue fetch is retried on a later roster update", async () => {
    catalogue.cached = null;
    catalogue.fetched = null;
    const view = await mount([
      client("carded", { cardBackground: "bg_pacific" }),
    ]);
    expect(catalogue.fetches).toBe(1);
    expect(tagOf(view, "carded").hasAttribute("style")).toBe(false);
    catalogue.fetched = COSMETICS;
    view.clients = [...view.clients, client("plain2")];
    await view.updateComplete;
    expect(catalogue.fetches).toBe(1);
    // Not straight away: CATALOGUE_RETRY_MS after the failure.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    view.clients = [...view.clients, client("plain")];
    await view.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await view.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await view.updateComplete;
    expect(catalogue.fetches).toBe(2);
    expect(tagOf(view, "carded").getAttribute("style")).toContain(
      "bg_pacific.webp",
    );
  });

  it("the current player's carded tag keeps a blue tint over the art", async () => {
    const view = await mount(
      [
        client("me", { cardBackground: "bg_pacific" }),
        client("other", { cardBackground: "bg_pacific" }),
      ],
      { currentClientID: "me" },
    );
    const mine = tagOf(view, "me");
    expect(mine.classList.contains("current-player")).toBe(true);
    expect(mine.getAttribute("style")).toContain("rgba(14,165,233,");
    expect(tagOf(view, "other").getAttribute("style")).not.toContain(
      "rgba(14,165,233,",
    );
  });

  it("shows the background image under a dark gradient", async () => {
    const view = await mount([
      client("carded", { cardBackground: "bg_pacific" }),
      client("plain"),
    ]);
    const style = tagOf(view, "carded").getAttribute("style") ?? "";
    expect(style).toContain("bg_pacific.webp");
    expect(style).toContain("linear-gradient(");
    expect(style).toMatch(/background-size:\s*cover/);
    expect(style).toMatch(/background-position:\s*center/);
    expect(tagOf(view, "plain").hasAttribute("style")).toBe(false);
  });

  it("keeps the tag's classes, text and host controls", async () => {
    const props = {
      lobbyCreatorClientID: "host",
      currentClientID: "host",
      onKickPlayer: () => {},
    };
    const carded = await mount(
      [client("host"), client("guest", { cardBackground: "bg_pacific" })],
      props,
    );
    const withBg = shape(tagOf(carded, "guest"));
    expect(
      tagOf(carded, "guest").querySelector(".remove-player-btn"),
    ).not.toBeNull();
    document.body.innerHTML = "";
    const plain = await mount([client("host"), client("guest")], props);
    expect(withBg).toBe(shape(tagOf(plain, "guest")));
  });

  it("an unknown background name leaves today's tag exactly", async () => {
    const view = await mount([client("carded", { cardBackground: "bg_gone" })]);
    expect(tagOf(view, "carded").hasAttribute("style")).toBe(false);
  });

  it("catalogue not loaded: today's tag exactly", async () => {
    catalogue.cached = null;
    catalogue.fetched = null;
    const view = await mount([
      client("carded", { cardBackground: "bg_pacific" }),
    ]);
    expect(tagOf(view, "carded").hasAttribute("style")).toBe(false);
  });

  it("fetches the catalogue when it isn't cached yet", async () => {
    catalogue.cached = null;
    const view = await mount([
      client("carded", { cardBackground: "bg_pacific" }),
    ]);
    expect(tagOf(view, "carded").getAttribute("style")).toContain(
      "bg_pacific.webp",
    );
  });

  it("withheld while the viewer anonymises names, except their own", async () => {
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(true);
    const view = await mount(
      [
        client("other", { cardBackground: "bg_pacific" }),
        client("me", { cardBackground: "bg_pacific" }),
      ],
      { currentClientID: "me" },
    );
    const tags = Array.from(view.querySelectorAll<HTMLElement>(".player-tag"));
    expect(tags.filter((t) => t.hasAttribute("style"))).toHaveLength(1);
    expect(tagOf(view, "me").getAttribute("style")).toContain("bg_pacific");
  });

  it("spectator tags show it too", async () => {
    const view = await mount([
      client("player"),
      client("caster", { cardBackground: "bg_pacific", spectator: true }),
    ]);
    expect(tagOf(view, "caster").getAttribute("style")).toContain(
      "bg_pacific.webp",
    );
  });
});

describe("team-mode lobby rows: card background", () => {
  beforeEach(() => {
    catalogue.cached = COSMETICS;
    catalogue.fetched = COSMETICS;
    catalogue.fetches = 0;
    resetCardBackdropLoadsForTests();
    installFakeImage((src) => src.includes("broken"));
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(false);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const team = { gameMode: GameMode.Team, teamCount: 2 } as const;

  // A name's rows: one in the players list, one in its team card.
  const rowsOf = (view: LobbyTeamView, name: string) =>
    Array.from(view.querySelectorAll<HTMLElement>("div.rounded-sm")).filter(
      (r) => r.textContent?.includes(name),
    );

  it("shows the background on both of a carded player's rows", async () => {
    const view = await mount(
      [client("carded", { cardBackground: "bg_pacific" }), client("plain")],
      team,
    );
    const carded = rowsOf(view, "carded");
    expect(carded).toHaveLength(2);
    for (const row of carded) {
      const style = row.getAttribute("style") ?? "";
      expect(style).toContain("bg_pacific.webp");
      expect(style).toContain("linear-gradient(");
      expect(style).toMatch(/background-size:\s*cover/);
    }
    const plain = rowsOf(view, "plain");
    expect(plain).toHaveLength(2);
    for (const row of plain) expect(row.hasAttribute("style")).toBe(false);
  });

  it("keeps the rows' classes, text and host controls", async () => {
    const props = {
      ...team,
      lobbyCreatorClientID: "host",
      currentClientID: "host",
      onKickPlayer: () => {},
    };
    const carded = await mount(
      [client("host"), client("guest", { cardBackground: "bg_pacific" })],
      props,
    );
    const withBg = rowsOf(carded, "guest").map(shape);
    expect(
      rowsOf(carded, "guest").some((r) =>
        r.querySelector(".remove-player-btn"),
      ),
    ).toBe(true);
    document.body.innerHTML = "";
    const plain = await mount([client("host"), client("guest")], props);
    expect(withBg).toEqual(rowsOf(plain, "guest").map(shape));
  });

  it("an image that fails to load leaves today's rows exactly", async () => {
    catalogue.cached = {
      ...COSMETICS,
      cardBackgrounds: {
        bg_broken: {
          name: "bg_broken",
          url: "/cosmetics/broken.webp",
          rarity: "epic",
          product: null,
        },
      },
    } as unknown as Cosmetics;
    const view = await mount(
      [client("carded", { cardBackground: "bg_broken" }), client("plain")],
      team,
    );
    for (const row of rowsOf(view, "carded")) {
      expect(row.hasAttribute("style")).toBe(false);
    }
  });

  it("the current player's rows keep a blue tint over the art", async () => {
    const view = await mount(
      [
        client("me", { cardBackground: "bg_pacific" }),
        client("other", { cardBackground: "bg_pacific" }),
      ],
      { ...team, currentClientID: "me" },
    );
    for (const row of rowsOf(view, "me")) {
      expect(row.className).toContain("bg-malibu-blue/20");
      expect(row.getAttribute("style")).toContain("rgba(14,165,233,");
    }
    for (const row of rowsOf(view, "other")) {
      expect(row.getAttribute("style")).not.toContain("rgba(14,165,233,");
    }
  });

  it("withheld while the viewer anonymises names, except their own", async () => {
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(true);
    const view = await mount(
      [
        client("other", { cardBackground: "bg_pacific" }),
        client("me", { cardBackground: "bg_pacific" }),
      ],
      { ...team, currentClientID: "me" },
    );
    const styled = Array.from(
      view.querySelectorAll<HTMLElement>("div.rounded-sm"),
    ).filter((r) => r.hasAttribute("style"));
    expect(styled).toHaveLength(2);
    for (const row of rowsOf(view, "me")) {
      expect(row.getAttribute("style")).toContain("bg_pacific");
    }
  });

  it("not stamped (anonymised by the server): today's rows", async () => {
    const view = await mount([client("carded"), client("plain")], team);
    const styled = Array.from(
      view.querySelectorAll<HTMLElement>("div.rounded-sm"),
    ).filter((r) => r.hasAttribute("style"));
    expect(styled).toHaveLength(0);
  });
});
