import { describe, expect, it } from "vitest";
import { MessageType } from "../../../../src/core/game/Game";
import { GameEvent } from "../../../../src/client/graphics/layers/EventsDisplay";
import { splitAllianceEvents } from "../../../../src/client/graphics/layers/AllianceDisplay";

const dummyButtons = [
  { text: "Accept", className: "btn", action: () => {} },
  { text: "Reject", className: "btn-info", action: () => {} },
];

function makeEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    description: "test event",
    type: MessageType.ATTACK_FAILED,
    createdAt: 100,
    ...overrides,
  } as GameEvent;
}

describe("splitAllianceEvents", () => {
  it("should pin ALLIANCE_REQUEST events that have buttons", () => {
    const events = [
      makeEvent({
        type: MessageType.ALLIANCE_REQUEST,
        buttons: dummyButtons,
      }),
      makeEvent({ type: MessageType.ATTACK_FAILED }),
    ];

    const { pinnedEvents, infoEvents } = splitAllianceEvents(events);

    expect(pinnedEvents).toHaveLength(1);
    expect(pinnedEvents[0].type).toBe(MessageType.ALLIANCE_REQUEST);
    expect(infoEvents).toHaveLength(1);
    expect(infoEvents[0].type).toBe(MessageType.ATTACK_FAILED);
  });

  it("should pin RENEW_ALLIANCE events that have buttons", () => {
    const events = [
      makeEvent({
        type: MessageType.RENEW_ALLIANCE,
        buttons: dummyButtons,
      }),
      makeEvent({ type: MessageType.CHAT }),
    ];

    const { pinnedEvents, infoEvents } = splitAllianceEvents(events);

    expect(pinnedEvents).toHaveLength(1);
    expect(pinnedEvents[0].type).toBe(MessageType.RENEW_ALLIANCE);
    expect(infoEvents).toHaveLength(1);
    expect(infoEvents[0].type).toBe(MessageType.CHAT);
  });

  it("should NOT pin alliance events without buttons", () => {
    const events = [
      makeEvent({ type: MessageType.ALLIANCE_REQUEST }),
      makeEvent({ type: MessageType.RENEW_ALLIANCE, buttons: [] }),
      makeEvent({ type: MessageType.ALLIANCE_ACCEPTED }),
    ];

    const { pinnedEvents, infoEvents } = splitAllianceEvents(events);

    expect(pinnedEvents).toHaveLength(0);
    expect(infoEvents).toHaveLength(3);
  });

  it("should NOT pin non-alliance events even if they have buttons", () => {
    const events = [
      makeEvent({
        type: MessageType.ALLIANCE_BROKEN,
        buttons: dummyButtons,
      }),
    ];

    const { pinnedEvents, infoEvents } = splitAllianceEvents(events);

    expect(pinnedEvents).toHaveLength(0);
    expect(infoEvents).toHaveLength(1);
  });

  it("should sort pinned events oldest-first by createdAt", () => {
    const events = [
      makeEvent({
        type: MessageType.ALLIANCE_REQUEST,
        buttons: dummyButtons,
        description: "newer",
        createdAt: 200,
      }),
      makeEvent({
        type: MessageType.RENEW_ALLIANCE,
        buttons: dummyButtons,
        description: "older",
        createdAt: 50,
      }),
    ];

    const { pinnedEvents } = splitAllianceEvents(events);

    expect(pinnedEvents.map((e) => e.description)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("should handle an empty events list", () => {
    const { pinnedEvents, infoEvents } = splitAllianceEvents([]);

    expect(pinnedEvents).toHaveLength(0);
    expect(infoEvents).toHaveLength(0);
  });

  it("should pin multiple alliance events simultaneously", () => {
    const events = [
      makeEvent({
        type: MessageType.ALLIANCE_REQUEST,
        buttons: dummyButtons,
        description: "request 1",
      }),
      makeEvent({
        type: MessageType.RENEW_ALLIANCE,
        buttons: dummyButtons,
        description: "renew 1",
      }),
      makeEvent({
        type: MessageType.ALLIANCE_REQUEST,
        buttons: dummyButtons,
        description: "request 2",
      }),
      makeEvent({ type: MessageType.ALLIANCE_EXPIRED, description: "expired" }),
    ];

    const { pinnedEvents, infoEvents } = splitAllianceEvents(events);

    expect(pinnedEvents).toHaveLength(3);
    expect(infoEvents).toHaveLength(1);
    expect(infoEvents[0].description).toBe("expired");
  });
});
