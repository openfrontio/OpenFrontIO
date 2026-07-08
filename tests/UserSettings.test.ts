import { UserSettings } from "../src/core/game/UserSettings";

describe("UserSettings highlight small players", () => {
  beforeEach(() => {
    localStorage.clear();
    // UserSettings keeps a static in-memory cache; reset it too so each test
    // reads fresh from the (cleared) localStorage.
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("defaults to off", () => {
    expect(new UserSettings().highlightSmallPlayers()).toBe(false);
  });

  it("toggles on and off", () => {
    const s = new UserSettings();
    s.toggleHighlightSmallPlayers();
    expect(s.highlightSmallPlayers()).toBe(true);
    s.toggleHighlightSmallPlayers();
    expect(s.highlightSmallPlayers()).toBe(false);
  });

  it("shares state across instances via the static cache", () => {
    // The settings modal and the renderer's frame builder each hold their own
    // UserSettings; a toggle in one must be visible to the other.
    new UserSettings().toggleHighlightSmallPlayers();
    expect(new UserSettings().highlightSmallPlayers()).toBe(true);
  });
});
