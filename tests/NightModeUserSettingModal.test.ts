import { UserSettingModal } from "../src/client/UserSettingModal";

describe("UserSettingModal - Night Mode", () => {
  let modal: UserSettingModal;

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

    // Mock classList
    const classListMock = {
      add: jest.fn(),
      remove: jest.fn(),
    };
    Object.defineProperty(document.documentElement, "classList", {
      value: classListMock,
      writable: true,
    });

    modal = new UserSettingModal();
    localStorage.clear();
  });

  test("toggleNightMode enables night mode on valid toggle event", () => {
    const event = new CustomEvent("toggle", {
      detail: { checked: true },
    });

    modal.toggleNightMode(event);

    expect(localStorage.getItem("settings.nightMode")).toBe("true");
    expect(document.documentElement.classList.add).toHaveBeenCalledWith(
      "night",
    );
  });

  test("toggleNightMode disables night mode on valid toggle event", () => {
    localStorage.setItem("settings.nightMode", "true");
    const event = new CustomEvent("toggle", {
      detail: { checked: false },
    });

    modal.toggleNightMode(event);

    expect(localStorage.getItem("settings.nightMode")).toBe("false");
    expect(document.documentElement.classList.remove).toHaveBeenCalledWith(
      "night",
    );
  });

  test("toggleNightMode dispatches night-mode-changed event", () => {
    const dispatchSpy = jest.spyOn(modal, "dispatchEvent");
    const event = new CustomEvent("toggle", {
      detail: { checked: true },
    });

    modal.toggleNightMode(event);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "night-mode-changed",
        detail: { nightMode: true },
      }),
    );
  });

  test("toggleNightMode handles invalid event payload gracefully", () => {
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    const event = new CustomEvent("toggle", {
      detail: { checked: "invalid" }, // Wrong type
    }) as any;

    modal.toggleNightMode(event);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Unexpected toggle event payload",
      event,
    );
    // Should not modify localStorage
    expect(localStorage.getItem("settings.nightMode")).toBeNull();

    consoleWarnSpy.mockRestore();
  });
});
