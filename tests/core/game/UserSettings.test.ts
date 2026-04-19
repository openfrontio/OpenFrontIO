import { UserSettings } from "../../../src/core/game/UserSettings";

function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe("UserSettings UI scale", () => {
  let userSettings: UserSettings;

  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
    userSettings = new UserSettings();
    userSettings.removeCached("settings.uiScale");
    document.documentElement.style.zoom = "";
  });

  afterEach(() => {
    userSettings.removeCached("settings.uiScale");
    document.documentElement.style.zoom = "";
    vi.unstubAllGlobals();
  });

  it("defaults UI scale to 100", () => {
    expect(userSettings.uiScale()).toBe(100);
  });

  it("snaps UI scale to the nearest 10 percent before storing and applying it", () => {
    userSettings.setUiScale(155);

    expect(userSettings.uiScale()).toBe(160);
    expect(localStorage.getItem("settings.uiScale")).toBe("160");
    expect(document.documentElement.style.zoom).toBe("1.6");
  });

  it("clamps UI scale to the allowed range", () => {
    userSettings.setUiScale(25);
    expect(userSettings.uiScale()).toBe(50);
    expect(document.documentElement.style.zoom).toBe("0.5");

    userSettings.setUiScale(250);
    expect(userSettings.uiScale()).toBe(200);
    expect(document.documentElement.style.zoom).toBe("2");
  });

  it("normalizes non-finite UI scale values to 100", () => {
    userSettings.setUiScale(Number.NaN);
    expect(userSettings.uiScale()).toBe(100);
    expect(localStorage.getItem("settings.uiScale")).toBe("100");
    expect(document.documentElement.style.zoom).toBe("1");

    userSettings.setUiScale(Number.POSITIVE_INFINITY);
    expect(userSettings.uiScale()).toBe(100);
    expect(localStorage.getItem("settings.uiScale")).toBe("100");
    expect(document.documentElement.style.zoom).toBe("1");
  });
});
