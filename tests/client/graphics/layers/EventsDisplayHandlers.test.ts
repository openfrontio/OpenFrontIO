/**
 * Coverage for the EventsDisplay update handlers: the tick() dispatch loop
 * over updateMap, and the alliance/target/unit handlers' myPlayer guards.
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
  // Include params in the output so descriptions are assertable.
  translateText: vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  ),
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
  getMessageTypeClasses: vi.fn(() => ""),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsDisplay } from "../../../../src/client/hud/layers/EventsDisplay";
import { PlaySoundEffectEvent } from "../../../../src/client/sound/Sounds";
import { MessageType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

interface Ed {
  events: { description: string; type: MessageType; focusID?: number }[];
  game: unknown;
  eventBus: unknown;
}

describe("EventsDisplay handlers", () => {
  let ed: EventsDisplay;
  let emit: ReturnType<typeof vi.fn>;
  const myPlayer = {
    smallID: () => 1,
    displayName: () => "Me",
    isAlive: () => true,
    isFriendly: (p: { smallID: () => number }) => p.smallID() === 2,
  };
  const friend = {
    smallID: () => 2,
    displayName: () => "Friend",
    isAlive: () => true,
    isDisconnected: () => false,
    isTraitor: () => false,
  };
  const stranger = {
    smallID: () => 3,
    displayName: () => "Stranger",
    isAlive: () => true,
    isDisconnected: () => false,
    isTraitor: () => false,
  };
  const byID: Record<number, unknown> = { 1: myPlayer, 2: friend, 3: stranger };

  const events = () => (ed as unknown as Ed).events;
  let game: { updatesSinceLastTick: () => unknown };

  beforeEach(() => {
    ed = new EventsDisplay();
    emit = vi.fn();
    (ed as unknown as Ed).eventBus = { emit };
    game = {
      myPlayer: () => myPlayer,
      playerBySmallID: (id: number) => byID[id],
      unit: (id: number) => ({ id, isActive: () => true }),
      ticks: () => 0,
      inSpawnPhase: () => false,
      config: () => ({
        traitorDefenseDebuff: () => 0.5,
        traitorDuration: () => 25, // ticks -> floor(2.5) = 2 seconds
      }),
      updatesSinceLastTick: () => null,
    };
    (ed as unknown as Ed).game = game;
  });

  describe("tick", () => {
    it("dispatches queued updates through updateMap", () => {
      game.updatesSinceLastTick = () => ({
        [GameUpdateType.DisplayEvent]: [
          {
            type: GameUpdateType.DisplayEvent,
            message: "hello world",
            messageType: MessageType.ATTACK_FAILED,
            playerID: 1,
          },
        ],
        [GameUpdateType.UnitIncoming]: [
          {
            type: GameUpdateType.UnitIncoming,
            unitID: 7,
            message: "incoming!",
            messageType: MessageType.NUKE_INBOUND,
            playerID: 1,
          },
        ],
      });

      ed.tick();

      expect(events().map((e) => e.description)).toEqual([
        "hello world",
        "incoming!",
      ]);
    });

    it("adds nothing when there are no updates", () => {
      ed.tick();
      expect(events()).toHaveLength(0);
    });
  });

  describe("onAllianceRequestReplyEvent", () => {
    const reply = (requestorID: number, accepted: boolean) => ({
      type: GameUpdateType.AllianceRequestReply,
      request: { requestorID, recipientID: 2, createdAt: 0 },
      accepted,
    });

    it("shows the reply to my own request", () => {
      ed.onAllianceRequestReplyEvent(reply(1, true) as never);
      expect(events()).toHaveLength(1);
      expect(events()[0].type).toBe(MessageType.ALLIANCE_ACCEPTED);
      expect(events()[0].focusID).toBe(2);
      expect(events()[0].description).toContain("Friend");
    });

    it("ignores replies to other players' requests", () => {
      ed.onAllianceRequestReplyEvent(reply(3, true) as never);
      expect(events()).toHaveLength(0);
    });
  });

  describe("onBrokeAllianceEvent", () => {
    it("shows the betrayal malus and duration when I am the traitor", () => {
      ed.onBrokeAllianceEvent({
        type: GameUpdateType.BrokeAlliance,
        traitorID: 1,
        betrayedID: 2,
        allianceID: 0,
      } as never);

      expect(events()).toHaveLength(1);
      expect(events()[0].type).toBe(MessageType.ALLIANCE_BROKEN);
      // malus = (1 - 0.5) * 100; duration = floor(25 * 0.1) = 2 -> plural text
      expect(events()[0].description).toContain('"malusPercent":50');
      expect(events()[0].description).toContain(
        "events_display.duration_seconds_plural",
      );
      expect(events()[0].description).toContain(String.raw`\"seconds\":2`);
      expect(emit).toHaveBeenCalledWith(expect.any(PlaySoundEffectEvent));
    });

    it("shows nothing for a betrayal between other players", () => {
      ed.onBrokeAllianceEvent({
        type: GameUpdateType.BrokeAlliance,
        traitorID: 3,
        betrayedID: 2,
        allianceID: 0,
      } as never);
      expect(events()).toHaveLength(0);
    });
  });

  describe("onAllianceExpiredEvent", () => {
    it("shows the expiry when I am one of the parties", () => {
      ed.onAllianceExpiredEvent({
        type: GameUpdateType.AllianceExpired,
        player1ID: 1,
        player2ID: 2,
      } as never);

      expect(events()).toHaveLength(1);
      expect(events()[0].type).toBe(MessageType.ALLIANCE_EXPIRED);
      expect(events()[0].focusID).toBe(2);
      expect(events()[0].description).toContain("Friend");
    });

    it("ignores expiries between other players", () => {
      ed.onAllianceExpiredEvent({
        type: GameUpdateType.AllianceExpired,
        player1ID: 2,
        player2ID: 3,
      } as never);
      expect(events()).toHaveLength(0);
    });
  });

  describe("onTargetPlayerEvent", () => {
    it("shows an ally's attack request", () => {
      ed.onTargetPlayerEvent({
        type: GameUpdateType.TargetPlayer,
        playerID: 2,
        targetID: 3,
      } as never);

      expect(events()).toHaveLength(1);
      expect(events()[0].type).toBe(MessageType.ATTACK_REQUEST);
      expect(events()[0].focusID).toBe(3);
      expect(events()[0].description).toContain("Friend");
      expect(events()[0].description).toContain("Stranger");
    });

    it("ignores requests from non-friendly players", () => {
      ed.onTargetPlayerEvent({
        type: GameUpdateType.TargetPlayer,
        playerID: 3,
        targetID: 2,
      } as never);
      expect(events()).toHaveLength(0);
    });
  });

  describe("onUnitIncomingEvent", () => {
    const incoming = (playerID: number) => ({
      type: GameUpdateType.UnitIncoming,
      unitID: 7,
      message: "nuke inbound",
      messageType: MessageType.NUKE_INBOUND,
      playerID,
    });

    it("shows incoming-unit warnings addressed to me", () => {
      ed.onUnitIncomingEvent(incoming(1) as never);
      expect(events()).toHaveLength(1);
      expect(events()[0].description).toBe("nuke inbound");
      expect(events()[0].type).toBe(MessageType.NUKE_INBOUND);
    });

    it("ignores warnings addressed to other players", () => {
      ed.onUnitIncomingEvent(incoming(2) as never);
      expect(events()).toHaveLength(0);
    });
  });
});
