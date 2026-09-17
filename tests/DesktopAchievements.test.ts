import { desktopAchievements } from "../src/client/DesktopAchievements";

describe("DesktopAchievements", () => {
  afterEach(() => {
    delete (window as any).openfrontDesktop;
  });

  it("is unavailable with no bridge at all", () => {
    expect(desktopAchievements.isAvailable()).toBe(false);
  });

  it("is unavailable on a shell that predates the namespace", () => {
    (window as any).openfrontDesktop = {
      shell: { api: 3 },
      achievements: { unlock: vi.fn() },
    };
    expect(desktopAchievements.isAvailable()).toBe(false);
  });

  it("sends nothing to a shell that exposes the namespace without declaring api 4", () => {
    // The half-a-surface case the gate exists for: the method is right there
    // and callable, and must still not be called. Without the isAvailable
    // check in unlock() this is the only test that fails.
    const unlock = vi.fn().mockResolvedValue(undefined);
    (window as any).openfrontDesktop = {
      shell: { api: 3 },
      achievements: { unlock },
    };
    desktopAchievements.unlock(["win_ffa"]);
    expect(unlock).not.toHaveBeenCalled();
  });

  it("forwards names on a shell that declares api 4", () => {
    const unlock = vi.fn().mockResolvedValue(undefined);
    (window as any).openfrontDesktop = {
      shell: { api: 4 },
      achievements: { unlock },
    };
    desktopAchievements.unlock(["win_ffa"]);
    expect(unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("does not throw when the bridge throws synchronously", () => {
    (window as any).openfrontDesktop = {
      shell: { api: 4 },
      achievements: {
        unlock: () => {
          throw new Error("bridge exploded");
        },
      },
    };
    expect(() => desktopAchievements.unlock(["win_ffa"])).not.toThrow();
  });

  it("sends nothing for an empty list", () => {
    const unlock = vi.fn().mockResolvedValue(undefined);
    (window as any).openfrontDesktop = {
      shell: { api: 4 },
      achievements: { unlock },
    };
    desktopAchievements.unlock([]);
    expect(unlock).not.toHaveBeenCalled();
  });
});
