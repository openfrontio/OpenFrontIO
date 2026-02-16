import { describe, expect, it, vi } from "vitest";
import { EventsDisplay } from "../../../../src/client/graphics/layers/EventsDisplay";
import { MessageType } from "../../../../src/core/game/Game";

describe("EventsDisplay alliance informational handlers", () => {
  it("creates accepted/rejected alliance status events for requestor", () => {
    const addEvent = vi.fn();
    const fakeThis = {
      addEvent,
      game: {
        ticks: () => 123,
        myPlayer: () => ({ smallID: () => 7 }),
        playerBySmallID: () => ({ name: () => "Other" }),
      },
    } as any;

    EventsDisplay.prototype.onAllianceRequestReplyEvent.call(fakeThis, {
      accepted: true,
      request: { requestorID: 7, recipientID: 9 },
    } as any);

    expect(addEvent).toHaveBeenCalledOnce();
    expect(addEvent.mock.calls[0][0].type).toBe(MessageType.ALLIANCE_ACCEPTED);
  });

  it("creates betrayed event with focus button for betrayed player", () => {
    const addEvent = vi.fn();
    const betrayedPlayer = {
      isDisconnected: () => false,
      isTraitor: () => false,
    };
    const myPlayer = betrayedPlayer;
    const traitorPlayer = { name: () => "Traitor" };

    const fakeThis = {
      addEvent,
      eventBus: { emit: vi.fn() },
      game: {
        ticks: () => 50,
        myPlayer: () => myPlayer,
        playerBySmallID: (id: number) =>
          id === 1 ? betrayedPlayer : traitorPlayer,
        config: () => ({
          traitorDefenseDebuff: () => 0.5,
          traitorDuration: () => 30,
        }),
      },
    } as any;

    EventsDisplay.prototype.onBrokeAllianceEvent.call(fakeThis, {
      betrayedID: 1,
      traitorID: 2,
    } as any);

    expect(addEvent).toHaveBeenCalledOnce();
    expect(addEvent.mock.calls[0][0].type).toBe(MessageType.ALLIANCE_BROKEN);
    expect(addEvent.mock.calls[0][0].buttons).toHaveLength(1);
  });

  it("creates alliance expired event for involved alive player", () => {
    const addEvent = vi.fn();
    const myPlayer = { smallID: () => 3, isAlive: () => true };
    const otherPlayer = { isAlive: () => true, name: () => "Ally" };

    const fakeThis = {
      addEvent,
      game: {
        ticks: () => 88,
        myPlayer: () => myPlayer,
        playerBySmallID: () => otherPlayer,
      },
    } as any;

    EventsDisplay.prototype.onAllianceExpiredEvent.call(fakeThis, {
      player1ID: 3,
      player2ID: 9,
    } as any);

    expect(addEvent).toHaveBeenCalledOnce();
    expect(addEvent.mock.calls[0][0].type).toBe(MessageType.ALLIANCE_EXPIRED);
  });
});
