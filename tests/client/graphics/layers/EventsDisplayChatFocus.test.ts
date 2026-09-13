/**
 * A quick-chat entry in the events feed must carry the other party's smallID
 * as focusID, so clicking it moves the camera to them (#5101). The feed
 * already renders any event with a focusID as a button that emits
 * GoToPlayerEvent; chat was the one entry type not filling it in.
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
  translateText: vi.fn((key: string) => key),
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
  getMessageTypeClasses: vi.fn(() => ""),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsDisplay } from "../../../../src/client/hud/layers/EventsDisplay";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

describe("EventsDisplay chat focus (#5101)", () => {
  let ed: EventsDisplay;
  const myPlayer = { smallID: () => 1, displayName: () => "Me" };
  const other = { smallID: () => 2, displayName: () => "Bob" };

  beforeEach(() => {
    ed = new EventsDisplay();
    (ed as unknown as { game: unknown }).game = {
      myPlayer: () => myPlayer,
      player: (id: string) => (id === "bob" ? other : myPlayer),
      ticks: () => 0,
    };
    (ed as unknown as { eventBus: unknown }).eventBus = { emit: vi.fn() };
  });

  const chatUpdate = (isFrom: boolean) => ({
    type: GameUpdateType.DisplayChatEvent,
    key: "help",
    category: "help",
    target: undefined,
    playerID: 1,
    isFrom,
    recipient: "bob",
  });

  it("focuses the sender of a received message", () => {
    ed.onDisplayChatEvent(chatUpdate(true) as never);
    const events = (ed as unknown as { events: { focusID?: number }[] }).events;
    expect(events).toHaveLength(1);
    expect(events[0].focusID).toBe(2);
  });

  it("focuses the recipient of a sent message", () => {
    ed.onDisplayChatEvent(chatUpdate(false) as never);
    const events = (ed as unknown as { events: { focusID?: number }[] }).events;
    expect(events[0].focusID).toBe(2);
  });
});
