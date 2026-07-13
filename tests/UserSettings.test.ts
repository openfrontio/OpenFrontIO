import { UserSettings } from "../src/core/game/UserSettings";

describe("UserSettings highlight glow strength", () => {
  beforeEach(() => {
    localStorage.clear();
    // UserSettings keeps a static in-memory cache; reset it too so each test
    // reads fresh from the (cleared) localStorage.
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("defaults to 1 (100%, on)", () => {
    expect(new UserSettings().highlightGlowStrength()).toBe(1);
  });

  it("persists a set value, including 0 (off)", () => {
    const s = new UserSettings();
    s.setHighlightGlowStrength(2.5);
    expect(s.highlightGlowStrength()).toBe(2.5);
    s.setHighlightGlowStrength(0);
    expect(s.highlightGlowStrength()).toBe(0);
  });

  it("shares state across instances via the static cache", () => {
    // The settings modal and the renderer's frame builder each hold their own
    // UserSettings; a change in one must be visible to the other.
    new UserSettings().setHighlightGlowStrength(3);
    expect(new UserSettings().highlightGlowStrength()).toBe(3);
  });
});
