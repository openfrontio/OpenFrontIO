// @vitest-environment jsdom
import { ColumnPicker } from "../src/client/hud/layers/ColumnPicker";
import {
  COLUMN_DEFS,
  columnById,
  columnsFor,
  type ColumnDef,
  type ColumnId,
} from "../src/client/hud/layers/lib/StatsColumns";
import { UserSettings } from "../src/client/UserSettings";

// The menu only ever lists hideable columns; rank and player always render.
const hideable = columnsFor("player").filter((column) => column.isHideable);

describe("ColumnPicker", () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    holder = document.createElement("div");
    document.body.appendChild(holder);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(
    tables: ColumnPicker["tables"] = ["player"],
  ): Promise<ColumnPicker> {
    const picker = new ColumnPicker();
    picker.tables = tables;
    holder.appendChild(picker);
    await picker.updateComplete;
    return picker;
  }

  const menu = () => document.body.querySelector(".column-picker-popover");
  const boxes = (section: string) => [
    ...(menu()?.querySelectorAll<HTMLInputElement>(
      `[data-column-section="${section}"] input[type="checkbox"]`,
    ) ?? []),
  ];

  it("draws its menu under <body>, outside its host, with a box per hideable column", async () => {
    const picker = await mount();
    expect(menu()).toBeNull();

    picker.toggleAt(100, 50);
    await picker.updateComplete;

    expect(menu()).not.toBeNull();
    expect(holder.contains(menu())).toBe(false);
    expect(boxes("player")).toHaveLength(hideable.length);
    expect(hideable.map((column) => column.id)).not.toContain("rank");
    expect(hideable.map((column) => column.id)).not.toContain("player");
  });

  it("stores a tick in registry order and tells its host, keeping one column", async () => {
    const settings = new UserSettings();
    settings.setStatsColumns("player", ["tiles"]);
    const picker = await mount();
    let changes = 0;
    holder.addEventListener("columns-changed", () => changes++);
    picker.toggleAt(0, 0);
    await picker.updateComplete;

    // Registry order: index 0 is clan, 1 is playerType, 2 is tiles, 3 is gold.
    boxes("player")[3].click();
    expect(settings.statsColumns("player")).toEqual(["tiles", "gold"]);
    expect(changes).toBe(1);

    boxes("player")[0].click();
    expect(settings.statsColumns("player")).toEqual(["clan", "tiles", "gold"]);

    settings.setStatsColumns("player", ["tiles"]);
    picker.requestUpdate();
    await picker.updateComplete;
    expect(boxes("player")[2].disabled).toBe(true);
    boxes("player")[2].click();
    expect(settings.statsColumns("player")).toEqual(["tiles"]);
    expect(changes).toBe(2);
  });

  it("gives each table its own section and setting", async () => {
    const settings = new UserSettings();
    const picker = await mount(["player", "team"]);
    picker.toggleAt(0, 0);
    await picker.updateComplete;

    expect(
      [...(menu()?.querySelectorAll("[data-column-section]") ?? [])].map(
        (section) => section.getAttribute("data-column-section"),
      ),
    ).toEqual(["player", "team"]);
    const goldBox = (section: string) =>
      menu()?.querySelector(
        `[data-column-section="${section}"] [data-column="gold"] input`,
      ) as HTMLInputElement;

    goldBox("team").click();
    expect(settings.statsColumns("team")).toEqual(["tiles", "maxtroops"]);
    expect(settings.statsColumns("player")).toEqual([
      "tiles",
      "gold",
      "maxtroops",
    ]);
  });

  it("is a dialog with a section per table, each column with its header's icon", async () => {
    const picker = await mount();
    picker.toggleAt(0, 0);
    await picker.updateComplete;

    expect(menu()?.getAttribute("role")).toBe("dialog");
    expect(menu()?.getAttribute("aria-label")).toBe(
      "leaderboard.configure_columns",
    );
    const sections = () => [
      ...(menu()?.querySelectorAll("[data-column-section]") ?? []),
    ];
    // One table: the section is named, but shows no title.
    expect(sections()[0].getAttribute("role")).toBe("group");
    expect(sections()[0].getAttribute("aria-label")).toBe(
      "leaderboard.players_table",
    );
    expect(sections()[0].textContent).not.toContain(
      "leaderboard.players_table",
    );
    for (const column of hideable) {
      const item = menu()?.querySelector(`[data-column="${column.id}"]`);
      expect(item?.textContent).toContain(column.labelKey);
      // A header drawn as a word (Type) has an icon of its own in the menu.
      const icon =
        column.headerVisual?.kind === "icon"
          ? column.headerVisual.icon
          : column.menuIcon;
      expect(item?.querySelector(`of-icon[name="${icon}"]`)).not.toBeNull();
    }

    // Two tables: each section shows its name as a title.
    picker.tables = ["player", "team"];
    await picker.updateComplete;
    expect(
      sections().map((section) => [
        section.getAttribute("aria-label"),
        section.textContent?.includes(section.getAttribute("aria-label")!),
      ]),
    ).toEqual([
      ["leaderboard.players_table", true],
      ["leaderboard.teams_table", true],
    ]);

    menu()
      ?.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')
      ?.click();
    await picker.updateComplete;
    expect(menu()).toBeNull();
  });

  it("names each group, and leaves out a group the table has no column for", async () => {
    const picker = await mount(["player", "team"]);
    picker.toggleAt(0, 0);
    await picker.updateComplete;

    const groups = (section: string) =>
      [
        ...(menu()?.querySelectorAll(
          `[data-column-section="${section}"] [role="group"]`,
        ) ?? []),
      ].map((group) => group.getAttribute("aria-label"));
    expect(groups("player")).toEqual([
      "leaderboard.group_identity",
      "leaderboard.group_economy",
      "leaderboard.group_units",
      "leaderboard.group_military",
      "leaderboard.group_diplomacy",
    ]);
    // Clan and type are player-table columns.
    expect(groups("team")).toEqual([
      "leaderboard.group_economy",
      "leaderboard.group_units",
      "leaderboard.group_military",
      "leaderboard.group_diplomacy",
    ]);
    const groupOf = (id: string) =>
      menu()
        ?.querySelector(`[data-column-section="player"] [data-column="${id}"]`)
        ?.closest('[role="group"]')
        ?.getAttribute("aria-label");
    expect(groupOf("allies")).toBe("leaderboard.group_diplomacy");
    expect(groupOf("betrayals")).toBe("leaderboard.group_diplomacy");
  });

  it("still lists a column that no group of the menu names", async () => {
    const added: ColumnDef = {
      ...columnById("gold"),
      id: "newColumn" as ColumnId,
      labelKey: "leaderboard.new_column",
    };
    (COLUMN_DEFS as ColumnDef[]).push(added);
    try {
      const picker = await mount();
      picker.toggleAt(0, 0);
      await picker.updateComplete;
      expect(
        menu()?.querySelector('[data-column="newColumn"] input'),
      ).not.toBeNull();
      expect(boxes("player")).toHaveLength(hideable.length + 1);
    } finally {
      (COLUMN_DEFS as ColumnDef[]).pop();
    }
  });

  it("opens and closes from a point or from a button", async () => {
    const picker = await mount();

    picker.toggleAt(10, 10);
    await picker.updateComplete;
    expect(menu()).not.toBeNull();
    picker.toggleAt(10, 10);
    await picker.updateComplete;
    expect(menu()).toBeNull();

    const button = document.createElement("button");
    holder.appendChild(button);
    picker.openFrom(button);
    await picker.updateComplete;
    expect(menu()).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    picker.openFrom(button);
    await picker.updateComplete;
    expect(menu()).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves focus to its first box when it opens", async () => {
    const picker = await mount();
    picker.toggleAt(0, 0);
    await picker.updateComplete;

    expect(document.activeElement).toBe(boxes("player")[0]);
  });

  it("closes on Escape, gives focus back to its button and keeps the key from the game", async () => {
    const picker = await mount();
    const button = document.createElement("button");
    holder.appendChild(button);
    button.focus();
    // Reached with the keyboard. jsdom guesses :focus-visible from the events
    // it has seen, so it is told.
    const matches = button.matches.bind(button);
    vi.spyOn(button, "matches").mockImplementation(
      (selector) => selector === ":focus-visible" || matches(selector),
    );
    picker.openFrom(button);
    await picker.updateComplete;
    const onWindow: string[] = [];
    const listen = (e: KeyboardEvent) => onWindow.push(e.key);
    window.addEventListener("keydown", listen);

    try {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await picker.updateComplete;
    } finally {
      window.removeEventListener("keydown", listen);
    }

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(onWindow).toEqual([]);

    // Its close button does the same.
    picker.openFrom(button);
    await picker.updateComplete;
    menu()
      ?.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')
      ?.click();
    await picker.updateComplete;
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes when focus leaves it, without taking focus back", async () => {
    const picker = await mount();
    const button = document.createElement("button");
    const elsewhere = document.createElement("button");
    holder.append(button, elsewhere);
    button.focus();
    picker.openFrom(button);
    await picker.updateComplete;

    elsewhere.focus();
    await picker.updateComplete;

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("closes on a press outside, but not inside, on its button or on a right-click on a header", async () => {
    const picker = await mount();
    const button = document.createElement("button");
    const header = document.createElement("div");
    header.className = "stats-table-header";
    holder.append(button, header);
    const press = (target: Element, button = 0) => {
      const event = new PointerEvent("pointerdown", {
        button,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };
    picker.openFrom(button);
    await picker.updateComplete;

    press(boxes("player")[0]);
    press(button);
    // The header's right-click toggles the menu itself, and must not take
    // focus on the way.
    expect(press(header, 2).defaultPrevented).toBe(true);
    await picker.updateComplete;
    expect(menu()).not.toBeNull();

    press(holder);
    await picker.updateComplete;
    expect(menu()).toBeNull();
  });

  it("leaves nothing focused when it was opened with nothing focused", async () => {
    const picker = await mount();
    picker.toggleAt(0, 0);
    await picker.updateComplete;
    expect(document.activeElement).toBe(boxes("player")[0]);

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await picker.updateComplete;

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("takes its menu away when it is removed", async () => {
    const picker = await mount();
    picker.toggleAt(0, 0);
    await picker.updateComplete;
    expect(menu()).not.toBeNull();

    holder.remove();
    expect(menu()).toBeNull();
  });
});
