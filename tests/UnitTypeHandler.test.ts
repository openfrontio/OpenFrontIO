import { render } from "lit";
import { renderUnitTypeOptions } from "../src/client/handlers/UnitTypeHandler";
import { UnitType } from "../src/core/game/Game";

describe("renderUnitTypeOptions (raw DOM)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container.innerHTML = "";
  });

  test("renders checkboxes for all unit types", () => {
    const toggleUnit = jest.fn();
    render(renderUnitTypeOptions({ disabledUnits: [], toggleUnit }), container);

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(9); // Expecting 9 checkboxes rendered
  });

  test("invokes toggleUnit when checkbox clicked", () => {
    const toggleUnit = jest.fn();
    render(renderUnitTypeOptions({ disabledUnits: [], toggleUnit }), container);

    const warshipInput = Array.from(container.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("unit_type.warship"))!
      .querySelector("input") as HTMLInputElement;

    warshipInput.click();
    warshipInput.dispatchEvent(new Event("change"));

    expect(toggleUnit).toHaveBeenCalledWith(UnitType.Warship, true);
  });
});
