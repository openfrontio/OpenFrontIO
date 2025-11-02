import { UserSettings } from "../src/core/game/UserSettings";

describe("UserSettings - Night Mode", () => {
  let userSettings: UserSettings;

  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store: { [key: string]: string } = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        clear: () => {
          store = {};
        },
      };
    })();
    Object.defineProperty(global, "localStorage", {
      value: localStorageMock,
      writable: true,
    });

    // Mock document.documentElement.classList
    const classListMock = {
      add: jest.fn(),
      remove: jest.fn(),
    };
    Object.defineProperty(document.documentElement, "classList", {
      value: classListMock,
      writable: true,
    });

    userSettings = new UserSettings();
    localStorage.clear();
  });

  test("nightMode returns false by default", () => {
    expect(userSettings.nightMode()).toBe(false);
  });

  test("nightMode returns stored value from localStorage", () => {
    localStorage.setItem("settings.nightMode", "true");
    expect(userSettings.nightMode()).toBe(true);

    localStorage.setItem("settings.nightMode", "false");
    expect(userSettings.nightMode()).toBe(false);
  });

  test("toggleNightMode enables night mode when disabled", () => {
    expect(userSettings.nightMode()).toBe(false);

    userSettings.toggleNightMode();

    expect(userSettings.nightMode()).toBe(true);
    expect(document.documentElement.classList.add).toHaveBeenCalledWith(
      "night",
    );
  });

  test("toggleNightMode disables night mode when enabled", () => {
    localStorage.setItem("settings.nightMode", "true");

    userSettings.toggleNightMode();

    expect(userSettings.nightMode()).toBe(false);
    expect(document.documentElement.classList.remove).toHaveBeenCalledWith(
      "night",
    );
  });

  test("toggleNightMode persists state to localStorage", () => {
    userSettings.toggleNightMode();
    expect(localStorage.getItem("settings.nightMode")).toBe("true");

    userSettings.toggleNightMode();
    expect(localStorage.getItem("settings.nightMode")).toBe("false");
  });
});
