import { beforeEach, describe, expect, it } from "vitest";
import "../../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../../src/client/components/LobbyPlayerView";
import { GameMode } from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import type { ClientInfo } from "../../../src/core/Schemas";

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

function markedPlayers(view: LobbyTeamView): string[] {
  return Array.from(view.querySelectorAll(".lobby-friend-badge")).map(
    (badge) => {
      const row = badge.closest(".player-tag, div");
      if (row === null) return "";

      const clone = row.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("svg").forEach((svg) => svg.remove());
      return clone.textContent?.trim() ?? "";
    },
  );
}

describe("lobby friend marker", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    document.body.replaceChildren();
  });

  it("marks the players on the viewer's friends list", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [
        client("me", { friends: ["pal"] }),
        client("pal"),
        client("stranger"),
      ],
    });

    expect(markedPlayers(view)).toEqual(["pal"]);
  });

  it("does not mark the viewer themselves", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [client("me", { friends: ["me", "pal"] }), client("pal")],
    });

    expect(markedPlayers(view)).toEqual(["pal"]);
  });

  it("marks friends in both team-mode lists", async () => {
    const view = await mount({
      gameMode: GameMode.Team,
      teamCount: 2,
      currentClientID: "me",
      clients: [client("me", { friends: ["pal"] }), client("pal")],
    });

    expect(view.querySelectorAll(".lobby-friend-badge").length).toBe(2);
    expect(markedPlayers(view)).toEqual(["pal", "pal"]);
  });

  it("never reads another client's friends list", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [
        client("me"),

        client("teammate", { friends: ["me", "stranger"] }),
        client("stranger"),
      ],
    });

    expect(markedPlayers(view)).toEqual([]);
  });

  it("withholds the marker when the viewer anonymizes names", async () => {
    new UserSettings().toggleRandomName();

    const view = await mount({
      currentClientID: "me",
      clients: [client("me", { friends: ["pal"] }), client("pal")],
    });

    expect(markedPlayers(view)).toEqual([]);
  });

  it("recomputes when the roster changes", async () => {
    const view = await mount({
      currentClientID: "me",
      clients: [client("me", { friends: ["pal"] }), client("pal")],
    });
    expect(markedPlayers(view)).toEqual(["pal"]);

    view.clients = [
      client("me", { friends: ["pal", "buddy"] }),
      client("pal"),
      client("buddy"),
    ];
    await view.updateComplete;

    expect(markedPlayers(view)).toEqual(["pal", "buddy"]);
  });
});
