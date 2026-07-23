import { ColumnPicker } from "../src/client/hud/layers/ColumnPicker";
import { COLUMN_DEFS } from "../src/client/hud/layers/lib/StatsColumns";
import type { ColumnId } from "../src/client/StatsConstants";

describe("ColumnPicker", () => {
  it("renders its popup outside the sidebar overflow container", async () => {
    const sidebar = document.createElement("div");
    const picker = new ColumnPicker();
    picker.columns = COLUMN_DEFS;
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
      COLUMN_DEFS.length,
    );

    let selection: readonly ColumnId[] | null = null;
    picker.addEventListener("columns-changed", (event) => {
      selection = (event as CustomEvent<ColumnId[]>).detail;
    });
    (popup?.querySelectorAll("input")[1] as HTMLInputElement).click();
    expect(selection).toEqual(["tiles", "gold"]);

    sidebar.remove();
    expect(document.body.querySelector(".column-picker-popover")).toBeNull();
  });
});
