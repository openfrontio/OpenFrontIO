import { EFFECTS_KEY, UserSettings } from "../src/core/game/UserSettings";

describe("UserSettings effect selection", () => {
  beforeEach(() => {
    localStorage.clear();
    // UserSettings keeps a static in-memory cache; reset it too so each test
    // reads fresh from the (cleared) localStorage.
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("sets and reads a per-effectType selection", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    expect(s.getSelectedEffectName("transportShipTrail")).toBe("spectrum");
  });

  it("returns null when nothing is selected", () => {
    expect(
      new UserSettings().getSelectedEffectName("transportShipTrail"),
    ).toBeNull();
  });

  it("clearing the last selection removes the storage key", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    s.setSelectedEffectName("transportShipTrail", undefined);
    expect(s.getSelectedEffectName("transportShipTrail")).toBeNull();
    expect(localStorage.getItem(EFFECTS_KEY)).toBeNull();
  });

  it("clearing one effectType leaves other types intact", () => {
    const s = new UserSettings();
    // Seed two types directly (only one real effectType exists today).
    localStorage.setItem(
      EFFECTS_KEY,
      JSON.stringify({ transportShipTrail: "spectrum", future: "x" }),
    );
    s.setSelectedEffectName("transportShipTrail", undefined);
    expect(s.getSelectedEffects()).toEqual({ future: "x" });
  });

  it("returns an empty map for a corrupt blob", () => {
    localStorage.setItem(EFFECTS_KEY, "not json");
    expect(new UserSettings().getSelectedEffects()).toEqual({});
  });

  it("keeps per-nukeType nuke-explosion slots independent", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("atom", "atom_boom");
    s.setSelectedEffectName("hydro", "hydro_boom");
    expect(s.getSelectedEffectName("atom")).toBe("atom_boom");
    expect(s.getSelectedEffectName("hydro")).toBe("hydro_boom");
    // Clearing one bomb's slot leaves the others intact.
    s.setSelectedEffectName("atom", undefined);
    expect(s.getSelectedEffectName("atom")).toBeNull();
    expect(s.getSelectedEffectName("hydro")).toBe("hydro_boom");
  });
});

describe("UserSettings highlight glow strength", () => {
  beforeEach(() => {
    localStorage.clear();
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
