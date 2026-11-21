import { UserSettings } from "../../src/client/UserSettings";

// Browsers that block site data throw a SecurityError as soon as
// `localStorage` is read; some Android WebViews expose it as null. Settings
// must fall back to their defaults and the in-memory cache, not throw.
const realDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;

function resetUserSettingsState() {
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

function stubLocalStorage(get: () => Storage | null) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get,
  });
}

const cases: [string, () => Storage | null][] = [
  [
    "blocked (SecurityError on access)",
    () => {
      throw new DOMException("Access is denied", "SecurityError");
    },
  ],
  ["null (Android WebView)", () => null],
];

describe.each(cases)("UserSettings with localStorage %s", (_, get) => {
  beforeEach(() => {
    realDescriptor.get?.call(window)?.clear();
    resetUserSettingsState();
    stubLocalStorage(get);
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", realDescriptor);
    resetUserSettingsState();
  });

  it("reads defaults instead of throwing", () => {
    const settings = new UserSettings();
    expect(() => settings.emojis()).not.toThrow();
    expect(settings.emojis()).toBe(true);
    expect(settings.alertFrame()).toBe(true);
    expect(settings.getDevOnlyPattern()).toBeUndefined();
  });

  it("keeps values set during the session in the cache", () => {
    const settings = new UserSettings();
    expect(() => settings.toggleEmojis()).not.toThrow();
    expect(settings.emojis()).toBe(false);
    expect(new UserSettings().emojis()).toBe(false);
  });

  it("reports a lobby preset save as failed", () => {
    expect(new UserSettings().setLobbyPresets([{ name: "x" }])).toBe(false);
    expect(new UserSettings().setLobbyPresets([])).toBe(false);
  });

  it("moves logged-out selections on login without throwing", () => {
    expect(() => UserSettings.setPlayerId("player-1")).not.toThrow();
  });
});
