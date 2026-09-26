/**
 * ChatDisplay must only surface CHAT messages that are broadcast or addressed
 * to the local player, and tick() must tolerate ticks with no updates.
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDisplay } from "../../../../src/client/hud/layers/ChatDisplay";
import { MessageType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

interface Cd {
  chatEvents: { description: string }[];
  game: unknown;
}

const chatMsg = (message: string, playerID: number | null) => ({
  type: GameUpdateType.DisplayEvent,
  message,
  messageType: MessageType.CHAT,
  playerID,
});

describe("ChatDisplay", () => {
  let cd: ChatDisplay;
  const myPlayer = { smallID: () => 1 };
  const chatEvents = () => (cd as unknown as Cd).chatEvents;

  const setGame = (updates: unknown) => {
    (cd as unknown as Cd).game = {
      myPlayer: () => myPlayer,
      ticks: () => 0,
      updatesSinceLastTick: () => updates,
    };
  };

  beforeEach(() => {
    cd = new ChatDisplay();
  });

  describe("tick", () => {
    it("does nothing when there are no updates", () => {
      setGame(null);
      cd.tick();
      expect(chatEvents()).toHaveLength(0);
    });

    it("collects chat messages addressed to me or broadcast", () => {
      setGame({
        [GameUpdateType.DisplayEvent]: [
          chatMsg("to me", 1),
          chatMsg("broadcast", null),
          chatMsg("to someone else", 2),
          { ...chatMsg("not chat", 1), messageType: MessageType.ATTACK_FAILED },
        ],
      });
      cd.tick();
      expect(chatEvents().map((e) => e.description)).toEqual([
        "to me",
        "broadcast",
      ]);
    });
  });

  describe("onDisplayMessageEvent", () => {
    it("adds a chat message addressed to me", () => {
      setGame(null);
      cd.onDisplayMessageEvent(chatMsg("hi there", 1) as never);
      expect(chatEvents().map((e) => e.description)).toEqual(["hi there"]);
    });

    it("ignores chat addressed to another player", () => {
      setGame(null);
      cd.onDisplayMessageEvent(chatMsg("private", 2) as never);
      expect(chatEvents()).toHaveLength(0);
    });

    it("ignores non-chat messages", () => {
      setGame(null);
      cd.onDisplayMessageEvent({
        ...chatMsg("attack", 1),
        messageType: MessageType.ATTACK_FAILED,
      } as never);
      expect(chatEvents()).toHaveLength(0);
    });
  });
});
