/**
 * The "Disable emojis" setting must also suppress received emojis in the
 * events feed (not just the in-world / overlay display). Regression test for
 * #4430 — EventsDisplay.onEmojiMessageEvent must early-return when the setting
 * is off.
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
import { UserSettings } from "../../../../src/core/game/UserSettings";

function resetSettings() {
  localStorage.clear();
  (
    UserSettings as unknown as { cache: Map<string, string | null> }
  ).cache.clear();
}

function setEmojisEnabled(enabled: boolean) {
  localStorage.setItem("settings.emojis", String(enabled));
  (
    UserSettings as unknown as { cache: Map<string, string | null> }
  ).cache.clear();
}

describe("EventsDisplay emoji setting (#4430)", () => {
  let ed: EventsDisplay;
  const myPlayer = { smallID: () => 1, displayName: () => "Me" };
  const sender = { smallID: () => 2, displayName: () => "Bob" };

  // A broadcast/direct emoji from Bob addressed to me (recipientID = my smallID).
  const emojiUpdate = {
    type: GameUpdateType.Emoji,
    emoji: { message: "👍", senderID: 2, recipientID: 1, createdAt: 0 },
  };

  beforeEach(() => {
    resetSettings();
    ed = new EventsDisplay();
    (ed as unknown as { game: unknown }).game = {
      myPlayer: () => myPlayer,
      playerBySmallID: (id: number) => (id === 1 ? myPlayer : sender),
      ticks: () => 0,
    };
  });

  it("adds a feed entry for a received emoji when the setting is on", () => {
    ed.onEmojiMessageEvent(emojiUpdate as never);
    expect((ed as unknown as { events: unknown[] }).events).toHaveLength(1);
  });

  it("adds nothing when the setting is off", () => {
    setEmojisEnabled(false);
    ed.onEmojiMessageEvent(emojiUpdate as never);
    expect((ed as unknown as { events: unknown[] }).events).toHaveLength(0);
  });
});
