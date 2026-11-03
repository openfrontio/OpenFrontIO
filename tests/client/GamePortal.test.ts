import { afterEach, describe, expect, it, vi } from "vitest";
import { gamePortal } from "../../src/client/GamePortal";

const on = vi.hoisted(() => ({ poki: false, viverse: false, crazy: false }));

function fakeSdk(name: string) {
  return { getUserToken: vi.fn(async () => `${name}-token`) };
}

vi.mock("../../src/client/PokiSDK", () => ({
  pokiSDK: { isOnPoki: () => on.poki, ...fakeSdk("poki") },
}));
vi.mock("../../src/client/ViverseSDK", () => ({
  viverseSDK: { isOnViverse: () => on.viverse, ...fakeSdk("viverse") },
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: () => on.crazy, ...fakeSdk("crazygames") },
}));

describe("gamePortal", () => {
  afterEach(() => {
    on.poki = on.viverse = on.crazy = false;
  });

  it("is no portal on the open web", async () => {
    expect(gamePortal.name()).toBeNull();
    expect(gamePortal.isOnGamePortal()).toBe(false);
    expect(await gamePortal.getUserToken()).toBeNull();
  });

  // CrazyGames' detection claims any iframe it can't identify, so on
  // VIVERSE (or Poki) it answers true as well.
  it("picks VIVERSE over the CrazyGames iframe fallback", async () => {
    on.viverse = on.crazy = true;
    expect(gamePortal.name()).toBe("viverse");
    expect(await gamePortal.getUserToken()).toBe("viverse-token");
  });

  it("picks Poki over VIVERSE and CrazyGames", async () => {
    on.poki = on.viverse = on.crazy = true;
    expect(gamePortal.name()).toBe("poki");
    expect(await gamePortal.getUserToken()).toBe("poki-token");
  });

  it("is CrazyGames when nothing else claims the frame", async () => {
    on.crazy = true;
    expect(gamePortal.name()).toBe("crazygames");
    expect(await gamePortal.getUserToken()).toBe("crazygames-token");
  });
});
