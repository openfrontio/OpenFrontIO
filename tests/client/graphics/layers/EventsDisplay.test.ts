import { describe, expect, it } from "vitest";
import { MessageType } from "../../../../src/core/game/Game";
import {
  GameEvent,
  splitAndSortEvents,
} from "../../../../src/client/graphics/layers/EventsDisplay";

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

describe("splitAndSortEvents", () => {
  it("should pin ALLIANCE_REQUEST events that have buttons", () => {
    const events = [
      makeEvent({
        type: MessageType.ALLIANCE_REQUEST,
        buttons: dummyButtons,
      }),
      makeEvent({ type: MessageType.ATTACK_FAILED }),
    ];

    const { pinnedEvents, regularEvents } = splitAndSortEvents(events);

    expect(pinnedEvents).toHaveLength(1);
    expect(pinnedEvents[0].type).toBe(MessageType.ALLIANCE_REQUEST);
    expect(regularEvents).toHaveLength(1);
    expect(regularEvents[0].type).toBe(MessageType.ATTACK_FAILED);
  });

  it("should pin RENEW_ALLIANCE events that have buttons", () => {
    const events = [
      makeEvent({
        type: MessageType.RENEW_ALLIANCE,
        buttons: dummyButtons,
      }),
      makeEvent({ type: MessageType.CHAT }),
    ];

    const { pinnedEvents, regularEvents } = splitAndSortEvents(events);

    expect(pinnedEvents).toHaveLength(1);
    expect(pinnedEvents[0].type).toBe(MessageType.RENEW_ALLIANCE);
    expect(regularEvents).toHaveLength(1);
    expect(regularEvents[0].type).toBe(MessageType.CHAT);
  });

  it("should NOT pin alliance events without buttons", () => {
    const events = [
      makeEvent({ type: MessageType.ALLIANCE_REQUEST }),
      makeEvent({ type: MessageType.RENEW_ALLIANCE, buttons: [] }),
      makeEvent({ type: MessageType.ALLIANCE_ACCEPTED }),
    ];

    const { pinnedEvents, regularEvents } = splitAndSortEvents(events);

    expect(pinnedEvents).toHaveLength(0);
    expect(regularEvents).toHaveLength(3);
  });

  it("should NOT pin non-alliance events even if they have buttons", () => {
    const events = [
      makeEvent({
        type: MessageType.ALLIANCE_BROKEN,
        buttons: dummyButtons,
      }),
    ];

    const { pinnedEvents, regularEvents } = splitAndSortEvents(events);

    expect(pinnedEvents).toHaveLength(0);
    expect(regularEvents).toHaveLength(1);
  });

  it("should sort regular events by priority (descending) then createdAt", () => {
    const events = [
      makeEvent({ description: "low-prio-early", priority: 0, createdAt: 1 }),
      makeEvent({ description: "high-prio", priority: 100, createdAt: 5 }),
      makeEvent({ description: "low-prio-late", priority: 0, createdAt: 10 }),
      makeEvent({ description: "default-prio", createdAt: 3 }),
    ];

    const { regularEvents } = splitAndSortEvents(events);

    // default priority (100000) > 100 > 0 – descending
    expect(regularEvents.map((e) => e.description)).toEqual([
      "default-prio",
      "high-prio",
      "low-prio-early",
      "low-prio-late",
    ]);
  });

  it("should handle an empty events list", () => {
    const { pinnedEvents, regularEvents } = splitAndSortEvents([]);

    expect(pinnedEvents).toHaveLength(0);
    expect(regularEvents).toHaveLength(0);
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
      makeEvent({ type: MessageType.CHAT, description: "chat msg" }),
    ];

    const { pinnedEvents, regularEvents } = splitAndSortEvents(events);

    expect(pinnedEvents).toHaveLength(3);
    expect(regularEvents).toHaveLength(1);
    expect(regularEvents[0].description).toBe("chat msg");
  });
});
