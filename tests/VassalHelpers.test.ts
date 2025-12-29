import { effectiveTilesFromVassals, shouldShowVassalSlider } from "../src/client/graphics/vassalHelpers";
import { PlayerView } from "../src/core/game/GameView";

describe("vassal helpers", () => {
  it("shouldShowVassalSlider mirrors vassalsEnabled", () => {
    expect(
      shouldShowVassalSlider({ vassalsEnabled: () => true } as any),
    ).toBe(true);
    expect(
      shouldShowVassalSlider({ vassalsEnabled: () => false } as any),
    ).toBe(false);
  });

  it("effectiveTilesWithToggle sums vassal tiles only when enabled and root", () => {
    const child = {
      numTilesOwned: () => 2,
      overlord: () => null,
      vassals: () => [],
      config: () => ({ vassalsEnabled: () => true }),
    } as unknown as PlayerView;
    const root = {
      numTilesOwned: () => 3,
      overlord: () => null,
      vassals: () => [child],
      config: () => ({ vassalsEnabled: () => true }),
    } as unknown as PlayerView;

    expect(effectiveTilesFromVassals(root)).toBe(5);

    const disabledRoot = {
      ...root,
      config: () => ({ vassalsEnabled: () => false }),
    } as unknown as PlayerView;
    expect(effectiveTilesFromVassals(disabledRoot)).toBe(3);

    const vassalWithOverlord = {
      ...child,
      overlord: () => root,
    } as unknown as PlayerView;
    expect(effectiveTilesFromVassals(vassalWithOverlord)).toBe(2);

    // nested vassals
    const grandchild = {
      numTilesOwned: () => 4,
      overlord: () => child,
      vassals: () => [],
      config: () => ({ vassalsEnabled: () => true }),
    } as unknown as PlayerView;
    const rootWithNested = {
      ...root,
      vassals: () => [{ ...child, vassals: () => [grandchild] }],
    } as unknown as PlayerView;
    expect(effectiveTilesFromVassals(rootWithNested)).toBe(3 + 2 + 4);

    // config provided via config() wrapper still respected
    const wrapper = {
      numTilesOwned: () => 1,
      overlord: () => null,
      vassals: () => [],
      config: () => ({ vassalsEnabled: () => false }),
    } as unknown as PlayerView;
    expect(effectiveTilesFromVassals(wrapper)).toBe(1);
  });
});
