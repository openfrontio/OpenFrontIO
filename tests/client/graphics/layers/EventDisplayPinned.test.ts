vi.mock("lit", () => ({
  html: () => {},
  LitElement: class {},
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: any) => clazz,
  query: () => () => {},
  state: () => () => {},
  property: () => () => {},
}));

vi.mock("lit/directive.js", () => ({
  DirectiveResult: class {},
}));

vi.mock("lit/directives/unsafe-html.js", () => ({
  unsafeHTML: () => {},
  UnsafeHTMLDirective: class {},
}));

import { EventsDisplay } from "../../../../src/client/graphics/layers/EventsDisplay";
import { MessageType } from "../../../../src/core/game/Game";

describe("EventsDisplay - pinned events retention", () => {
  const makeGameStub = (ticks: number) =>
    ({
      ticks: () => ticks,
      inSpawnPhase: () => false,
      updatesSinceLastTick: () => null,
      config: () => ({
        allianceExtensionPromptOffset: () => 0,
      }),
      myPlayer: () => ({
        isAlive: () => true,
        alliances: () => [],
        incomingAttacks: () => [],
        outgoingAttacks: () => [],
        units: () => [],
      }),
    }) as any;

  const makeDisplayWithGame = (ticks: number) => {
    const display = new EventsDisplay();
    display.game = makeGameStub(ticks);
    (display as any).requestUpdate = () => {};
    return display;
  };

  test("keeps pinned events while dropping expired unpinned ones", () => {
    const display = makeDisplayWithGame(1000);

    (display as any).pinAllianceEvents = true;
    (display as any).events = [
      {
        description: "Pinned alliance request",
        type: MessageType.ALLIANCE_REQUEST,
        createdAt: 0,
        duration: 10,
        pinned: true,
      },
      {
        description: "Expired unpinned",
        type: MessageType.ALLIANCE_ACCEPTED,
        createdAt: 0,
        duration: 10,
      },
      {
        description: "Also expired unpinned",
        type: MessageType.ALLIANCE_BROKEN,
        createdAt: 0,
        duration: 10,
      },
    ];

    display.tick();

    const remaining = (display as any).events;
    expect(remaining.length).toBe(1);
    expect(remaining[0].description).toBe("Pinned alliance request");
  });

  test("drops pinned events when pinning is disabled", () => {
    const display = makeDisplayWithGame(1000);

    (display as any).pinAllianceEvents = false;
    (display as any).events = [
      {
        description: "Pinned alliance request",
        type: MessageType.ALLIANCE_REQUEST,
        createdAt: 0,
        duration: 10,
        pinned: true,
      },
      {
        description: "Pinned renewal",
        type: MessageType.RENEW_ALLIANCE,
        createdAt: 0,
        duration: 10,
        pinned: true,
      },
    ];

    display.tick();

    const remaining = (display as any).events;
    expect(remaining.length).toBe(0);
  });

  test("reorders pinned events when the pin toggle changes", () => {
    const display = makeDisplayWithGame(10);
    const events = [
      {
        description: "Unpinned early",
        type: MessageType.ALLIANCE_ACCEPTED,
        createdAt: 1,
      },
      {
        description: "Pinned middle",
        type: MessageType.ALLIANCE_REQUEST,
        createdAt: 2,
        pinned: true,
      },
      {
        description: "Unpinned late",
        type: MessageType.ALLIANCE_BROKEN,
        createdAt: 3,
      },
    ];

    (display as any).pinAllianceEvents = true;
    const pinnedOrder = (display as any).sortEvents(events);
    expect(pinnedOrder.map((e: any) => e.description)).toEqual([
      "Unpinned early",
      "Unpinned late",
      "Pinned middle",
    ]);

    (display as any).pinAllianceEvents = false;
    const unpinnedOrder = (display as any).sortEvents(events);
    expect(unpinnedOrder.map((e: any) => e.description)).toEqual([
      "Unpinned early",
      "Pinned middle",
      "Unpinned late",
    ]);
  });
});
