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
