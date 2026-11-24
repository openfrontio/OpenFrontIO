import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
  prewarmCosmetics: vi.fn(async () => {}),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

const broadcast = vi.hoisted(() => ({
  last: null as { response: UserMeResponse | false } | null,
}));
vi.mock("../../src/client/UserMeBroadcast", () => ({
  lastUserMeResponse: () => broadcast.last,
}));

const start = vi.hoisted(() => ({ scenarioBundleGameStart: vi.fn() }));
vi.mock("../../src/client/scenario/ScenarioStart", () => start);

const bundleModule = vi.hoisted(() => ({ useScenarioMap: vi.fn() }));
vi.mock("../../src/client/scenario/ScenarioBundle", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useScenarioMap: bundleModule.useScenarioMap,
}));

const dialogs = vi.hoisted(() => ({
  showInGameAlert: vi.fn(async () => true),
  showInGameConfirm: vi.fn(async () => true),
}));
vi.mock("../../src/client/InGameModal", () => dialogs);

vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";
import { ScenarioBundleError } from "../../src/client/scenario/ScenarioBundle";

function userMe(flares: string[]): UserMeResponse {
  return {
    user: {},
    player: { publicId: "p", flares, achievements: { singleplayerMap: [] } },
  } as unknown as UserMeResponse;
}

async function mount(): Promise<any> {
  const modal = document.createElement("single-player-modal") as any;
  document.body.appendChild(modal);
  await modal.updateComplete;
  return modal;
}

afterEach(() => {
  broadcast.last = null;
  document.body.innerHTML = "";
});

describe("SinglePlayerModal scenarios", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides the scenario picker from accounts without the editor flare", async () => {
    broadcast.last = { response: userMe([]) };
    const modal = await mount();
    expect(modal.querySelector("scenario-picker-panel")).toBeNull();
  });

  it("hides it signed out", async () => {
    broadcast.last = { response: false };
    const modal = await mount();
    expect(modal.querySelector("scenario-picker-panel")).toBeNull();
  });

  it("offers it to accounts with the scenario editor flare", async () => {
    broadcast.last = { response: userMe(["scenario_editor"]) };
    const modal = await mount();
    expect(modal.querySelector("scenario-picker-panel")).not.toBeNull();
  });

  it("starts a picked scenario as a singleplayer game", async () => {
    const bundle = { header: {} };
    const detail = { gameID: "g", source: "singleplayer" };
    start.scenarioBundleGameStart.mockResolvedValue(detail);
    const modal = await mount();
    const joins: unknown[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      joins.push((e as CustomEvent).detail),
    );

    await modal.startScenario(bundle, "fr");

    expect(start.scenarioBundleGameStart).toHaveBeenCalledWith(
      bundle,
      "fr",
      expect.objectContaining({ username: expect.any(String) }),
    );
    expect(joins).toEqual([detail]);
    expect(bundleModule.useScenarioMap).toHaveBeenCalledWith(bundle);
    expect(dialogs.showInGameAlert).not.toHaveBeenCalled();
  });

  it("leaves the map and the player alone when the start is retired", async () => {
    const modal = await mount();
    const joins: unknown[] = [];
    modal.addEventListener("join-lobby", () => joins.push(1));
    let fail!: (e: unknown) => void;
    let succeed!: (d: unknown) => void;

    start.scenarioBundleGameStart.mockReturnValueOnce(
      new Promise((resolve) => (succeed = resolve)),
    );
    const finished = modal.startScenario({ header: {} }, "fr");
    await vi.waitFor(() =>
      expect(start.scenarioBundleGameStart).toHaveBeenCalledTimes(1),
    );
    modal.onClose();
    succeed({ gameID: "g" });
    await finished;
    expect(joins).toEqual([]);
    expect(bundleModule.useScenarioMap).not.toHaveBeenCalled();

    start.scenarioBundleGameStart.mockReturnValueOnce(
      new Promise((_, reject) => (fail = reject)),
    );
    const failed = modal.startScenario({ header: {} }, "fr");
    await vi.waitFor(() =>
      expect(start.scenarioBundleGameStart).toHaveBeenCalledTimes(2),
    );
    modal.onClose();
    fail(new ScenarioBundleError("format", "newer"));
    await failed;
    expect(dialogs.showInGameAlert).not.toHaveBeenCalled();
  });

  it("says why a scenario didn't start", async () => {
    const modal = await mount();
    start.scenarioBundleGameStart.mockRejectedValueOnce(
      new ScenarioBundleError("format", "newer"),
    );
    await modal.startScenario({ header: {} }, "fr");
    expect(dialogs.showInGameAlert).toHaveBeenLastCalledWith(
      "scenario_picker.error.incompatible",
    );
    expect(modal.starting).toBe(false);

    start.scenarioBundleGameStart.mockRejectedValueOnce(new Error("?"));
    await modal.startScenario({ header: {} }, "fr");
    expect(dialogs.showInGameAlert).toHaveBeenLastCalledWith(
      "scenario_picker.error.start_failed",
    );
  });
});
