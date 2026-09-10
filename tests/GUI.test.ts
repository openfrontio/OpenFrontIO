import { describe, it, expect } from "vitest";
import { AttacksDisplay } from "../src/client/hud/layers/AttacksDisplay";
import { translateText } from "../src/client/Utils";

// Simple mock game view that can return a configurable owner ID and a mock player.
class MockGameView {
  constructor(private readonly ownerId: number = 0) {}
  ownerID() { return this.ownerId; }
  playerBySmallID(id: number) {
    return id === this.ownerId && this.ownerId !== 0
      ? { displayName: () => `MockPlayer${id}` }
      : null;
  }
}

// Minimal mock for a unit view; targetTile can be overridden per case.
const mockUnit = (tile: any) => ({
  targetTile: () => tile,
  owner: () => ({ id: () => 1 }),
});

describe("AttacksDisplay.getBoatTargetName", () => {
  it("returns wilderness text when ownerID is 0", () => {
    const d = new AttacksDisplay();
    (d as any).game = new MockGameView();
    const r = (d as any).getBoatTargetName(mockUnit(42));
    expect(r).toBe(translateText("help_modal.ui_wilderness"));
  });

  it("returns player name when ownerID is non-zero", () => {
    const d = new AttacksDisplay();
    (d as any).game = new MockGameView(7);
    const r = (d as any).getBoatTargetName(mockUnit(42));
    expect(r).toBe("MockPlayer7");
  });

  it("returns empty string when targetTile is undefined", () => {
    const d = new AttacksDisplay();
    (d as any).game = new MockGameView(3);
    const r = (d as any).getBoatTargetName(mockUnit(undefined));
    expect(r).toBe("");
  });
});
