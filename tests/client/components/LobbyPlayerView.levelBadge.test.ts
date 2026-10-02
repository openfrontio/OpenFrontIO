import { beforeEach, describe, expect, it } from "vitest";
import "../../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../../src/client/components/LobbyPlayerView";
import { GameMode, HumansVsNations } from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import type { ClientInfo, LevelBadge } from "../../../src/core/Schemas";

const BADGE: LevelBadge = { level: 42, prestige: 2, legend: false };

function client(
  clientID: string,
  overrides: Partial<ClientInfo> = {},
): ClientInfo {
  return {
    clientID,
    username: clientID,
    clanTag: null,
    ...overrides,
  };
}

async function mount(
  props: Partial<LobbyTeamView> & { clients: ClientInfo[] },
): Promise<LobbyTeamView> {
  const view = document.createElement("lobby-player-view") as LobbyTeamView;
  view.gameMode = GameMode.FFA;
  Object.assign(view, props);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

// The visible pieces of one name container, in DOM order: "badge:<size>"
// for a level badge, "slot" for the empty alignment slot, and the trimmed
// text of each non-empty text node. Icons (verified check, friend mark) and
// the host label sit after the name and aren't needed here.
function tokens(container: Element): string[] {
  const out: string[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node instanceof Element && node.tagName === "LEVEL-BADGE") {
      out.push(`badge:${node.getAttribute("size")}`);
    } else if (
      node instanceof Element &&
      node.classList.contains("lobby-level-slot")
    ) {
      out.push("slot");
    } else if (node instanceof Element && node.matches("span.truncate")) {
      out.push(node.textContent?.trim() ?? "");
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) out.push(text);
    }
  }
  return out;
}

const pills = (view: LobbyTeamView) =>
  Array.from(view.querySelectorAll(".player-tag > span.text-white")).map(
    tokens,
  );
// Team mode: the "Players" column on the left.
const playerRows = (view: LobbyTeamView) =>
  Array.from(view.querySelectorAll("div.break-words")).map(tokens);
// Team mode: the rows inside each team card, grouped per card.
const cardRows = (view: LobbyTeamView) =>
  Array.from(view.querySelectorAll("div.rounded-xl"))
    .map((card) =>
      Array.from(card.querySelectorAll("span.flex.items-center.min-w-0")).map(
        tokens,
      ),
    )
    .filter((rows) => rows.length > 0);

describe("lobby level badges", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    document.body.replaceChildren();
  });

  it("puts a 24px badge in front of the name in FFA pills", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [client("me", { levelBadge: BADGE }), client("guest")],
    });

    // No alignment slot in the wrapped pills.
    expect(pills(view)).toEqual([["badge:24", "me"], ["guest"]]);
  });

  it("passes the badge's level, prestige and legend through", async () => {
    const view = await mount({
      clients: [
        client("vet", { levelBadge: { level: 7, prestige: 3, legend: true } }),
      ],
    });

    const badge = view.querySelector("level-badge") as HTMLElement & {
      level: number;
      prestige: number;
      legend: boolean;
    };
    expect(badge.level).toBe(7);
    expect(badge.prestige).toBe(3);
    expect(badge.legend).toBe(true);
  });

  it("puts the badge in front of the name in spectator pills", async () => {
    const view = await mount({
      clients: [
        client("player"),
        client("watcher", { spectator: true, levelBadge: BADGE }),
        client("lurker", { spectator: true }),
      ],
    });

    expect(pills(view)).toEqual([
      ["player"],
      ["badge:24", "watcher"],
      ["lurker"],
    ]);
  });

  it("aligns names in the team-mode lists when someone has a badge", async () => {
    const view = await mount({
      gameMode: GameMode.Team,
      teamCount: HumansVsNations,
      clients: [client("vet", { levelBadge: BADGE }), client("guest")],
    });

    expect(playerRows(view)).toEqual([
      ["badge:24", "vet"],
      ["slot", "guest"],
    ]);
    expect(cardRows(view)).toEqual([
      [
        ["badge:24", "vet"],
        ["slot", "guest"],
      ],
    ]);
    const slot = view.querySelector(".lobby-level-slot");
    expect(slot?.getAttribute("aria-hidden")).toBe("true");
    expect(slot?.classList.contains("w-6")).toBe(true);
  });

  it("adds no slots when nobody in the list has a badge", async () => {
    const view = await mount({
      gameMode: GameMode.Team,
      teamCount: HumansVsNations,
      clients: [client("a"), client("b")],
    });

    expect(playerRows(view)).toEqual([["a"], ["b"]]);
    expect(cardRows(view)).toEqual([[["a"], ["b"]]]);
    expect(view.querySelector(".lobby-level-slot")).toBeNull();
    expect(view.querySelector("level-badge")).toBeNull();
  });

  it("decides the slot per team card", async () => {
    const view = await mount({
      gameMode: GameMode.Team,
      teamCount: 2,
      clients: [
        client("vet", { levelBadge: BADGE }),
        client("a"),
        client("b"),
        client("c"),
      ],
    });

    const cards = cardRows(view);
    expect(cards.length).toBe(2);
    for (const rows of cards) {
      const hasBadge = rows.some((r) => r[0] === "badge:24");
      for (const row of rows) {
        if (row[0] === "badge:24") continue;
        // A badge-less row gets a slot exactly when its card has a badge.
        expect(row[0] === "slot").toBe(hasBadge);
      }
    }
    expect(cards.flat().filter((r) => r[0] === "badge:24").length).toBe(1);
  });

  describe("with anonymous names on", () => {
    beforeEach(() => {
      new UserSettings().toggleRandomName();
    });

    it("hides other players' badges but keeps the viewer's own", async () => {
      const view = await mount({
        currentClientID: "me",
        clients: [
          client("me", { levelBadge: BADGE }),
          client("other", { levelBadge: BADGE }),
        ],
      });

      const rows = pills(view);
      expect(rows[0]).toEqual(["badge:24", "me"]);
      expect(rows[1][0]).not.toBe("badge:24");
      expect(view.querySelectorAll("level-badge").length).toBe(1);
    });

    it("counts hidden badges as none for the alignment slot", async () => {
      const view = await mount({
        gameMode: GameMode.Team,
        teamCount: HumansVsNations,
        currentClientID: "me",
        clients: [client("me"), client("other", { levelBadge: BADGE })],
      });

      expect(view.querySelector("level-badge")).toBeNull();
      expect(view.querySelector(".lobby-level-slot")).toBeNull();
    });
  });
});
