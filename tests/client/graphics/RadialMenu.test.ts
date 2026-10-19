import { EventBus } from "@openfront/shared/EventBus";
import { selectAll } from "d3";
import { UserSettings } from "../../../src/client/UserSettings";
import { RadialMenu } from "../../../src/client/hud/layers/RadialMenu";
import type {
  MenuElement,
  MenuElementParams,
} from "../../../src/client/hud/layers/RadialMenuElements";

describe("RadialMenu tooltip refresh", () => {
  beforeEach(() => {
    new UserSettings().removeCached("settings.preventNuclearBetrayal", false);
  });

  afterEach(() => {
    selectAll("*").interrupt();
    new UserSettings().removeCached("settings.preventNuclearBetrayal", false);
  });

  it("updates a hovered strike without a game tick and stops listening when hidden", () => {
    const settings = new UserSettings();
    const strike: MenuElement = {
      id: "atom-bomb",
      name: "Atom Bomb",
      disabled: () => settings.preventNuclearBetrayal(),
      get tooltipItems() {
        return [
          {
            text: settings.preventNuclearBetrayal()
              ? "Blocked: betrayal"
              : "Launch atom bomb",
            className: "description",
          },
        ];
      },
    };
    const menu = new RadialMenu(
      new EventBus(),
      {
        id: "root",
        name: "root",
        disabled: () => false,
        subMenu: () => [strike],
      },
      { disabled: () => true, action: () => {} },
    );
    menu.init();
    menu.setParams({
      game: { inSpawnPhase: () => false },
    } as MenuElementParams);
    menu.showRadialMenu(200, 200);

    const path = document.querySelector<SVGPathElement>(
      'path[data-id="atom-bomb"]',
    )!;
    const tooltip = document.querySelector<HTMLDivElement>(".radial-tooltip")!;
    path.dispatchEvent(new MouseEvent("mouseover"));
    expect(tooltip.textContent).toBe("Launch atom bomb");

    settings.togglePreventNuclearBetrayal();
    expect(tooltip.textContent).toBe("Blocked: betrayal");
    expect(path.style.cursor).toBe("not-allowed");
    settings.togglePreventNuclearBetrayal();
    expect(tooltip.textContent).toBe("Launch atom bomb");
    expect(path.style.cursor).toBe("pointer");

    path.dispatchEvent(new MouseEvent("mouseout"));
    menu.refresh();
    expect(tooltip.style.display).toBe("none");

    path.dispatchEvent(new MouseEvent("mouseover"));
    menu.hideRadialMenu();
    menu.refresh();
    expect(tooltip.style.display).toBe("none");

    const refresh = vi.spyOn(menu, "refresh");
    settings.togglePreventNuclearBetrayal();
    expect(refresh).not.toHaveBeenCalled();
  });
});
