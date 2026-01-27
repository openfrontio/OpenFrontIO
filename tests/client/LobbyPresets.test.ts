import {
  deletePreset,
  loadLobbyPresetStore,
  setAutoApplyLastUsed,
  setLastUsedPresetId,
  upsertPreset,
} from "../../src/client/LobbyPresets";

describe("LobbyPresets", () => {
  beforeEach(() => {
    localStorage.removeItem("lobbyPresets.v1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("upsertPreset updates a preset when name is unchanged", () => {
    const created = upsertPreset({
      name: "My Preset",
      config: { bots: 123 },
    });

    expect(created.id).toEqual(expect.any(String));
    expect(created.name).toBe("My Preset");
    expect(created.config.bots).toBe(123);
    expect(created.createdAt).toBe(Date.now());
    expect(created.updatedAt).toBe(Date.now());

    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    const updated = upsertPreset({
      id: created.id,
      name: "My Preset",
      config: { bots: 321 },
    });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBe(Date.now());
    expect(updated.name).toBe("My Preset");
    expect(updated.config.bots).toBe(321);

    const store = loadLobbyPresetStore();
    expect(store.presets).toHaveLength(1);
    expect(store.presets[0]).toMatchObject({
      id: created.id,
      name: "My Preset",
      createdAt: created.createdAt,
      updatedAt: Date.now(),
      config: { bots: 321 },
    });
  });

  test("upsertPreset creates a new preset when name differs from existing", () => {
    const created = upsertPreset({
      name: "Original Preset",
      config: { bots: 100 },
    });

    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));

    const duplicated = upsertPreset({
      id: created.id,
      name: "Copied Preset",
      config: { bots: 200 },
    });

    expect(duplicated.id).not.toBe(created.id);
    expect(duplicated.name).toBe("Copied Preset");
    expect(duplicated.createdAt).toBe(Date.now());
    expect(duplicated.updatedAt).toBe(Date.now());

    const store = loadLobbyPresetStore();
    expect(store.presets).toHaveLength(2);
    expect(store.presets.find((p) => p.id === created.id)).toMatchObject({
      id: created.id,
      name: "Original Preset",
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      config: { bots: 100 },
    });
    expect(store.presets.find((p) => p.id === duplicated.id)).toMatchObject({
      id: duplicated.id,
      name: "Copied Preset",
      createdAt: duplicated.createdAt,
      updatedAt: duplicated.updatedAt,
      config: { bots: 200 },
    });
  });

  test("deletePreset removes preset and clears lastUsedPresetId", () => {
    const p1 = upsertPreset({ name: "Preset 1", config: { bots: 1 } });
    const p2 = upsertPreset({ name: "Preset 2", config: { bots: 2 } });

    setLastUsedPresetId(p1.id);
    setAutoApplyLastUsed(true);

    deletePreset(p1.id);

    const store = loadLobbyPresetStore();
    expect(store.presets.map((p) => p.id)).toEqual([p2.id]);
    expect(store.lastUsedPresetId).toBeUndefined();
    expect(store.autoApplyLastUsed).toBe(true);
  });
});
