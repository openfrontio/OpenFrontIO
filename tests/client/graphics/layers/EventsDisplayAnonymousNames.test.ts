/**
 * A DisplayEvent's params.name is always the subject's real name, because
 * the core simulation is identical for every client and has no notion of
 * the Anonymous Names setting. When a message identifies its subject via
 * focusPlayerID, EventsDisplay must re-resolve the name through this
 * viewer's own PlayerView (which does respect Anonymous Names) instead of
 * trusting the raw baked string - otherwise messages like "X conquered you"
 * leak X's real name even with Anonymous Names turned on.
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
  query: () => () => {},
}));

vi.mock("lit/directive.js", () => ({}));
vi.mock("lit/directives/unsafe-html.js", () => ({
  unsafeHTML: (s: string) => s,
}));

vi.mock("../../../../src/client/Utils", () => ({
  // Echo back whatever name ended up in params so the test can assert on it
  // directly, without needing real translation strings.
  translateText: vi.fn(
    (key: string, params?: Record<string, string | number>) =>
      params?.name !== undefined ? String(params.name) : key,
  ),
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
  getMessageTypeClasses: vi.fn(() => ""),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsDisplay } from "../../../../src/client/hud/layers/EventsDisplay";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

describe("EventsDisplay resolves player names via focusPlayerID", () => {
  let ed: EventsDisplay;
  const myPlayer = { smallID: () => 1, displayName: () => "Me" };
  // What THIS viewer should see for player 2 - e.g. an Anonymous Names
  // codename when that setting is on, distinct from whatever real name the
  // simulation baked into the raw update.
  const subject = { smallID: () => 2, displayName: () => "Silent Falcon" };

  beforeEach(() => {
    ed = new EventsDisplay();
    (ed as unknown as { game: unknown }).game = {
      myPlayer: () => myPlayer,
      playerBySmallID: (id: number) =>
        id === 2
          ? { ...subject, isPlayer: () => true }
          : { isPlayer: () => false },
      unit: () => undefined,
      ticks: () => 0,
    };
  });

  it("substitutes the viewer's own resolved name when focusPlayerID is set", () => {
    ed.onDisplayMessageEvent({
      type: GameUpdateType.DisplayEvent,
      message: "events_display.conquered_no_gold",
      messageType: 0,
      playerID: 1,
      params: { name: "RealName" }, // raw name baked in by the simulation
      focusPlayerID: 2,
    } as never);

    const events = (ed as unknown as { events: { description: string }[] })
      .events;
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("Silent Falcon");
    expect(events[0].description).not.toBe("RealName");
  });

  it("falls back to the raw params when focusPlayerID is absent", () => {
    ed.onDisplayMessageEvent({
      type: GameUpdateType.DisplayEvent,
      message: "events_display.some_other_message",
      messageType: 0,
      playerID: 1,
      params: { name: "RealName" },
    } as never);

    const events = (ed as unknown as { events: { description: string }[] })
      .events;
    expect(events[0].description).toBe("RealName");
  });

  it("falls back to the raw params when focusPlayerID doesn't resolve to a player", () => {
    ed.onDisplayMessageEvent({
      type: GameUpdateType.DisplayEvent,
      message: "events_display.conquered_no_gold",
      messageType: 0,
      playerID: 1,
      params: { name: "RealName" },
      focusPlayerID: 999, // resolves to TerraNullius via the mock above
    } as never);

    const events = (ed as unknown as { events: { description: string }[] })
      .events;
    expect(events[0].description).toBe("RealName");
  });
});
