import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Side-effect import: the @customElement decorator registers <control-panel>
// when the module is evaluated, and a type-only reference would not evaluate it.
import { EventBus } from "@openfront/shared/EventBus";
import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import { FORWARDED_CLICK } from "../../src/client/InputHandler";
import type { UIState } from "../../src/client/UIState";
import { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

// ControlPanel caches the attack ratio for the lifetime of the game. The
// settings modal is reachable mid-match now, so the cached value has to follow
// the stored one.
describe("control-panel attack ratio", () => {
  let panel: ControlPanel;
  let uiState: UIState;

  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    // UserSettings' cache is static and survives localStorage.clear().
    new UserSettings().setAttackRatio(0.2);

    panel = document.createElement("control-panel") as ControlPanel;
    uiState = { attackRatio: 0 } as UIState;
    panel.uiState = uiState;
    panel.eventBus = new EventBus();
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => null,
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
  });

  afterEach(() => {
    panel.remove();
  });

  it("follows the attack ratio when the settings modal changes it", () => {
    expect(uiState.attackRatio).toBeCloseTo(0.2);

    new UserSettings().setAttackRatio(0.55);

    expect(uiState.attackRatio).toBeCloseTo(0.55);
  });

  it("stops listening once the panel is gone", () => {
    panel.remove();

    new UserSettings().setAttackRatio(0.75);

    expect(uiState.attackRatio).toBeCloseTo(0.2);
  });

  it("shows the percentage and the troops it sends", async () => {
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true, troops: () => 100_000 }),
    } as unknown as GameView;

    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const label = panel.querySelector("[data-attack-ratio-label]");
    expect(label?.textContent).toContain("20%");
    expect(label?.textContent).toContain("2.00K");
    expect(label?.textContent).not.toContain("(");
    expect(label?.textContent).not.toContain("control_panel.attack_ratio");
  });

  it("has one slider", async () => {
    panel.setVisibile(true);
    await (panel as any).updateComplete;

    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(1);
  });

  it("names the slider and reads its value as a percentage", async () => {
    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const slider = panel.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider.getAttribute("aria-label")).toBe(
      "user_setting.attack_ratio_label",
    );
    expect(slider.getAttribute("aria-valuetext")).toBe("20%");

    slider.value = "65";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await (panel as any).updateComplete;

    expect(slider.getAttribute("aria-valuetext")).toBe("65%");
  });

  it("uses the translated string when it interpolates percent", async () => {
    const langSelector = document.createElement("lang-selector") as any;
    langSelector.translations = {
      "control_panel.attack_ratio": "{percent}% ({troops})",
    };
    document.body.appendChild(langSelector);

    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true, troops: () => 100_000 }),
    } as unknown as GameView;
    new UserSettings().setAttackRatio(0.5);

    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const label = panel.querySelector("[data-attack-ratio-label]");
    expect(label?.textContent).toContain("50% (5.00K)");

    langSelector.remove();
  });

  it("falls back to formatted percent and troop count if translation does not include percent", async () => {
    const langSelector = document.createElement("lang-selector") as any;
    langSelector.translations = {
      "control_panel.attack_ratio": "Rapporto di Attacco",
    };
    document.body.appendChild(langSelector);

    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true, troops: () => 100_000 }),
    } as unknown as GameView;
    new UserSettings().setAttackRatio(0.5);

    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const label = panel.querySelector("[data-attack-ratio-label]");
    expect(label?.textContent).toContain("50%");
    expect(label?.textContent).toContain("5.00K");
    expect(label?.textContent).not.toContain("Rapporto di Attacco");

    langSelector.remove();
  });

  it("falls back when only the troop count matches the percent", async () => {
    const langSelector = document.createElement("lang-selector") as any;
    langSelector.translations = {
      "control_panel.attack_ratio": "Send {troops} troops",
    };
    document.body.appendChild(langSelector);

    // 20% of 100K troops is 20.0K: "20" is in the translation, the percent is not.
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true, troops: () => 1_000_000 }),
    } as unknown as GameView;

    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const label = panel.querySelector("[data-attack-ratio-label]");
    expect(label?.textContent).toContain("20%");
    expect(label?.textContent).toContain("20.0K");
    expect(label?.textContent).not.toContain("Send");

    langSelector.remove();
  });

  // <control-panel> sits in index.html, so its (hidden) slider exists on the
  // lobby page before any game has handed it a uiState.
  it("ignores ratio changes before init() has run", () => {
    const fresh = document.createElement("control-panel") as ControlPanel;
    document.body.appendChild(fresh);

    expect(() => fresh.onAttackRatioChange(0.3)).not.toThrow();

    fresh.remove();
  });

  it("moves the slider when the radial menu forwards a tap to it", async () => {
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true, troops: () => 100_000 }),
    } as unknown as GameView;
    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const slider = panel.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider.hasAttribute("data-radial-click-through")).toBe(true);
    // The thumb's centre travels the track: 8 to 92 on a 100 px slider.
    const track = panel.querySelector("[data-ratio-track]") as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 8, width: 84 }) as DOMRect;

    // A forwarded tap is the click the radial menu's overlay sends down.
    const tap = (clientX: number) => {
      const forwarded = new MouseEvent("click", { bubbles: true, clientX });
      (forwarded as unknown as Record<string, unknown>)[FORWARDED_CLICK] = true;
      slider.dispatchEvent(forwarded);
      return Number(slider.value);
    };

    expect(tap(50)).toBe(51);
    expect(uiState.attackRatio).toBeCloseTo(0.51, 2);
    // A tap on the thumb at either end keeps it there.
    expect(tap(8)).toBe(1);
    expect(tap(92)).toBe(100);
    // Past the thumb, at the slider's very edge, is still the end.
    expect(tap(2)).toBe(1);
    expect(tap(98)).toBe(100);
  });

  it("leaves a real slider press to the browser", async () => {
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true, troops: () => 100_000 }),
    } as unknown as GameView;
    panel.setVisibile(true);
    await (panel as any).updateComplete;

    const slider = panel.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    slider.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

    // A plain click is a press the browser handles itself.
    slider.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 50 }),
    );

    expect(Number(slider.value)).toBe(20);
    expect(uiState.attackRatio).toBeCloseTo(0.2, 2);
  });
});
