// @vitest-environment jsdom
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { EventBus } from "@openfront/shared/EventBus";
import { colord } from "colord";
import { goldRateTracker } from "../src/client/hud/layers/lib/GoldRateTracker";
import {
  type ColumnId,
  columnById,
  columnsFor,
} from "../src/client/hud/layers/lib/StatsColumns";
import { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import {
  aggregateTeamValues,
  TeamStats,
} from "../src/client/hud/layers/TeamStats";
import { GoToPlayerEvent } from "../src/client/TransformHandler";
import { UserSettings } from "../src/client/UserSettings";
import type { GameView, PlayerView } from "../src/client/view";

function player(
  id: string,
  tiles: number,
  clanTag: string | null = null,
): PlayerView {
  return {
    id: () => id,
    smallID: () => 0,
    name: () => id,
    displayName: () => (clanTag === null ? id : `[${clanTag}] ${id}`),
    clanTag: () => clanTag,
    numTilesOwned: () => tiles,
    gold: () => BigInt(tiles),
    tradeGold: () => 0,
    trainGold: () => 0,
    piracyGold: () => 0,
    goldEarned: () => 0,
    troops: () => tiles,
    totalUnitLevels: () => tiles,
    isAlive: () => true,
    isOnSameTeam: () => false,
    territoryColor: () => colord("#4a90d9"),
    incomingAttacks: () => [],
    isTraitor: () => false,
    isAlliedWith: () => false,
    hasEmbargoAgainst: () => false,
    isDisconnected: () => false,
  } as unknown as PlayerView;
}

describe("PlayerStats", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("locks rank and name while stat columns share the spare width", async () => {
    const me = player("me", 3);
    const game = {
      myPlayer: () => me,
      playerViews: () => [me],
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const content = playerStats.querySelector(".stats-table-content");
    expect(content?.classList).toContain("min-w-full");
    // Only selected stat tracks share definite spare space. Rank and name
    // never stretch; the empty last track only grows to a scrollbar.
    expect(content?.getAttribute("style")).toContain(
      "grid-template-columns: 30px calc(var(--stats-name, 100px) + var(--stats-chip, 0.75rem) - var(--stats-end-track, 0px)) auto auto auto minmax(0px, max-content);",
    );

    playerStats.remove();
  });

  it("keeps every player in the list, yours at its own rank", async () => {
    const players = [
      player("one", 70),
      player("two", 60),
      player("three", 50),
      player("four", 40),
      player("five", 30),
      player("six", 20),
      player("me", 10),
    ];
    const game = {
      myPlayer: () => players[6],
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const scrollable = playerStats.querySelector(".stats-table-scroll");
    const table = playerStats.querySelector(".stats-table");
    expect(playerStats.querySelectorAll(".stats-table-row")).toHaveLength(7);
    expect(playerStats.children).toHaveLength(1);
    expect(table?.querySelector("column-picker")).toBeNull();
    expect(table?.querySelector(".stats-table-header")).not.toBeNull();
    const goldHeader = playerStats.querySelectorAll(
      '.stats-table-header > [role="columnheader"]',
    )[3];
    expect(goldHeader.querySelector('of-icon[name="gold"]')).not.toBeNull();
    expect(goldHeader.querySelector("button")?.getAttribute("aria-label")).toBe(
      "leaderboard.gold",
    );
    expect(scrollable).not.toBeNull();
    const rows = [...(scrollable?.querySelectorAll(".stats-table-row") ?? [])];
    expect(rows.map((row) => row.textContent?.trim().split(/\s+/)[0])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(rows.map((row) => row.hasAttribute("data-me"))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(rows[6].textContent).toContain("me");
    expect(
      [...playerStats.querySelectorAll("button")].some((button) =>
        ["+", "-"].includes(button.textContent?.trim() ?? ""),
      ),
    ).toBe(false);

    playerStats.remove();
  });

  it("aligns each column as the registry says", async () => {
    new UserSettings().setStatsColumns("player", [
      "troops",
      "maxtroops",
      "cities",
    ]);
    const me = player("me", 3);
    const game = {
      myPlayer: () => me,
      playerViews: () => [me],
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const header = (id: ColumnId) =>
      playerStats.querySelector(
        `.stats-table-header > [role="columnheader"][data-column="${id}"]`,
      );
    const iconNames = (id: ColumnId) =>
      [...(header(id)?.querySelectorAll("of-icon") ?? [])]
        .map((icon) => icon.getAttribute("name"))
        .filter((name) => name !== "chevron-right");
    // Amounts end-aligned, unit counts centred, headers and cells alike,
    // except where a header has its own alignment.
    expect(header("troops")?.getAttribute("data-align")).toBe("end");
    expect(header("maxtroops")?.getAttribute("data-align")).toBe("center");
    expect(header("player")?.getAttribute("data-align")).toBe("center");
    expect(
      playerStats
        .querySelector(
          '.stats-table-row > [role="cell"][data-column="maxtroops"]',
        )
        ?.getAttribute("data-align"),
    ).toBe("end");
    expect(header("cities")?.getAttribute("data-align")).toBe("center");
    expect(
      playerStats
        .querySelector('.stats-table-row > [role="cell"][data-column="cities"]')
        ?.getAttribute("data-align"),
    ).toBe("center");
    expect(iconNames("troops")).toEqual(["troops"]);
    // Max troops header reads as a troop icon raised to the upper-limit icon.
    expect(iconNames("maxtroops")).toEqual(["troops", "max"]);

    playerStats.remove();
  });

  it("sizes every shared track from a hidden row of its widest texts", async () => {
    new UserSettings().setStatsColumns("player", ["playerType", "gold"]);
    const me = {
      ...player("me", 3),
      type: () => PlayerType.Human,
    } as unknown as PlayerView;
    const game = {
      myPlayer: () => me,
      playerViews: () => [me],
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const sizer = playerStats.querySelector("[data-sizer]");
    expect(sizer?.getAttribute("aria-hidden")).toBe("true");
    // rank | player | Type | gold: one cell each, texts one per line.
    const texts = [...(sizer?.children ?? [])].map((cell) =>
      [...cell.querySelectorAll("span")].map((span) => span.textContent),
    );
    expect(texts).toEqual([
      [],
      [],
      ["player_type.player", "player_type.nation", "player_type.bot"],
      // Gold passes 100M, which reads "100.0M".
      ["888.8M"],
    ]);
    // It is not a row of the table.
    expect(sizer?.closest('[role="row"], [role="rowgroup"]')).toBeNull();
    expect(sizer?.querySelector('[role="cell"]')).toBeNull();

    playerStats.remove();
  });
});

describe("PlayerStats default sort", () => {
  // Land, gold and type each put the three players in a different order.
  const players = [
    typed("alice", PlayerType.Human, 90, 10),
    typed("bob", PlayerType.Bot, 10, 50),
    typed("carol", PlayerType.Nation, 50, 90),
  ];

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  function typed(
    id: string,
    type: PlayerType,
    tiles: number,
    gold: number,
  ): PlayerView {
    return {
      ...player(id, tiles),
      type: () => type,
      gold: () => BigInt(gold),
    } as unknown as PlayerView;
  }

  async function mount(): Promise<PlayerStats> {
    const game = {
      myPlayer: () => null,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  async function showColumns(playerStats: PlayerStats, ids: ColumnId[]) {
    new UserSettings().setStatsColumns("player", ids);
    playerStats.refresh();
    await playerStats.updateComplete;
  }

  function sortButton(playerStats: PlayerStats, labelKey: string) {
    return playerStats.querySelector<HTMLButtonElement>(
      `.stats-table-header button[aria-label="${labelKey}"]`,
    );
  }

  function ariaSort(playerStats: PlayerStats, labelKey: string) {
    return sortButton(playerStats, labelKey)
      ?.closest('[role="columnheader"]')
      ?.getAttribute("aria-sort");
  }

  function names(playerStats: PlayerStats) {
    return [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ].map((row) =>
      row.querySelectorAll('[role="cell"]')[1].textContent?.trim(),
    );
  }

  it("opens sorted by land when the Type column is shown", async () => {
    new UserSettings().setStatsColumns("player", [
      "playerType",
      "tiles",
      "gold",
    ]);
    const playerStats = await mount();

    expect(ariaSort(playerStats, "leaderboard.owned")).toBe("descending");
    expect(ariaSort(playerStats, "leaderboard.playerType")).toBe("none");
    expect(names(playerStats)).toEqual(["alice", "carol", "bob"]);
  });

  it("falls back to land, then to a column other than Type, then to Type", async () => {
    new UserSettings().setStatsColumns("player", [
      "playerType",
      "tiles",
      "gold",
    ]);
    const playerStats = await mount();
    sortButton(playerStats, "leaderboard.gold")?.click();
    await playerStats.updateComplete;
    expect(names(playerStats)).toEqual(["carol", "bob", "alice"]);

    // The sorted column is hidden: back to land.
    await showColumns(playerStats, ["playerType", "tiles"]);
    expect(ariaSort(playerStats, "leaderboard.owned")).toBe("descending");
    expect(names(playerStats)).toEqual(["alice", "carol", "bob"]);

    // No land: the first sortable column that is not Type.
    await showColumns(playerStats, ["playerType", "gold"]);
    expect(ariaSort(playerStats, "leaderboard.gold")).toBe("descending");
    expect(ariaSort(playerStats, "leaderboard.playerType")).toBe("none");
    expect(names(playerStats)).toEqual(["carol", "bob", "alice"]);

    // Type alone is still sorted by Type.
    await showColumns(playerStats, ["playerType"]);
    expect(ariaSort(playerStats, "leaderboard.playerType")).toBe("descending");
    expect(names(playerStats)).toEqual(["bob", "carol", "alice"]);
  });
});

describe("PlayerStats rows", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(
    players: PlayerView[],
    me: PlayerView | null,
  ): Promise<PlayerStats> {
    const game = {
      myPlayer: () => me,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  function rows(playerStats: PlayerStats) {
    return [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ];
  }

  function cell(row: Element, id: ColumnId) {
    return row.querySelector(`[role="cell"][data-column="${id}"]`);
  }

  it("sorts by a header's column, descending first, then ascending", async () => {
    const playerStats = await mount(
      [
        { ...player("alice", 90), gold: () => 10n } as unknown as PlayerView,
        { ...player("bob", 10), gold: () => 50n } as unknown as PlayerView,
        { ...player("carol", 50), gold: () => 90n } as unknown as PlayerView,
      ],
      null,
    );
    const goldHeader = playerStats.querySelector(
      '[role="columnheader"][data-column="gold"]',
    );
    const names = () =>
      rows(playerStats).map((row) => cell(row, "player")?.textContent?.trim());

    goldHeader?.querySelector("button")?.click();
    await playerStats.updateComplete;
    expect(goldHeader?.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["carol", "bob", "alice"]);

    goldHeader?.querySelector("button")?.click();
    await playerStats.updateComplete;
    expect(goldHeader?.getAttribute("aria-sort")).toBe("ascending");
    expect(names()).toEqual(["alice", "bob", "carol"]);
  });

  it("keeps Space and Enter on a sort header from the game, and lets other keys through", async () => {
    const playerStats = await mount([player("alice", 3)], null);
    const button = playerStats.querySelector(
      '[role="columnheader"][data-column="gold"] button',
    ) as HTMLElement;
    const seen: string[] = [];
    const listener = (e: KeyboardEvent) => seen.push(`${e.type} ${e.code}`);
    window.addEventListener("keydown", listener);
    window.addEventListener("keyup", listener);

    for (const [key, code] of [
      [" ", "Space"],
      ["Enter", "Enter"],
      ["w", "KeyW"],
    ]) {
      for (const type of ["keydown", "keyup"]) {
        const event = new KeyboardEvent(type, {
          key,
          code,
          bubbles: true,
          cancelable: true,
        });
        button.dispatchEvent(event);
        // Not cancelled, so the browser still presses the button.
        expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(seen).toEqual(["keydown KeyW", "keyup KeyW"]);

    // The list of rows is no control: with focus on it, Space is still the
    // game's hold and Enter still confirms a building.
    seen.length = 0;
    const list = playerStats.querySelector(
      ".stats-table-scroll",
    ) as HTMLElement;
    for (const [key, code] of [
      [" ", "Space"],
      ["Enter", "Enter"],
    ]) {
      for (const type of ["keydown", "keyup"]) {
        list.dispatchEvent(
          new KeyboardEvent(type, { key, code, bubbles: true }),
        );
      }
    }
    expect(seen).toEqual([
      "keydown Space",
      "keyup Space",
      "keydown Enter",
      "keyup Enter",
    ]);

    window.removeEventListener("keydown", listener);
    window.removeEventListener("keyup", listener);
  });

  it("leaves focus where it was when a header is pressed with the mouse", async () => {
    const playerStats = await mount([player("alice", 3)], null);
    const button = playerStats.querySelector(
      '[role="columnheader"][data-column="gold"] button',
    ) as HTMLElement;

    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("marks your row and your teammates' rows", async () => {
    const me = player("me", 90);
    const mate = {
      ...player("mate", 50),
      isOnSameTeam: (other: PlayerView) => other === me,
    } as unknown as PlayerView;
    const stranger = player("stranger", 10);
    const playerStats = await mount([me, mate, stranger], me);

    expect(
      rows(playerStats).map((row) => [
        row.hasAttribute("data-me"),
        row.hasAttribute("data-mate"),
      ]),
    ).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  it("marks zeros, but not the Type column's Player", async () => {
    new UserSettings().setStatsColumns("player", ["playerType", "tiles"]);
    const human = {
      ...player("human", 0),
      type: () => PlayerType.Human,
    } as unknown as PlayerView;
    const playerStats = await mount([human], null);

    const [row] = rows(playerStats);
    expect(cell(row, "tiles")?.hasAttribute("data-zero")).toBe(true);
    expect(cell(row, "playerType")?.textContent?.trim()).toBe(
      "player_type.player",
    );
    expect(cell(row, "playerType")?.hasAttribute("data-zero")).toBe(false);
    expect(cell(row, "rank")?.hasAttribute("data-zero")).toBe(false);
  });

  it("gives a name its full text and its own direction, and keeps translators off the row", async () => {
    const long = "Abcdefghijklmnopqrstuvwxyz Abcdefghijklm";
    const playerStats = await mount([player(long, 3)], null);

    const [row] = rows(playerStats);
    const name = cell(row, "player")?.querySelector("span[title]");
    expect(name?.getAttribute("title")).toBe(long);
    expect(name?.getAttribute("dir")).toBe("auto");
    expect(row.getAttribute("translate")).toBe("no");
  });

  it("shows each player's colour before their name", async () => {
    const red = {
      ...player("red", 90),
      territoryColor: () => colord("#d94a4a"),
    } as unknown as PlayerView;
    const green = {
      ...player("green", 10),
      territoryColor: () => colord("#4ad94a"),
    } as unknown as PlayerView;
    const playerStats = await mount([red, green], null);

    const chips = rows(playerStats).map((row) => {
      const name = cell(row, "player");
      const chip = name?.querySelector("[data-chip]");
      // Before the name, and silent: the name says who it is.
      expect(name?.firstElementChild).toBe(chip);
      expect(chip?.getAttribute("aria-hidden")).toBe("true");
      return colord((chip as HTMLElement).style.background).toHex();
    });
    expect(chips).toEqual(["#d94a4a", "#4ad94a"]);
    // Only the name has one.
    expect(playerStats.querySelectorAll("[data-chip]")).toHaveLength(2);
  });

  // What follows each row's name, in order.
  function marks(playerStats: PlayerStats) {
    return rows(playerStats).map((row) =>
      [...(cell(row, "player")?.querySelectorAll("[data-mark]") ?? [])].map(
        (mark) => mark.getAttribute("data-mark"),
      ),
    );
  }

  function attack(attackerID: number, retreating = false) {
    return { attackerID, targetID: 1, troops: 100, id: "a", retreating };
  }

  it("marks who attacks you, betrayed, is allied, embargoes you or left", async () => {
    const me = {
      ...player("me", 90),
      smallID: () => 1,
      // Never on your own row.
      isTraitor: () => true,
      isDisconnected: () => true,
      incomingAttacks: () => [attack(2)],
    } as unknown as PlayerView;
    const players = [
      me,
      { ...player("attacker", 80), smallID: () => 2 },
      { ...player("traitor", 70), isTraitor: () => true },
      {
        ...player("ally", 60),
        isAlliedWith: (other: PlayerView) => other === me,
      },
      {
        ...player("embargo", 50),
        hasEmbargoAgainst: (other: PlayerView) => other === me,
      },
      { ...player("offline", 40), isDisconnected: () => true },
      player("quiet", 30),
    ] as unknown as PlayerView[];
    const playerStats = await mount(players, me);

    expect(marks(playerStats)).toEqual([
      [],
      ["attack"],
      ["traitor"],
      ["ally"],
      ["embargo"],
      ["offline"],
      [],
    ]);
    const label = {
      attack: "leaderboard.mark_attacking_you",
      traitor: "leaderboard.mark_traitor",
      ally: "leaderboard.mark_ally",
      embargo: "leaderboard.mark_embargo",
      offline: "leaderboard.mark_disconnected",
    };
    for (const mark of playerStats.querySelectorAll("[data-mark]")) {
      const key = label[mark.getAttribute("data-mark") as keyof typeof label];
      expect(mark.getAttribute("role")).toBe("img");
      expect(mark.getAttribute("aria-label")).toBe(key);
      expect(mark.getAttribute("title")).toBe(key);
    }
  });

  it("does not count a retreating attack", async () => {
    const me = {
      ...player("me", 90),
      smallID: () => 1,
      incomingAttacks: () => [attack(2, true)],
    } as unknown as PlayerView;
    const attacker = {
      ...player("attacker", 80),
      smallID: () => 2,
    } as unknown as PlayerView;
    const playerStats = await mount([me, attacker], me);

    expect(marks(playerStats)).toEqual([[], []]);
  });

  it("shows the two most urgent marks, and an embargo only from someone not allied", async () => {
    const me = {
      ...player("me", 90),
      smallID: () => 1,
      incomingAttacks: () => [attack(2)],
    } as unknown as PlayerView;
    const players = [
      me,
      {
        ...player("everything", 80),
        smallID: () => 2,
        isTraitor: () => true,
        isDisconnected: () => true,
      },
      {
        ...player("friendly", 70),
        isAlliedWith: () => true,
        hasEmbargoAgainst: () => true,
        isDisconnected: () => true,
      },
    ] as unknown as PlayerView[];
    const playerStats = await mount(players, me);

    expect(marks(playerStats)).toEqual([
      [],
      ["attack", "traitor"],
      ["ally", "offline"],
    ]);
  });

  it("shows a spectator only traitors and the disconnected", async () => {
    const players = [
      {
        ...player("traitor", 80),
        isTraitor: () => true,
        isAlliedWith: () => true,
      },
      {
        ...player("offline", 70),
        hasEmbargoAgainst: () => true,
        isDisconnected: () => true,
      },
    ] as unknown as PlayerView[];
    const playerStats = await mount(players, null);

    expect(marks(playerStats)).toEqual([["traitor"], ["offline"]]);

    // The same once you are eliminated: an embargo on you stays in the game.
    playerStats.remove();
    const dead = {
      ...player("me", 0),
      isAlive: () => false,
    } as unknown as PlayerView;
    expect(marks(await mount(players, dead))).toEqual([
      ["traitor"],
      ["offline"],
    ]);
  });

  it("goes to a player when their row is clicked", async () => {
    const alice = player("alice", 90);
    const bob = player("bob", 10);
    const playerStats = await mount([alice, bob], null);
    const emit = vi.fn();
    playerStats.eventBus = { emit } as unknown as EventBus;

    (rows(playerStats)[1] as HTMLElement).click();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBeInstanceOf(GoToPlayerEvent);
    expect(emit.mock.calls[0][0].player).toBe(bob);
  });

  it("asks for the column menu on a right-click in the header, not in a row", async () => {
    const playerStats = await mount([player("alice", 90)], null);
    type Asked = { x: number; y: number; header: Element | null };
    const asked: Asked[] = [];
    playerStats.addEventListener("columns-menu", (event) =>
      asked.push((event as CustomEvent<Asked>).detail),
    );
    const rightClick = (target: Element) => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 40,
      });
      target.dispatchEvent(event);
      return event;
    };

    const onHeader = rightClick(
      playerStats.querySelector(
        '[role="columnheader"][data-column="gold"] of-icon',
      ) as Element,
    );
    expect(onHeader.defaultPrevented).toBe(true);
    expect(asked).toEqual([
      {
        x: 120,
        y: 40,
        header: playerStats.querySelector(
          '[role="columnheader"][data-column="gold"]',
        ),
      },
    ]);

    const onRow = rightClick(rows(playerStats)[0]);
    expect(onRow.defaultPrevented).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("names the table, counts every row and gives each drawn row its rank", async () => {
    const players = Array.from({ length: 300 }, (_, i) =>
      player(`p${i + 1}`, 300 - i),
    );
    const playerStats = await mount(players, null);
    const table = playerStats.querySelector('[role="table"]');
    const header = playerStats.querySelector(".stats-table-header");
    // Each drawn row's index, and its rank plus one for the header row.
    const indexes = () =>
      rows(playerStats).map((row) => [
        Number(row.getAttribute("aria-rowindex")),
        Number(cell(row, "rank")?.textContent) + 1,
      ]);

    expect(table?.getAttribute("aria-label")).toBe("leaderboard.players_table");
    expect(table?.getAttribute("aria-rowcount")).toBe("301");
    expect(header?.getAttribute("aria-rowindex")).toBe("1");
    expect(rows(playerStats)).toHaveLength(12);
    expect(rows(playerStats)[0].getAttribute("aria-rowindex")).toBe("2");
    for (const [index, rank] of indexes()) expect(index).toBe(rank);

    const scroller = playerStats.querySelector(
      ".stats-table-scroll",
    ) as HTMLElement;
    scroller.scrollTop = 2400;
    scroller.dispatchEvent(new Event("scroll"));
    await playerStats.updateComplete;
    expect(indexes()[0]).toEqual([98, 98]);
    for (const [index, rank] of indexes()) expect(index).toBe(rank);
  });

  it("names the headers that are not sort buttons", async () => {
    const playerStats = await mount([player("alice", 1)], null);
    const header = (id: ColumnId) =>
      playerStats.querySelector(`[role="columnheader"][data-column="${id}"]`);

    expect(header("rank")?.getAttribute("aria-label")).toBe("leaderboard.rank");
    expect(header("player")?.getAttribute("aria-label")).toBe(
      "leaderboard.player",
    );
    // A sortable header is named by its button.
    expect(header("tiles")?.hasAttribute("aria-label")).toBe(false);
    expect(
      header("tiles")?.querySelector("button")?.getAttribute("aria-label"),
    ).toBe("leaderboard.owned");
  });

  describe("under the pointer", () => {
    const land = new Map<string, number>();
    const alive = new Set<string>();

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function changing(name: string, tiles: number) {
      land.set(name, tiles);
      alive.add(name);
      return {
        ...player(name, tiles),
        numTilesOwned: () => land.get(name),
        isAlive: () => alive.has(name),
      } as unknown as PlayerView;
    }

    const names = (playerStats: PlayerStats) =>
      rows(playerStats).map((row) => cell(row, "player")?.textContent?.trim());
    const ranks = (playerStats: PlayerStats) =>
      rows(playerStats).map((row) => cell(row, "rank")?.textContent?.trim());

    async function point(
      playerStats: PlayerStats,
      type: "pointerenter" | "pointermove" | "pointerleave",
      pointerType: string,
    ) {
      playerStats
        .querySelector(".stats-table-scroll")
        ?.dispatchEvent(new PointerEvent(type, { pointerType }));
      await playerStats.updateComplete;
    }

    async function refresh(playerStats: PlayerStats) {
      playerStats.refresh();
      await playerStats.updateComplete;
    }

    it("keeps the rows in place under a mouse, with their new ranks, and sorts them when it leaves", async () => {
      const players = [
        changing("alice", 90),
        changing("bob", 50),
        changing("carol", 10),
      ];
      const playerStats = await mount(players, null);

      await point(playerStats, "pointerenter", "mouse");
      land.set("alice", 5);
      land.set("carol", 100);
      players.push(changing("dave", 200));
      alive.delete("bob");
      await refresh(playerStats);
      // Newcomers go to the end, the dead leave.
      expect(names(playerStats)).toEqual(["alice", "carol", "dave"]);
      expect(ranks(playerStats)).toEqual(["3", "2", "1"]);

      await point(playerStats, "pointerleave", "mouse");
      expect(names(playerStats)).toEqual(["dave", "carol", "alice"]);
      expect(ranks(playerStats)).toEqual(["1", "2", "3"]);
    });

    it("does not hold them for a touch", async () => {
      const playerStats = await mount(
        [changing("alice", 90), changing("bob", 50)],
        null,
      );

      await point(playerStats, "pointerenter", "touch");
      land.set("bob", 100);
      await refresh(playerStats);
      expect(names(playerStats)).toEqual(["bob", "alice"]);
    });

    it("sorts them once the mouse has rested on the list for three seconds", async () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(1000);
      const playerStats = await mount(
        [changing("alice", 90), changing("bob", 50)],
        null,
      );

      await point(playerStats, "pointerenter", "mouse");
      land.set("bob", 100);
      now.mockReturnValue(3999);
      await refresh(playerStats);
      expect(names(playerStats)).toEqual(["alice", "bob"]);

      // Parked: the next refresh sorts, though the mouse is still there.
      now.mockReturnValue(4000);
      await refresh(playerStats);
      expect(names(playerStats)).toEqual(["bob", "alice"]);
    });

    it("keeps holding them while the mouse moves on the list", async () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(1000);
      const playerStats = await mount(
        [changing("alice", 90), changing("bob", 50)],
        null,
      );

      await point(playerStats, "pointerenter", "mouse");
      land.set("bob", 100);
      now.mockReturnValue(3500);
      await point(playerStats, "pointermove", "mouse");
      now.mockReturnValue(6000);
      await refresh(playerStats);
      expect(names(playerStats)).toEqual(["alice", "bob"]);

      now.mockReturnValue(6500);
      await refresh(playerStats);
      expect(names(playerStats)).toEqual(["bob", "alice"]);
    });

    it("sorts at once when a header is clicked", async () => {
      const playerStats = await mount(
        [
          { ...changing("alice", 90), gold: () => 10n } as PlayerView,
          { ...changing("bob", 50), gold: () => 90n } as PlayerView,
        ],
        null,
      );

      await point(playerStats, "pointerenter", "mouse");
      playerStats
        .querySelector<HTMLElement>(
          '[role="columnheader"][data-column="gold"] button',
        )
        ?.click();
      await playerStats.updateComplete;
      expect(names(playerStats)).toEqual(["bob", "alice"]);
      expect(ranks(playerStats)).toEqual(["1", "2"]);
    });

    it("lets go when the table is hidden under the pointer", async () => {
      const playerStats = await mount(
        [changing("alice", 90), changing("bob", 50)],
        null,
      );

      await point(playerStats, "pointerenter", "mouse");
      playerStats.visible = false;
      await playerStats.updateComplete;
      land.set("bob", 100);
      playerStats.visible = true;
      await playerStats.updateComplete;
      await refresh(playerStats);
      expect(names(playerStats)).toEqual(["bob", "alice"]);
    });
  });
});

describe("PlayerStats neighbours", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // 300 players, yours at `myRank`. jsdom measures nothing, so the list
  // falls back to 24px rows in 180px: it shows seven rows or more.
  async function mount(myRank: number): Promise<PlayerStats> {
    const players = Array.from({ length: 300 }, (_, i) =>
      player(i + 1 === myRank ? "me" : `p${i + 1}`, 300 - i),
    );
    const me = players[myRank - 1];
    const game = {
      myPlayer: () => me,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  function rows(playerStats: PlayerStats) {
    return [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ];
  }

  function rank(row: Element) {
    return row
      .querySelector('[role="cell"][data-column="rank"]')
      ?.textContent?.trim();
  }

  async function scrollTo(playerStats: PlayerStats, top: number) {
    const scroller = playerStats.querySelector<HTMLElement>(
      ".stats-table-scroll",
    )!;
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
    await playerStats.updateComplete;
  }

  it("holds the rows either side of yours with it, the outer one marking the gap", async () => {
    const playerStats = await mount(200);
    const drawn = rows(playerStats);
    const near = drawn.filter((row) => row.hasAttribute("data-near"));

    expect(drawn.slice(-3).map(rank)).toEqual(["199", "200", "201"]);
    expect(drawn[drawn.length - 2].hasAttribute("data-me")).toBe(true);
    expect(near.map(rank)).toEqual(["199", "201"]);
    expect(
      drawn.filter((row) => row.hasAttribute("data-gap")).map(rank),
    ).toEqual(["199"]);
  });

  it("draws each row once and no gap when scrolled to your rank", async () => {
    const playerStats = await mount(200);
    await scrollTo(playerStats, 195 * 24);
    const ranks = rows(playerStats).map(rank);

    expect(ranks).toEqual([...new Set(ranks)]);
    expect(ranks).toContain("199");
    expect(ranks).toContain("201");
    expect(playerStats.querySelector("[data-gap]")).toBeNull();
    expect(playerStats.querySelectorAll("[data-near]")).toHaveLength(2);
  });

  it("holds the block first, the gap under it, when scrolled past it", async () => {
    const playerStats = await mount(200);
    await scrollTo(playerStats, 250 * 24);
    const drawn = rows(playerStats);

    expect(drawn.slice(0, 3).map(rank)).toEqual(["199", "200", "201"]);
    expect(
      drawn.filter((row) => row.hasAttribute("data-gap")).map(rank),
    ).toEqual(["201"]);
  });

  it("holds no neighbours when you rank within the list", async () => {
    const playerStats = await mount(3);

    expect(playerStats.querySelector("[data-me]")).not.toBeNull();
    expect(playerStats.querySelector("[data-near]")).toBeNull();
    expect(playerStats.querySelector("[data-gap]")).toBeNull();
  });

  it("holds only the row above yours on a list of fewer than seven rows", async () => {
    // Five 24px rows.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(120);
    const playerStats = await mount(200);
    await playerStats.updateComplete;
    const drawn = rows(playerStats);

    expect(drawn.slice(-2).map(rank)).toEqual(["199", "200"]);
    expect(drawn.map(rank)).not.toContain("201");
    expect(
      drawn.filter((row) => row.hasAttribute("data-near")).map(rank),
    ).toEqual(["199"]);
    expect(
      drawn.filter((row) => row.hasAttribute("data-gap")).map(rank),
    ).toEqual(["199"]);
  });
});

describe("PlayerStats eliminated rows", () => {
  // Each animation the table asks for, and how to end it.
  let folds: { keyframes: Keyframe; finish: () => void }[];
  let ticks: number;

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    folds = [];
    ticks = 600;
    Element.prototype.animate = function (keyframes: Keyframe) {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => (finish = resolve));
      folds.push({ keyframes, finish });
      return { finished } as unknown as Animation;
    } as typeof Element.prototype.animate;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (Element.prototype as Partial<Element>).animate;
    vi.unstubAllGlobals();
  });

  async function mount(players: PlayerView[]): Promise<PlayerStats> {
    const game = {
      myPlayer: () => null,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => ticks,
      inSpawnPhase: () => false,
      ticksSinceStart: () => ticks,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  // The rows a player reads: name and rank, leaving rows left out.
  function ranks(playerStats: PlayerStats) {
    return [
      ...playerStats.querySelectorAll(
        ".stats-table-scroll .stats-table-row:not([data-leaving])",
      ),
    ].map((row) => [
      row.querySelector('[data-column="player"]')?.textContent?.trim(),
      row.querySelector('[data-column="rank"]')?.textContent?.trim(),
    ]);
  }

  async function eliminate(
    playerStats: PlayerStats,
    players: PlayerView[],
    ...ids: string[]
  ) {
    for (const id of ids) {
      players.splice(
        players.findIndex((player) => player.id() === id),
        1,
      );
    }
    playerStats.refresh();
    await playerStats.updateComplete;
  }

  it("folds a row in view away, outside the count, and forgets it once closed", async () => {
    const players = [
      player("alice", 90),
      player("bob", 50),
      player("carol", 10),
    ];
    const playerStats = await mount(players);
    await eliminate(playerStats, players, "bob");

    const leaving = playerStats.querySelectorAll("[data-leaving]");
    expect(leaving).toHaveLength(1);
    expect(leaving[0].getAttribute("aria-hidden")).toBe("true");
    expect(leaving[0].hasAttribute("aria-rowindex")).toBe(false);
    // Its rank already belongs to the row below.
    expect(
      leaving[0].querySelector('[data-column="rank"]')?.textContent?.trim(),
    ).toBe("");
    expect(
      leaving[0].previousElementSibling?.querySelector('[data-column="player"]')
        ?.textContent,
    ).toContain("alice");
    expect(
      playerStats
        .querySelector('[role="table"]')
        ?.getAttribute("aria-rowcount"),
    ).toBe("3");
    // The ranks below it change at once.
    expect(ranks(playerStats)).toEqual([
      ["alice", "1"],
      ["carol", "2"],
    ]);
    expect(folds).toHaveLength(1);
    // Its padding and rule close too, or it would stop short of closed.
    expect(folds[0].keyframes).toEqual({
      height: "0px",
      paddingBottom: "0px",
      borderBottomWidth: "0px",
      opacity: 0,
    });

    folds[0].finish();
    await Promise.resolve();
    await playerStats.updateComplete;
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    expect(ranks(playerStats)).toEqual([
      ["alice", "1"],
      ["carol", "2"],
    ]);
  });

  it("folds two rows that go in the same refresh, each at its place", async () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      player(id, 50 - i),
    );
    const playerStats = await mount(players);
    await eliminate(playerStats, players, "b", "d");

    const names = [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ].map((row) => [
      row.querySelector('[data-column="player"]')?.textContent?.trim(),
      row.hasAttribute("data-leaving"),
    ]);
    expect(names).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
      ["d", true],
      ["e", false],
    ]);
    expect(folds).toHaveLength(2);
  });

  it("folds the last rows of the list in the order they had", async () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      player(id, 50 - i),
    );
    const playerStats = await mount(players);
    await eliminate(playerStats, players, "b", "d", "e");

    const names = [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ].map((row) => [
      row.querySelector('[data-column="player"]')?.textContent?.trim(),
      row.hasAttribute("data-leaving"),
    ]);
    expect(names).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
      ["d", true],
      ["e", true],
    ]);
  });

  it("drops the rows at once when the clock jumped ahead, as on a replay seek", async () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      player(id, 50 - i),
    );
    const playerStats = await mount(players);

    // Ten minutes on: they went long ago, not now.
    ticks += 6000;
    await eliminate(playerStats, players, "b", "d");

    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    expect(folds).toHaveLength(0);
  });

  it("folds in a replay played 32 times faster, and drops the rows when it seeks", async () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      player(id, 50 - i),
    );
    const playerStats = await mount(players);
    playerStats.speed = 32;

    // One second on is 32 seconds of play.
    ticks += 320;
    await eliminate(playerStats, players, "b");
    expect(playerStats.querySelector('[data-leaving="b"]')).not.toBeNull();
    expect(folds).toHaveLength(1);

    // Sought twenty minutes on.
    ticks += 12_000;
    await eliminate(playerStats, players, "d");
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    expect(folds).toHaveLength(1);
  });

  it("drops the rows after a replay seek shorter than a jump at 32x", async () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      player(id, 50 - i),
    );
    const playerStats = await mount(players);
    playerStats.speed = 32;

    // Sought ten minutes on: less than a jump at this speed, but the viewer
    // says it sought.
    playerStats.seeked();
    ticks += 6000;
    await eliminate(playerStats, players, "b");
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    expect(folds).toHaveLength(0);
  });

  it("glides none of the rows the fold moves up", async () => {
    const players = ["a", "b", "c", "d", "e"].map((id, i) =>
      player(id, 50 - i),
    );
    const playerStats = await mount(players);
    await eliminate(playerStats, players, "b");

    expect(folds).toHaveLength(1);
    expect(folds[0].keyframes).toMatchObject({ height: "0px", opacity: 0 });
  });

  it("shows no mark or troop gauge on a leaving row", async () => {
    new UserSettings().setStatsColumns("player", ["tiles", "troops"]);
    const players = [
      player("alice", 90),
      { ...player("bob", 50), isTraitor: () => true } as unknown as PlayerView,
      player("carol", 10),
    ];
    const playerStats = await mount(players);
    expect(playerStats.querySelector("[data-mark]")).not.toBeNull();
    await eliminate(playerStats, players, "bob");

    const leaving = playerStats.querySelector("[data-leaving]");
    expect(leaving?.querySelector("[data-mark]")).toBeNull();
    expect(leaving?.querySelector("[data-gauge]")).toBeNull();
    expect(playerStats.querySelectorAll("[data-gauge]")).toHaveLength(2);
  });

  it("folds a row in place while the rows hold their order under a mouse", async () => {
    let carolLand = 10;
    const players = [
      player("alice", 90),
      player("bob", 50),
      {
        ...player("carol", 10),
        numTilesOwned: () => carolLand,
      } as unknown as PlayerView,
    ];
    const playerStats = await mount(players);
    playerStats
      .querySelector(".stats-table-scroll")
      ?.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "mouse" }),
      );
    // Carol takes the lead, but the rows stay where they are drawn.
    carolLand = 100;
    await eliminate(playerStats, players, "bob");

    const names = [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ].map((row) => [
      row.querySelector('[data-column="player"]')?.textContent?.trim(),
      row.hasAttribute("data-leaving"),
    ]);
    expect(names).toEqual([
      ["alice", false],
      ["bob", true],
      ["carol", false],
    ]);
    expect(folds).toHaveLength(1);
  });

  it("forgets a row whose place is no longer drawn, and glides again after it", async () => {
    const land = new Map<string, number>();
    const players = Array.from({ length: 60 }, (_, i) => {
      land.set(`p${i}`, 1000 - i);
      return {
        ...player(`p${i}`, 0),
        numTilesOwned: () => land.get(`p${i}`) ?? 0,
      } as unknown as PlayerView;
    });
    const playerStats = await mount(players);
    // Rows 31 to 38 show, and the list is drawn from row 27 on.
    const list = playerStats.querySelector<HTMLElement>(".stats-table-scroll")!;
    list.scrollTop = 30 * 24;
    list.dispatchEvent(new Event("scroll"));
    await playerStats.updateComplete;

    // Five rows go above the view and one in it: its place moves up, out of
    // the rows drawn.
    await eliminate(playerStats, players, "p0", "p1", "p2", "p3", "p4", "p30");
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    expect(folds).toHaveLength(0);

    // An overtake in view a second later glides as usual.
    land.set("p38", 1000 - 36.5);
    ticks += 10;
    playerStats.refresh();
    await playerStats.updateComplete;
    expect(folds.map(({ keyframes }) => keyframes)).toEqual([
      [{ transform: "translateY(24px)" }, { transform: "none" }],
      [{ transform: "translateY(-24px)" }, { transform: "none" }],
    ]);
  });

  it("lets a fold end when the table refreshes again before it has", async () => {
    const players = [
      player("alice", 90),
      player("bob", 50),
      player("carol", 10),
    ];
    const playerStats = await mount(players);
    const list = playerStats.querySelector(".stats-table-scroll")!;
    list.dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    await eliminate(playerStats, players, "bob");
    const closing = playerStats.querySelector("[data-leaving]");
    expect(closing).not.toBeNull();

    // The mouse leaves the list, which sorts it again, while bob's row closes.
    list.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
    await playerStats.updateComplete;
    expect(playerStats.querySelector("[data-leaving]")).toBe(closing);
    expect(folds.filter(({ keyframes }) => "height" in keyframes)).toHaveLength(
      1,
    );

    folds[0].finish();
    await Promise.resolve();
    await playerStats.updateComplete;
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
  });

  it("drops a closing row when another row goes before it has closed", async () => {
    const players = ["a", "b", "c", "d"].map((id, i) => player(id, 50 - i));
    const playerStats = await mount(players);
    await eliminate(playerStats, players, "b");
    // The place b closes at no longer holds once a is gone too.
    await eliminate(playerStats, players, "a");

    const names = [
      ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
    ].map((row) => [
      row.querySelector('[data-column="player"]')?.textContent?.trim(),
      row.hasAttribute("data-leaving"),
    ]);
    expect(names).toEqual([
      ["a", true],
      ["c", false],
      ["d", false],
    ]);
  });

  it("keeps nothing for a row outside the view, drawn or not", async () => {
    const players = Array.from({ length: 300 }, (_, i) =>
      player(`p${i + 1}`, 300 - i),
    );
    const playerStats = await mount(players);
    // p11 is drawn under the view (jsdom: 7.5 rows in view, 12 drawn).
    await eliminate(playerStats, players, "p11", "p200");

    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    // The rows drawn under p11 may glide up; none folds.
    expect(folds.filter(({ keyframes }) => "height" in keyframes)).toHaveLength(
      0,
    );
  });

  it("drops the row at once under reduced motion, or with a new sort", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const players = [
      player("alice", 90),
      player("bob", 50),
      player("carol", 10),
    ];
    const playerStats = await mount(players);
    await eliminate(playerStats, players, "bob");
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();

    vi.unstubAllGlobals();
    players.splice(0, 1);
    playerStats
      .querySelector<HTMLButtonElement>('[data-column="gold"] button')
      ?.click();
    await playerStats.updateComplete;
    expect(playerStats.querySelector("[data-leaving]")).toBeNull();
    expect(folds).toHaveLength(0);
  });
});

describe("PlayerStats header tooltips", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(): Promise<PlayerStats> {
    const alice = player("alice", 3);
    const game = {
      myPlayer: () => alice,
      playerViews: () => [alice],
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  function header(playerStats: PlayerStats, id: ColumnId) {
    return playerStats.querySelector(
      `[role="columnheader"][data-column="${id}"]`,
    ) as HTMLElement;
  }

  const tips = () => document.querySelectorAll('[role="tooltip"]');

  async function pointer(
    playerStats: PlayerStats,
    target: HTMLElement,
    type: "pointerenter" | "pointerleave",
    pointerType: string,
  ) {
    target.dispatchEvent(new PointerEvent(type, { pointerType }));
    await playerStats.updateComplete;
  }

  it("shows a header's tooltip with the right-click hint for a mouse, never for a touch", async () => {
    const playerStats = await mount();
    const owned = header(playerStats, "tiles");

    await pointer(playerStats, owned, "pointerenter", "touch");
    expect(tips()).toHaveLength(0);

    await pointer(playerStats, owned, "pointerenter", "mouse");
    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toContain("leaderboard.owned");
    expect(tips()[0].textContent).toContain("leaderboard.columns_hint");

    await pointer(playerStats, owned, "pointerleave", "mouse");
    expect(tips()).toHaveLength(0);
  });

  it("shows it without the hint on keyboard focus, and links it to the header", async () => {
    const playerStats = await mount();
    const button = header(playerStats, "tiles").querySelector("button")!;
    // jsdom matches :focus-visible only once the focus event is over; a
    // browser already does during it, for the keyboard.
    vi.spyOn(button, "matches").mockImplementation(
      (selector) => selector === ":focus-visible",
    );

    button.focus();
    await playerStats.updateComplete;
    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).not.toContain("leaderboard.columns_hint");
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.getAttribute("role")).toBe(
      "tooltip",
    );

    button.blur();
    await playerStats.updateComplete;
    expect(tips()).toHaveLength(0);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("gives the tooltip back to the focused header when the mouse leaves another", async () => {
    const playerStats = await mount();
    const button = header(playerStats, "tiles").querySelector("button")!;
    vi.spyOn(button, "matches").mockImplementation(
      (selector) => selector === ":focus-visible",
    );
    button.focus();
    await playerStats.updateComplete;

    const gold = header(playerStats, "gold");
    await pointer(playerStats, gold, "pointerenter", "mouse");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    await pointer(playerStats, gold, "pointerleave", "mouse");

    expect(tips()).toHaveLength(1);
    expect(tips()[0].textContent).toContain("leaderboard.owned");
    expect(tips()[0].textContent).not.toContain("leaderboard.columns_hint");
    expect(button.getAttribute("aria-describedby")).toBe(tips()[0].id);
  });

  it("drops the tooltip of a column that is taken off the table", async () => {
    const playerStats = await mount();
    await pointer(
      playerStats,
      header(playerStats, "tiles"),
      "pointerenter",
      "mouse",
    );
    expect(tips()).toHaveLength(1);

    // Unticked in the column menu, with the pointer still on the header.
    new UserSettings().setStatsColumns("player", ["gold"]);
    playerStats.refresh();
    await playerStats.updateComplete;

    expect(tips()).toHaveLength(0);
  });

  it("leaves no native title on the headers", async () => {
    const playerStats = await mount();

    const headers = playerStats.querySelectorAll('[role="columnheader"]');
    expect(headers.length).toBeGreaterThan(0);
    for (const cell of headers) {
      expect(cell.hasAttribute("title")).toBe(false);
    }
  });
});

describe("PlayerStats clan column", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    // Off by default; these tests turn it on in the picker.
    new UserSettings().setStatsColumns("player", [
      "clan",
      "tiles",
      "gold",
      "maxtroops",
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(players: PlayerView[]): Promise<PlayerStats> {
    const game = {
      myPlayer: () => players[0],
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  it("shows the tag and the bare name in separate columns, without brackets", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const cells = playerStats.querySelectorAll(
      '.stats-table-row > [role="cell"]',
    );
    expect(cells[1].textContent?.trim()).toBe("ABCDE");
    expect(cells[2].textContent?.trim()).toBe("alice");
    // The merged "[ABCDE] alice" form must not survive into the table.
    expect(playerStats.textContent).not.toContain("[ABCDE]");
  });

  it("headers the clan column with the guild icon and reserves a fixed track", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const header = (id: ColumnId) =>
      playerStats.querySelector(
        `.stats-table-header > [role="columnheader"][data-column="${id}"]`,
      );
    expect(
      header("clan")?.querySelector('of-icon[name="clan"]'),
    ).not.toBeNull();
    expect(
      header("player")?.querySelector('of-icon[name="player"]'),
    ).not.toBeNull();
    expect(
      playerStats.querySelector(".stats-table-content")?.getAttribute("style"),
    ).toContain(
      "30px 80px calc(var(--stats-name, 100px) + var(--stats-chip, 0.75rem) - var(--stats-end-track, 0px))",
    );
  });

  it("rules off every column but the first, so none read as merged", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const hasRule = (nodes: Element[]) =>
      nodes.map((node) => node.hasAttribute("data-rule"));
    // rank | clan | player | tiles | gold | maxtroops.
    expect(
      hasRule([
        ...playerStats.querySelectorAll(
          '.stats-table-header > [role="columnheader"]',
        ),
      ]),
    ).toEqual([false, true, true, true, true, true]);
    expect(
      hasRule([
        ...playerStats.querySelectorAll('.stats-table-row > [role="cell"]'),
      ]),
    ).toEqual([false, true, true, true, true, true]);
  });

  it("shows a dash for clanless players", async () => {
    const playerStats = await mount([
      player("alice", 3, "ABCDE"),
      player("bob", 2),
    ]);

    const rows = playerStats.querySelectorAll(
      ".stats-table-scroll .stats-table-row",
    );
    expect(rows.length).toBe(2);
    const clanCells = [...rows].map(
      (row) => row.querySelectorAll('[role="cell"]')[1],
    );
    expect(clanCells.map((cell) => cell.textContent?.trim())).toEqual([
      "ABCDE",
      "–",
    ]);
    expect(clanCells.map((cell) => cell.hasAttribute("data-zero"))).toEqual([
      false,
      true,
    ]);
  });

  it("disappears when deselected in the picker", async () => {
    const settings = new UserSettings();
    settings.setStatsColumns("player", ["tiles", "gold", "maxtroops"]);
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    expect(
      [
        ...playerStats.querySelectorAll(
          '.stats-table-header > [role="columnheader"]',
        ),
      ].map((header) => header.getAttribute("data-column")),
    ).toEqual(["rank", "player", "tiles", "gold", "maxtroops"]);
    expect(
      playerStats.querySelector(".stats-table-content")?.getAttribute("style"),
    ).toContain(
      "30px calc(var(--stats-name, 100px) + var(--stats-chip, 0.75rem) - var(--stats-end-track, 0px))",
    );
    expect(playerStats.textContent).not.toContain("ABCDE");
  });

  it("gives only orderable columns a sort button", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const headers = [
      ...playerStats.querySelectorAll(
        '.stats-table-header > [role="columnheader"]',
      ),
    ];
    // rank, clan and player are not orderable; the stat tracks are.
    expect(
      headers
        .slice(0, 5)
        .map((header) => header.querySelector("button") !== null),
    ).toEqual([false, false, false, true, true]);
    expect(
      headers.slice(0, 4).map((header) => header.getAttribute("aria-sort")),
    ).toEqual([null, null, null, "descending"]);
  });

  it("survives being the only selected column, leaving the rows unsorted", async () => {
    new UserSettings().setStatsColumns("player", ["clan"]);
    const playerStats = await mount([
      player("alice", 3, "AAA"),
      player("bob", 90, "BBB"),
    ]);

    // rank | clan | player — no stat track, so nothing to sort on.
    expect(
      playerStats.querySelector(".stats-table-content")?.getAttribute("style"),
    ).toContain(
      "grid-template-columns: 30px 80px calc(var(--stats-name, 100px) + var(--stats-chip, 0.75rem) - var(--stats-end-track, 0px)) minmax(0px, max-content);",
    );
    expect(
      [
        ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
      ].map((row) =>
        row.querySelectorAll('[role="cell"]')[1].textContent?.trim(),
      ),
    ).toEqual(["AAA", "BBB"]);
  });
});

describe("TeamStats clan column", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("is not a team default, and a stored one still cannot render", () => {
    const settings = new UserSettings();
    expect(settings.statsColumns("team")).not.toContain("clan");

    // The clan def is player-only, so a hand-edited team selection carrying
    // it has nothing to match.
    settings.setStatsColumns("team", ["clan", "gold"]);
    expect(columnsFor("team").map((column) => column.id)).not.toContain("clan");
  });
});

describe("gold rate history", () => {
  // Each refresh is one second of game time in which every player earns 100.
  let ticks = 0;
  let earned = 0;

  function earner(id: string, smallID: number, alive = true): PlayerView {
    return {
      id: () => id,
      smallID: () => smallID,
      name: () => id,
      clanTag: () => null,
      team: () => "Blue",
      numTilesOwned: () => 1,
      gold: () => 0n,
      goldEarned: () => earned,
      tradeGold: () => 0,
      trainGold: () => 0,
      piracyGold: () => 0,
      isAlive: () => alive,
      isOnSameTeam: () => false,
      territoryColor: () => colord("#4a90d9"),
      incomingAttacks: () => [],
      isTraitor: () => false,
      isAlliedWith: () => false,
      hasEmbargoAgainst: () => false,
      isDisconnected: () => false,
    } as unknown as PlayerView;
  }

  function fakeGame(players: PlayerView[]): GameView {
    return {
      myPlayer: () => players[0],
      playerViews: () => players,
      ticks: () => ticks,
      inSpawnPhase: () => false,
    } as unknown as GameView;
  }

  function mount(game: GameView): PlayerStats {
    const playerStats = new PlayerStats();
    playerStats.game = game;
    document.body.append(playerStats);
    return playerStats;
  }

  function playSeconds(table: PlayerStats, seconds: number) {
    for (let i = 0; i < seconds; i++) {
      ticks += 10;
      earned += 100;
      table.refresh();
    }
  }

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    new UserSettings().setStatsColumns("player", ["goldIncomePerMin"]);
    new UserSettings().setStatsColumns("team", ["goldIncomePerMin"]);
    goldRateTracker.resetAll();
    ticks = 0;
    earned = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the right rate the moment a table closed for a minute opens", async () => {
    const playerStats = mount(fakeGame([earner("me", 1)]));

    playSeconds(playerStats, 60);
    playerStats.visible = true;
    playSeconds(playerStats, 1);
    await playerStats.updateComplete;

    const cells = playerStats.querySelectorAll(
      '.stats-table-row > [role="cell"]',
    );
    expect(cells[2].textContent?.trim()).toBe("6.00K");
  });

  it("feeds the team totals while the player table is closed", () => {
    const players = [earner("me", 1)];
    const game = fakeGame(players);
    const playerStats = mount(game);

    playSeconds(playerStats, 60);

    expect(
      aggregateTeamValues(players, [columnById("goldIncomePerMin")], game).get(
        "goldIncomePerMin",
      ),
    ).toBe(6000);
  });

  it("adds one sample per living player per refresh, whichever tables are open", () => {
    const game = fakeGame([earner("me", 1), earner("ally", 2)]);
    const playerStats = mount(game);
    playerStats.visible = true;
    const teamStats = new TeamStats();
    teamStats.game = game;
    teamStats.visible = true;
    document.body.append(teamStats);
    const record = vi.spyOn(goldRateTracker, "record");

    // One refresh of both tables, as the sidebar does every second.
    playerStats.refresh();
    teamStats.refresh();

    expect(record.mock.calls.map(([smallID]) => smallID)).toEqual([1, 2]);
  });

  it("forgets a player who died", () => {
    const playerStats = mount(
      fakeGame([earner("me", 1), earner("dead", 2, false)]),
    );
    const record = vi.spyOn(goldRateTracker, "record");
    const forget = vi.spyOn(goldRateTracker, "forget");

    playerStats.refresh();

    expect(forget).toHaveBeenCalledWith(2);
    expect(record.mock.calls.map(([smallID]) => smallID)).toEqual([1]);
  });
});

describe("troop gauge", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // Troops equal land in these players, and everyone's max is 100.
  async function mount<T extends PlayerStats | TeamStats>(
    table: T,
    players: PlayerView[],
  ): Promise<T> {
    table.game = {
      myPlayer: () => players[0],
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    table.visible = true;
    document.body.append(table);
    table.refresh();
    await table.updateComplete;
    return table;
  }

  async function gauges(table: PlayerStats | TeamStats) {
    table.refresh();
    await table.updateComplete;
    return [...table.querySelectorAll("[data-gauge]")].map((gauge) => [
      gauge.closest('[role="cell"]')?.getAttribute("data-column"),
      gauge.getAttribute("data-gauge-level"),
    ]);
  }

  it("is drawn in Troops when shown, in Max Troops otherwise, nowhere without both", async () => {
    const settings = new UserSettings();
    settings.setStatsColumns("player", ["tiles", "troops", "maxtroops"]);
    const playerStats = await mount(new PlayerStats(), [player("me", 50)]);

    expect(await gauges(playerStats)).toEqual([["troops", "ok"]]);
    expect(
      playerStats.querySelector("[data-gauge]")?.getAttribute("aria-hidden"),
    ).toBe("true");

    settings.setStatsColumns("player", ["tiles", "maxtroops"]);
    expect(await gauges(playerStats)).toEqual([["maxtroops", "ok"]]);

    settings.setStatsColumns("player", ["tiles", "gold"]);
    expect(await gauges(playerStats)).toEqual([]);
  });

  it("warns from 80% of a player's max and is full from 95%", async () => {
    new UserSettings().setStatsColumns("player", ["troops"]);
    const playerStats = await mount(
      new PlayerStats(),
      [50, 79, 80, 94, 95, 120].map((troops) => player(`p${troops}`, troops)),
    );

    // Sorted by troops, most first.
    expect((await gauges(playerStats)).map(([, level]) => level)).toEqual([
      "full",
      "full",
      "high",
      "high",
      "ok",
      "ok",
    ]);
  });

  it("is never drawn on the team table", async () => {
    new UserSettings().setStatsColumns("team", ["troops", "maxtroops"]);
    const teamStats = await mount(new TeamStats(), [
      { ...player("blue", 90), team: () => "Blue" } as unknown as PlayerView,
    ]);

    expect(teamStats.querySelectorAll(".stats-table-row")).toHaveLength(1);
    expect(await gauges(teamStats)).toEqual([]);
  });
});

describe("PlayerStats glide", () => {
  // Land by player, and the game's clock: a refresh is one second later.
  const land = new Map<string, number>();
  let ticks = 600;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({
    finished: new Promise<void>(() => {}),
    cancel,
  }));

  function owner(id: string): PlayerView {
    return {
      ...player(id, 0),
      numTilesOwned: () => land.get(id) ?? 0,
      // The reverse of land, so a sort by gold turns the list over.
      gold: () => BigInt(1000 - (land.get(id) ?? 0)),
    } as unknown as PlayerView;
  }

  async function mount(lands: number[], me?: string): Promise<PlayerStats> {
    const players = lands.map((tiles, i) => {
      land.set(`p${i + 1}`, tiles);
      return owner(`p${i + 1}`);
    });
    const game = {
      myPlayer: () => players.find((player) => player.id() === me) ?? null,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => ticks,
      inSpawnPhase: () => false,
      ticksSinceStart: () => ticks,
      numLandTiles: () => 1000,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  async function refreshWith(
    playerStats: PlayerStats,
    lands: Record<string, number>,
  ) {
    for (const [id, tiles] of Object.entries(lands)) land.set(id, tiles);
    ticks += 10;
    playerStats.refresh();
    await playerStats.updateComplete;
  }

  // Each row asked to glide: its player and where it starts from.
  function glides() {
    return animate.mock.calls.map((call, i) => {
      const row = animate.mock.contexts[i] as HTMLElement;
      const [keyframes] = call as unknown as [Keyframe[]];
      return [
        row.querySelector('[data-column="player"]')?.textContent?.trim(),
        keyframes[0].transform,
      ];
    });
  }

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    land.clear();
    ticks = 600;
    animate.mockClear();
    cancel.mockClear();
    Object.defineProperty(Element.prototype, "animate", {
      value: animate,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("glides the two rows of an overtake by one row each, the climber on top", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);

    await refreshWith(playerStats, { p3: 45 });

    expect(glides()).toEqual([
      ["p3", "translateY(24px)"],
      ["p2", "translateY(-24px)"],
    ]);
    const climber = animate.mock.contexts[0] as HTMLElement;
    expect(climber.hasAttribute("data-climbing")).toBe(true);
  });

  it("snaps when ten rows change place at once", async () => {
    const playerStats = await mount([
      120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10,
    ]);

    // The first ten turn over.
    await refreshWith(
      playerStats,
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`p${i + 1}`, 30 + i * 10]),
      ),
    );

    expect(animate).not.toHaveBeenCalled();
  });

  it("glides an overtake in view while rows drawn below the view trade places", async () => {
    // The list shows rows 1 to 8 and draws four more below them.
    const playerStats = await mount([
      140, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10,
    ]);

    // p3 passes p2 in view; rows 9 to 12, out of view, trade places.
    await refreshWith(playerStats, { p3: 135, p9: 45, p11: 25 });

    expect(glides()).toEqual([
      ["p3", "translateY(24px)"],
      ["p2", "translateY(-24px)"],
      ["p10", "translateY(24px)"],
      ["p9", "translateY(-24px)"],
      ["p12", "translateY(24px)"],
      ["p11", "translateY(-24px)"],
    ]);
  });

  it("glides the rows held under a mouse to their places when it leaves", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);
    const list = playerStats.querySelector(".stats-table-scroll");

    list?.dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    await refreshWith(playerStats, { p3: 45 });
    expect(animate).not.toHaveBeenCalled();

    list?.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
    await playerStats.updateComplete;
    expect(glides()).toEqual([
      ["p3", "translateY(24px)"],
      ["p2", "translateY(-24px)"],
    ]);
  });

  it("snaps on a sort click", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);

    playerStats
      .querySelector<HTMLElement>(
        '[role="columnheader"][data-column="gold"] button',
      )
      ?.click();
    await playerStats.updateComplete;

    expect(animate).not.toHaveBeenCalled();
  });

  it("keeps a row's climbing mark until its latest glide ends", async () => {
    const ends: (() => void)[] = [];
    for (let i = 0; i < 4; i++) {
      animate.mockImplementationOnce(() => ({
        finished: new Promise<void>((resolve) => ends.push(resolve)),
        cancel,
      }));
    }
    const playerStats = await mount([50, 40, 30, 20, 10]);
    const climbing = () =>
      [...playerStats.querySelectorAll("[data-climbing]")].map((row) =>
        row.querySelector('[data-column="player"]')?.textContent?.trim(),
      );

    // p3 passes p2, and p2 passes it back before those glides have ended.
    await refreshWith(playerStats, { p3: 45 });
    expect(climbing()).toEqual(["p3"]);
    await refreshWith(playerStats, { p2: 47 });
    expect(climbing()).toEqual(["p2"]);

    ends[0]();
    ends[1]();
    await new Promise((resolve) => setTimeout(resolve));
    expect(climbing()).toEqual(["p2"]);

    ends[2]();
    ends[3]();
    await new Promise((resolve) => setTimeout(resolve));
    expect(climbing()).toEqual([]);
  });

  it("stops the glides still running on a sort click", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);
    await refreshWith(playerStats, { p3: 45 });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).not.toHaveBeenCalled();

    playerStats
      .querySelector<HTMLElement>(
        '[role="columnheader"][data-column="gold"] button',
      )
      ?.click();
    await playerStats.updateComplete;

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("leaves the glides running when the next refresh keeps the sort", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);
    await refreshWith(playerStats, { p3: 45 });
    await refreshWith(playerStats, { p5: 25 });

    expect(animate).toHaveBeenCalledTimes(4);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("snaps when the clock goes back, as on a replay seek", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);

    ticks -= 100;
    await refreshWith(playerStats, { p3: 45 });

    expect(animate).not.toHaveBeenCalled();
  });

  it("snaps when the clock jumps ahead, as on a replay seek", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);

    // Five minutes later: the rows are where they are, they did not move.
    ticks += 3000;
    await refreshWith(playerStats, { p3: 45 });

    expect(animate).not.toHaveBeenCalled();
  });

  it("glides in a replay played 32 times faster, and snaps when it seeks", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);
    playerStats.speed = 32;

    // One second on is 32 seconds of play.
    ticks += 310;
    await refreshWith(playerStats, { p3: 45 });
    expect(glides()).toEqual([
      ["p3", "translateY(24px)"],
      ["p2", "translateY(-24px)"],
    ]);

    // Sought twenty minutes on.
    animate.mockClear();
    ticks += 12_000;
    await refreshWith(playerStats, { p2: 47 });
    expect(animate).not.toHaveBeenCalled();
  });

  it("snaps after a replay seek shorter than a jump at 32x, then glides again", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);
    playerStats.speed = 32;

    // Sought ten minutes on: less than a jump at this speed, but the viewer
    // says it sought.
    playerStats.seeked();
    ticks += 5990;
    await refreshWith(playerStats, { p3: 45 });
    expect(animate).not.toHaveBeenCalled();

    // Playing on from there.
    ticks += 310;
    await refreshWith(playerStats, { p2: 47 });
    expect(glides()).toEqual([
      ["p2", "translateY(24px)"],
      ["p3", "translateY(-24px)"],
    ]);
  });

  it("snaps on the first refresh after the table opens again", async () => {
    const playerStats = await mount([50, 40, 30, 20, 10]);
    playerStats.visible = false;
    await playerStats.updateComplete;

    land.set("p3", 45);
    playerStats.visible = true;
    await playerStats.updateComplete;
    await refreshWith(playerStats, {});

    expect(animate).not.toHaveBeenCalled();
  });

  it("snaps your neighbours while they are held at the edge with you", async () => {
    // You rank 10th of 12 and the list shows eight rows: ranks 9 to 11 are
    // held at its bottom.
    const playerStats = await mount(
      [120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10],
      "p10",
    );
    expect(playerStats.querySelectorAll("[data-near]")).toHaveLength(2);

    // Your neighbours trade places around you.
    await refreshWith(playerStats, { p9: 25, p11: 35 });

    expect(playerStats.querySelector("[data-gap]")).not.toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not move under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));
    const playerStats = await mount([50, 40, 30, 20, 10]);

    await refreshWith(playerStats, { p3: 45 });

    expect(animate).not.toHaveBeenCalled();
  });
});

describe("PlayerStats trend marks", () => {
  // Ten players ranked by land, p1 first. Each refresh is one second.
  let ticks = 0;
  let spawnPhase = false;
  // The tick the spawn phase ended at.
  let startTick = 0;
  let land: Map<string, number>;

  function landPlayer(id: string): PlayerView {
    return {
      ...player(id, 0),
      numTilesOwned: () => land.get(id) ?? 0,
    } as unknown as PlayerView;
  }

  async function mount(): Promise<PlayerStats> {
    const players = Array.from({ length: 10 }, (_, i) =>
      landPlayer(`p${i + 1}`),
    );
    const game = {
      myPlayer: () => null,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => ticks,
      inSpawnPhase: () => spawnPhase,
      ticksSinceStart: () => (spawnPhase ? 0 : ticks - startTick),
      numLandTiles: () => 1000,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    await playerStats.updateComplete;
    return playerStats;
  }

  async function play(playerStats: PlayerStats, seconds: number) {
    for (let i = 0; i < seconds; i++) {
      ticks += 10 * playerStats.speed;
      playerStats.refresh();
    }
    await playerStats.updateComplete;
  }

  // p<a> and p<b> trade places.
  function swap(a: number, b: number) {
    const landA = land.get(`p${a}`)!;
    land.set(`p${a}`, land.get(`p${b}`)!);
    land.set(`p${b}`, landA);
  }

  function marks(playerStats: PlayerStats) {
    return [...playerStats.querySelectorAll("[data-trend]")].map((mark) => [
      mark
        .closest(".stats-table-row")
        ?.querySelector('[data-column="player"]')
        ?.textContent?.trim(),
      mark.getAttribute("data-trend"),
    ]);
  }

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    ticks = 0;
    spawnPhase = false;
    startTick = 0;
    land = new Map(
      Array.from({ length: 10 }, (_, i) => [`p${i + 1}`, 100 - i * 10]),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks a row that climbed and stayed up, and the row it passed", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);

    swap(4, 5);
    await play(playerStats, 4);
    // Four refreshes at the new ranks are not enough.
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([
      ["p5", "up"],
      ["p4", "down"],
    ]);
    const mark = playerStats.querySelector('[data-trend="up"]');
    expect(mark?.getAttribute("role")).toBe("img");
    expect(mark?.getAttribute("aria-label")).toBe("leaderboard.trend_up");
    expect(
      playerStats
        .querySelector('[data-trend="down"]')
        ?.getAttribute("aria-label"),
    ).toBe("leaderboard.trend_down");
  });

  it("marks the real moves while the rows hold their order under a mouse", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);

    playerStats
      .querySelector(".stats-table-scroll")
      ?.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "mouse" }),
      );
    swap(4, 5);
    await play(playerStats, 5);

    // Drawn where they were, marked for where they rank.
    expect(marks(playerStats)).toEqual([
      ["p4", "down"],
      ["p5", "up"],
    ]);
  });

  it("does not mark a row that went back to where it was", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);

    swap(7, 8);
    await play(playerStats, 2);
    swap(7, 8);
    await play(playerStats, 5);

    expect(marks(playerStats)).toEqual([]);
  });

  it("waits for five seconds of play however often the list refreshes", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);

    swap(4, 5);
    // The mouse goes on and off the list, a refresh on each tick.
    const list = playerStats.querySelector(".stats-table-scroll")!;
    for (let i = 0; i < 6; i++) {
      ticks += 1;
      list.dispatchEvent(
        new PointerEvent("pointermove", { pointerType: "mouse" }),
      );
      list.dispatchEvent(
        new PointerEvent("pointerleave", { pointerType: "mouse" }),
      );
    }
    await playerStats.updateComplete;
    expect(marks(playerStats)).toEqual([]);

    // 4.6 seconds since the move.
    await play(playerStats, 4);
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([
      ["p5", "up"],
      ["p4", "down"],
    ]);
  });

  it("marks nothing in the spawn phase or in the minute after it", async () => {
    spawnPhase = true;
    const playerStats = await mount();
    await play(playerStats, 10);
    spawnPhase = false;
    // Play starts at the next refresh, a second from now.
    startTick = ticks + 10;
    await play(playerStats, 35);

    swap(4, 5);
    // The move has held for 25 seconds, but play started 59 seconds ago.
    await play(playerStats, 25);
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([
      ["p5", "up"],
      ["p4", "down"],
    ]);
  });

  it("marks nothing in the 30 seconds after the table opens", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);
    playerStats.visible = false;
    await play(playerStats, 10);
    playerStats.visible = true;
    await playerStats.updateComplete;
    swap(4, 5);

    await play(playerStats, 29);
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([
      ["p5", "up"],
      ["p4", "down"],
    ]);
  });

  it("marks 30 seconds after the table first opens late in the game", async () => {
    ticks = 3000;
    const playerStats = await mount();
    swap(4, 5);

    await play(playerStats, 29);
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([
      ["p5", "up"],
      ["p4", "down"],
    ]);
  });

  it("marks nothing in the first minute of play after a replay seeks back to it", async () => {
    startTick = 600;
    // Watched from the 20th minute.
    ticks = 12_000;
    const playerStats = await mount();
    await play(playerStats, 60);

    // Back to 10 seconds after the spawn phase.
    ticks = 700;
    await play(playerStats, 30);
    swap(4, 5);
    await play(playerStats, 19);
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([
      ["p5", "up"],
      ["p4", "down"],
    ]);
  });

  it.each([8, 16, 32])(
    "marks a move in a replay played %i times faster",
    async (speed) => {
      const playerStats = await mount();
      playerStats.speed = speed;
      await play(playerStats, 60);

      // A refresh covers more than five seconds of play.
      swap(4, 5);
      await play(playerStats, 1);
      expect(marks(playerStats)).toEqual([
        ["p5", "up"],
        ["p4", "down"],
      ]);
    },
  );

  it("marks nothing right after a replay played 32 times faster seeks", async () => {
    const playerStats = await mount();
    playerStats.speed = 32;
    await play(playerStats, 10);

    // Sought twenty minutes on: the ranks from before are not 30 seconds old.
    swap(4, 5);
    ticks += 12_000;
    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([]);
  });

  it("marks nothing right after a replay seek shorter than a jump at 32x", async () => {
    const playerStats = await mount();
    playerStats.speed = 32;
    await play(playerStats, 10);

    // Sought ten minutes on: less than a jump at this speed, but the viewer
    // says it sought, and the ranks from before say nothing of the moves.
    swap(4, 5);
    playerStats.seeked();
    ticks += 6000;
    await play(playerStats, 1);
    expect(marks(playerStats)).toEqual([]);
  });

  it("marks nothing when most of the rows moved", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);

    swap(1, 10);
    swap(2, 9);
    swap(3, 8);
    await play(playerStats, 30);
    // Six rows of ten moved: a reshuffle.
    expect(marks(playerStats)).toEqual([]);
  });

  it("drops the marks on a sort click", async () => {
    const playerStats = await mount();
    await play(playerStats, 60);
    swap(4, 5);
    await play(playerStats, 30);
    expect(marks(playerStats)).toHaveLength(2);

    playerStats
      .querySelector('[role="columnheader"][data-column="gold"] button')
      ?.dispatchEvent(new MouseEvent("click"));
    await playerStats.updateComplete;
    expect(marks(playerStats)).toEqual([]);

    await play(playerStats, 29);
    expect(marks(playerStats)).toEqual([]);
  });
});
