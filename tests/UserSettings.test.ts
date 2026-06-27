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
    s.setSelectedEffectName("transport_ship_trail", "spectrum");
    expect(s.getSelectedEffectName("transport_ship_trail")).toBe("spectrum");
  });

  it("returns null when nothing is selected", () => {
    expect(
      new UserSettings().getSelectedEffectName("transport_ship_trail"),
    ).toBeNull();
  });

  it("clearing the last selection removes the storage key", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("transport_ship_trail", "spectrum");
    s.setSelectedEffectName("transport_ship_trail", undefined);
    expect(s.getSelectedEffectName("transport_ship_trail")).toBeNull();
    expect(localStorage.getItem(EFFECTS_KEY)).toBeNull();
  });

  it("clearing one effectType leaves other types intact", () => {
    const s = new UserSettings();
    // Seed two types directly (only one real effectType exists today).
    localStorage.setItem(
      EFFECTS_KEY,
      JSON.stringify({ transport_ship_trail: "spectrum", future: "x" }),
    );
    s.setSelectedEffectName("transport_ship_trail", undefined);
    expect(s.getSelectedEffects()).toEqual({ future: "x" });
  });

  it("returns an empty map for a corrupt blob", () => {
    localStorage.setItem(EFFECTS_KEY, "not json");
    expect(new UserSettings().getSelectedEffects()).toEqual({});
  });
});
