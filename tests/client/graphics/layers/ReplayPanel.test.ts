/**
 * ReplayPanel: the speed buttons' change handler must update the selection
 * and broadcast a ReplaySpeedChangeEvent on the bus, and render() must gate
 * on visibility.
 */

vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReplaySpeedChangeEvent } from "../../../../src/client/InputHandler";
import { ReplayPanel } from "../../../../src/client/hud/layers/ReplayPanel";
import { ReplaySpeedMultiplier } from "../../../../src/client/utilities/ReplaySpeedMultiplier";

describe("ReplayPanel", () => {
  let panel: ReplayPanel;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    panel = new ReplayPanel();
    emit = vi.fn();
    panel.eventBus = { emit, on: vi.fn() } as any;
  });

  it("onReplaySpeedChange selects the speed and emits the change event", () => {
    panel.onReplaySpeedChange(ReplaySpeedMultiplier.fast);

    expect((panel as any)._replaySpeedMultiplier).toBe(
      ReplaySpeedMultiplier.fast,
    );
    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event).toBeInstanceOf(ReplaySpeedChangeEvent);
    expect(event.replaySpeedMultiplier).toBe(ReplaySpeedMultiplier.fast);
  });

  it("renders nothing while hidden and the speed grid once visible", () => {
    const hidden = panel.render() as unknown as { values: unknown[] };
    expect(hidden.values).toHaveLength(0);

    panel.visible = true;
    const rendered = panel.render() as unknown as { values: unknown[] };
    // Without a game (or with a non-replay one) the label is "game speed".
    expect(JSON.stringify(rendered)).toContain("replay_panel.game_speed");
    // One button per ReplaySpeedMultiplier member.
    expect(JSON.stringify(rendered).match(/<button/g)).toHaveLength(4);
  });

  it("clicking a speed button routes through onReplaySpeedChange", () => {
    panel.visible = true;
    const rendered = panel.render() as unknown as { values: unknown[] };

    // The mocked html tag stores each button's @click arrow in its template
    // values; collect them in document order and fire the slow (first) one.
    const clicks: (() => void)[] = [];
    const walk = (node: unknown) => {
      if (typeof node === "function") clicks.push(node as () => void);
      else if (node && typeof node === "object")
        for (const v of Object.values(node)) walk(v);
    };
    rendered.values.forEach(walk);
    // One contextmenu handler on the container plus four button clicks.
    expect(clicks.length).toBe(5);
    clicks[1]();

    const event = emit.mock.calls[0][0];
    expect(event).toBeInstanceOf(ReplaySpeedChangeEvent);
    expect(event.replaySpeedMultiplier).toBe(ReplaySpeedMultiplier.slow);
  });
});
