import { describe, expect, it, vi } from "vitest";
import * as inGameModal from "../../src/client/InGameModal";
import * as saveManager from "../../src/client/SinglePlayerSaveManager";
import { UnitType } from "../../src/core/game/Game";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
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

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

describe("SinglePlayerModal start", () => {
  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // Selection arrives via the game-config-settings child event.
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });

  it("defers clearSoloSave until game-starting fires, preserving save when game start is rejected", async () => {
    const modal = createModal();
    modal.connectedCallback();

    const clearSpy = vi.spyOn(saveManager, "clearSoloSave");
    modal.resumeSave = {
      gameID: "existing_save",
      numTurns: 50,
      gameStartInfo: { config: { gameMap: "World" } },
    } as any;

    await modal.startGame();

    // Immediately after join-lobby dispatch, clearSoloSave should NOT have been called yet
    expect(clearSpy).not.toHaveBeenCalled();
    expect(modal.resumeSave).not.toBeNull();

    // Simulating acceptance: game-starting event fires on document
    document.dispatchEvent(new CustomEvent("game-starting"));

    // Now clearSoloSave should have been called with the matching gameID and resumeSave cleared
    expect(clearSpy).toHaveBeenCalledWith("existing_save");
    expect(modal.resumeSave).toBeNull();

    modal.disconnectedCallback();
    clearSpy.mockRestore();
  });

  it("does not arm clearSoloSave when join-lobby is prevented", async () => {
    const modal = createModal();
    modal.connectedCallback();

    const clearSpy = vi.spyOn(saveManager, "clearSoloSave");
    modal.resumeSave = {
      gameID: "existing_save",
      numTurns: 50,
      gameStartInfo: { config: { gameMap: "World" } },
    } as any;

    // Simulate join refusal by preventing default
    modal.addEventListener("join-lobby", (e: Event) => e.preventDefault());

    await modal.startGame();

    // Simulating a later game-starting event (e.g. from joining a different lobby)
    document.dispatchEvent(new CustomEvent("game-starting"));

    // clearSoloSave should NOT have been called because join was prevented
    expect(clearSpy).not.toHaveBeenCalled();
    expect(modal.resumeSave).not.toBeNull();

    modal.disconnectedCallback();
    clearSpy.mockRestore();
  });

  it("guards against duplicate concurrent resume attempts", async () => {
    const modal = createModal();
    modal.resumeSave = {
      gameID: "save_snap",
      snapshot: "dummy_data",
      numTurns: 10,
    } as any;

    let resolveSnapshot!: (data: any) => void;
    const snapPromise = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const snapSpy = vi
      .spyOn(saveManager, "getSoloSnapshot")
      .mockReturnValue(snapPromise as any);

    // First resume attempt
    const firstResume = modal.handleResumeGame();
    expect(modal.resumeInFlight).toBe(true);

    // Second resume attempt while first is in flight
    const secondResume = modal.handleResumeGame();
    // Only one snapshot fetch initiated
    expect(snapSpy).toHaveBeenCalledTimes(1);

    resolveSnapshot({ snapshot: new Uint8Array([1, 2, 3]) });
    await Promise.all([firstResume, secondResume]);

    expect(modal.resumeInFlight).toBe(false);
    snapSpy.mockRestore();
  });

  it("invalidates pending resume attempt if modal closes before snapshot settles", async () => {
    const modal = createModal();
    modal.resumeSave = {
      gameID: "save_snap",
      snapshot: "dummy_data",
      numTurns: 10,
    } as any;

    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    let resolveSnapshot!: (data: any) => void;
    const snapPromise = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const snapSpy = vi
      .spyOn(saveManager, "getSoloSnapshot")
      .mockReturnValue(snapPromise as any);

    const resumePromise = modal.handleResumeGame();
    expect(modal.resumeInFlight).toBe(true);

    // User closes the modal before snapshot settles
    modal.onClose();
    expect(modal.resumeInFlight).toBe(false);

    resolveSnapshot({ snapshot: new Uint8Array([1, 2, 3]) });
    await resumePromise;

    // Stale resume must not dispatch join-lobby
    expect(events).toHaveLength(0);
    snapSpy.mockRestore();
  });

  it("invalidates pending resume attempt if another game start begins", async () => {
    const modal = createModal();
    modal.resumeSave = {
      gameID: "save_snap",
      snapshot: "dummy_data",
      numTurns: 10,
    } as any;

    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    let resolveSnapshot!: (data: any) => void;
    const snapPromise = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const snapSpy = vi
      .spyOn(saveManager, "getSoloSnapshot")
      .mockReturnValue(snapPromise as any);

    const resumePromise = modal.handleResumeGame();
    expect(modal.resumeInFlight).toBe(true);

    // Another game start begins
    const startPromise = modal.startGame();
    expect(modal.resumeInFlight).toBe(false);

    resolveSnapshot({ snapshot: new Uint8Array([1, 2, 3]) });
    await Promise.all([resumePromise, startPromise]);

    // Only the new game start dispatched, not the stale resume
    expect(events).toHaveLength(1);
    expect(events[0].gameID).not.toBe("save_snap");
    expect(events[0].resumeSnapshot).toBeUndefined();
    snapSpy.mockRestore();
  });

  it("derives turn count from greater of numTurns and final turnNumber + 1 when decompressing saved turns", async () => {
    const modal = createModal();
    modal.resumeSave = {
      gameID: "save_turns",
      numTurns: 10,
      turns: [
        { turnNumber: 0, intents: [] },
        { turnNumber: 15, intents: [] },
      ],
    } as any;

    const decompressSpy = vi.spyOn(saveManager, "decompressSoloTurns");
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    await modal.handleResumeGame();

    // 15 + 1 = 16 > 10
    expect(decompressSpy).toHaveBeenCalledWith(modal.resumeSave.turns, 16);
    expect(events).toHaveLength(1);
    expect(events[0].gameID).toBe("save_turns");
    decompressSpy.mockRestore();
  });

  it("dispatches join-lobby as cancelable on resume and preserves modal when join is prevented", async () => {
    const modal = createModal();
    modal.resumeSave = {
      gameID: "save_cancelable",
      numTurns: 10,
      turns: [{ turnNumber: 0, intents: [] }],
    } as any;

    let dispatchedEvent: CustomEvent | null = null;
    modal.addEventListener("join-lobby", (e: Event) => {
      dispatchedEvent = e as CustomEvent;
      e.preventDefault();
    });

    const closeSpy = vi.spyOn(modal, "close");
    await modal.handleResumeGame();

    expect(dispatchedEvent).not.toBeNull();
    expect(dispatchedEvent!.cancelable).toBe(true);
    expect(dispatchedEvent!.defaultPrevented).toBe(true);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(modal.resumeInFlight).toBe(false);

    closeSpy.mockRestore();
  });

  it("captures resumeSave before confirm and passes captured gameID to clearSoloSave", async () => {
    const modal = createModal();
    const clearSpy = vi.spyOn(saveManager, "clearSoloSave");

    // Case A: no displayed save -> returns early
    modal.resumeSave = null;
    await modal.handleDiscardGame();
    expect(clearSpy).not.toHaveBeenCalled();

    // Case B: user confirms discard -> clears captured save ID
    modal.resumeSave = {
      gameID: "save_to_discard",
      numTurns: 10,
    } as any;

    let resolveConfirm!: (value: boolean) => void;
    const confirmPromise = new Promise<boolean>((resolve) => {
      resolveConfirm = resolve;
    });
    const confirmSpy = vi
      .spyOn(inGameModal, "showInGameConfirm")
      .mockReturnValue(confirmPromise);

    const discardPromise = modal.handleDiscardGame();

    // While confirmation is pending, simulate a replacement save appearing
    modal.resumeSave = {
      gameID: "replacement_save",
      numTurns: 20,
    } as any;

    resolveConfirm(true);
    await discardPromise;

    // Must clear ONLY the captured save ID, not the replacement
    expect(clearSpy).toHaveBeenCalledWith("save_to_discard");
    // The replacement save must NOT be discarded or set to null
    expect(modal.resumeSave).not.toBeNull();
    expect(modal.resumeSave.gameID).toBe("replacement_save");

    // Case C: user cancels confirm -> does not clear
    modal.resumeSave = {
      gameID: "save_keep",
      numTurns: 5,
    } as any;
    confirmSpy.mockResolvedValueOnce(false);
    await modal.handleDiscardGame();
    expect(clearSpy).not.toHaveBeenCalledWith("save_keep");
    expect(modal.resumeSave?.gameID).toBe("save_keep");

    confirmSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
