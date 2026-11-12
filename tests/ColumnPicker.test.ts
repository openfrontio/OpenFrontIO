// @vitest-environment jsdom
import { ColumnPicker } from "../src/client/hud/layers/ColumnPicker";
import { columnsFor } from "../src/client/hud/layers/lib/StatsColumns";
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
      boxes(section).find(
        (box) =>
          box.closest("label")?.textContent?.trim() === "leaderboard.gold",
      ) as HTMLInputElement;

    goldBox("team").click();
    expect(settings.statsColumns("team")).toEqual(["tiles", "maxtroops"]);
    expect(settings.statsColumns("player")).toEqual([
      "tiles",
      "gold",
      "maxtroops",
    ]);
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

  it("closes on a click outside, but not on a click inside", async () => {
    const picker = await mount();
    picker.toggleAt(0, 0);
    await picker.updateComplete;

    boxes("player")[0].click();
    await picker.updateComplete;
    expect(menu()).not.toBeNull();

    holder.click();
    await picker.updateComplete;
    expect(menu()).toBeNull();
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
