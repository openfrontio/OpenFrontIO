import { ColumnPicker } from "../src/client/hud/layers/ColumnPicker";
import { columnsFor } from "../src/client/hud/layers/lib/StatsColumns";
import type { ColumnId } from "../src/client/StatsConstants";

// The menu only ever lists hideable columns; rank and player always render.
const hideable = columnsFor("player").filter((column) => column.isHideable);

describe("ColumnPicker", () => {
  it("renders its popup outside the sidebar overflow container", async () => {
    const sidebar = document.createElement("div");
    const picker = new ColumnPicker();
    picker.columns = hideable;
    picker.selected = ["tiles"];
    sidebar.appendChild(picker);
    document.body.appendChild(sidebar);
    await picker.updateComplete;

    picker.querySelector("button")?.click();
    await picker.updateComplete;

    const popup = document.body.querySelector(".column-picker-popover");
    expect(popup).not.toBeNull();
    expect(sidebar.contains(popup)).toBe(false);
    expect(popup?.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      hideable.length,
    );
    expect(hideable.map((column) => column.id)).not.toContain("rank");
    expect(hideable.map((column) => column.id)).not.toContain("player");

    let selection: readonly ColumnId[] | null = null;
    picker.addEventListener("columns-changed", (event) => {
      selection = (event as CustomEvent<ColumnId[]>).detail;
    });
    // Registry order, so index 0 is the clan column and 2 is gold.
    (popup?.querySelectorAll("input")[2] as HTMLInputElement).click();
    expect(selection).toEqual(["tiles", "gold"]);

    (popup?.querySelectorAll("input")[0] as HTMLInputElement).click();
    expect(selection).toEqual(["clan", "tiles"]);

    sidebar.remove();
    expect(document.body.querySelector(".column-picker-popover")).toBeNull();
  });
});
