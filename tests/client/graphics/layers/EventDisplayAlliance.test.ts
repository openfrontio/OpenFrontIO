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

import { DioxusEventsDisplay } from "../../../../src/client/graphics/layers/AdvancedLayerBridges";
import { MessageType } from "../../../../src/core/game/Game";

describe("EventsDisplay - alliance renewal cleanup (allianceID based)", () => {
  function makeRenewal(
    allianceID: number,
    focusID: number,
    description = "Alliance about to expire",
  ) {
    return {
      description,
      type: MessageType.RENEW_ALLIANCE,
      allianceID,
      focusID,
      createdAt: 0,
    };
  }

  test("removes ONLY renewal events for the broken alliance", () => {
    const display = new DioxusEventsDisplay();

    const allianceAB = 1;
    const allianceAC = 2;
    const allianceBC = 3;

    (display as any).events = [
      makeRenewal(allianceAB, 1), // A–B
      makeRenewal(allianceAC, 1), // A–C
      makeRenewal(allianceBC, 2), // B–C
    ];

    // Break alliance A–B
    (display as any).removeAllianceRenewalEvents(allianceAB);

    const remaining = (display as any).events;

    // A–B renewal removed
    expect(remaining.some((e: any) => e.allianceID === allianceAB)).toBe(false);

    // Other alliances untouched
    expect(remaining.some((e: any) => e.allianceID === allianceAC)).toBe(true);

    expect(remaining.some((e: any) => e.allianceID === allianceBC)).toBe(true);
  });

  test("does NOT remove renewals just because the same player is involved", () => {
    const display = new DioxusEventsDisplay();

    const allianceAB = 10;
    const allianceAC = 11;

    (display as any).events = [
      makeRenewal(allianceAB, 1), // Player 1 involved
      makeRenewal(allianceAC, 1), // Same player, different alliance
    ];

    (display as any).removeAllianceRenewalEvents(allianceAB);

    const remaining = (display as any).events;

    expect(remaining.length).toBe(1);
    expect(remaining[0].allianceID).toBe(allianceAC);
  });

  test("breaking one alliance does not affect renewals between other players", () => {
    const display = new DioxusEventsDisplay();

    const allianceAB = 100;
    const allianceCD = 200;

    (display as any).events = [
      makeRenewal(allianceAB, 1), // A–B
      makeRenewal(allianceCD, 3), // C–D
    ];

    (display as any).removeAllianceRenewalEvents(allianceAB);

    const remaining = (display as any).events;

    expect(remaining.length).toBe(1);
    expect(remaining[0].allianceID).toBe(allianceCD);
  });

  test("does not affect non-RENEW_ALLIANCE events", () => {
    const display = new DioxusEventsDisplay();

    (display as any).events = [
      {
        description: "Alliance broken",
        type: MessageType.ALLIANCE_BROKEN,
        createdAt: 0,
      },
      {
        description: "Alliance accepted",
        type: MessageType.ALLIANCE_ACCEPTED,
        createdAt: 0,
      },
      {
        description: "Renewal",
        type: MessageType.RENEW_ALLIANCE,
        allianceID: 999,
        createdAt: 0,
      },
    ];

    (display as any).removeAllianceRenewalEvents(999);

    const remaining = (display as any).events;

    expect(
      remaining.some((e: any) => e.type === MessageType.ALLIANCE_BROKEN),
    ).toBe(true);

    expect(
      remaining.some((e: any) => e.type === MessageType.ALLIANCE_ACCEPTED),
    ).toBe(true);

    expect(
      remaining.some((e: any) => e.type === MessageType.RENEW_ALLIANCE),
    ).toBe(false);
  });
});
