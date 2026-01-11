import { UserSettings } from "../../../src/core/game/UserSettings";

describe("UserSettings", () => {
  let userSettings: UserSettings;
  let mockStorage: Record<string, string> = {};

  beforeAll(() => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, value: string) => {
          mockStorage[key] = value.toString();
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
      },
      writable: true,
    });
  });

  beforeEach(() => {
    mockStorage = {};
    // Ensure clean state even if UserSettings caches something (it doesn't, it reads from LS)
    userSettings = new UserSettings();
  });

  test("attackRatioIncrement returns default 0.1", () => {
    expect(userSettings.attackRatioIncrement()).toBe(0.1);
  });

  test("setAttackRatioIncrement sets and retrieves value", () => {
    userSettings.setAttackRatioIncrement(0.05);
    expect(userSettings.attackRatioIncrement()).toBe(0.05);
  });

  test("setAttackRatioIncrement persists to localStorage", () => {
    userSettings.setAttackRatioIncrement(0.025);
    const stored = localStorage.getItem("settings.attackRatioIncrement");
    expect(stored).toBe("0.025");
  });
});
