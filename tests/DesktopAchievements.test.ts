import { desktopAchievements } from "../src/client/DesktopAchievements";

// Availability is the presence of the method, not a number on shell.api. The
// api ladder belongs to the shell repository: the level this module was first
// written against turned out to have already shipped there meaning something
// unrelated, so the gate passed on every shell in the wild while none had an
// achievements namespace at all. These tests are framed around presence and
// absence of `achievements.unlock` so they cannot encode that mistake again.
describe("DesktopAchievements", () => {
  afterEach(() => {
    delete (window as any).openfrontDesktop;
  });

  it("is unavailable with no bridge at all", () => {
    expect(desktopAchievements.isAvailable()).toBe(false);
  });

  it("is unavailable on a shell that has no achievements namespace", () => {
    (window as any).openfrontDesktop = { shell: { api: 3 } };
    expect(desktopAchievements.isAvailable()).toBe(false);
  });

  // The regression this file exists for. Every shell in the wild declares an
  // api level that a hardcoded gate would have accepted, and none of them can
  // take an achievement. Nothing about the number says anything here.
  it("is unavailable on a shell declaring a high api with no namespace", () => {
    (window as any).openfrontDesktop = { shell: { api: 99 } };
    expect(desktopAchievements.isAvailable()).toBe(false);
  });

  it("is unavailable when the namespace is there but unlock is not callable", () => {
    (window as any).openfrontDesktop = {
      shell: { api: 4 },
      achievements: { unlock: "soon" },
    };
    expect(desktopAchievements.isAvailable()).toBe(false);
  });

  it("is available whenever unlock is callable, whatever api says", () => {
    (window as any).openfrontDesktop = {
      achievements: { unlock: vi.fn() },
    };
    expect(desktopAchievements.isAvailable()).toBe(true);
  });

  // unlock answers whether the names actually reached the shell. The caller
  // records what it delivers and never re-sends a recorded name, so every
  // false below is the difference between a name retried later and a name
  // lost for good.
  it("sends nothing to a shell without the namespace", async () => {
    (window as any).openfrontDesktop = { shell: { api: 4 } };
    await expect(desktopAchievements.unlock(["win_ffa"])).resolves.toBe(false);
  });

  it("forwards names to a shell that exposes unlock", async () => {
    const unlock = vi.fn().mockResolvedValue(undefined);
    (window as any).openfrontDesktop = {
      shell: { api: 4 },
      achievements: { unlock },
    };
    await expect(desktopAchievements.unlock(["win_ffa"])).resolves.toBe(true);
    expect(unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("does not throw when the bridge throws synchronously", async () => {
    (window as any).openfrontDesktop = {
      achievements: {
        unlock: () => {
          throw new Error("bridge exploded");
        },
      },
    };
    await expect(desktopAchievements.unlock(["win_ffa"])).resolves.toBe(false);
  });

  // A shell that HAS the namespace but cannot honour the call: the platform
  // library never initialised, the native call threw, the main process errored.
  // It looks capable and delivers nothing, so it must report a failure rather
  // than let the caller record these names as handed over.
  it("reports failure, without throwing, when the bridge rejects", async () => {
    const unlock = vi.fn().mockRejectedValue(new Error("not initialised"));
    (window as any).openfrontDesktop = { achievements: { unlock } };
    await expect(desktopAchievements.unlock(["win_ffa"])).resolves.toBe(false);
    expect(unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  // Off-contract -- the bridge declares Promise<void> -- but harmless: the
  // call returned without an error, which is the only signal there is.
  it("does not throw when unlock returns something that is not a promise", async () => {
    const unlock = vi.fn(() => undefined);
    (window as any).openfrontDesktop = { achievements: { unlock } };
    await expect(desktopAchievements.unlock(["win_ffa"])).resolves.toBe(true);
    expect(unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("sends nothing for an empty list", async () => {
    const unlock = vi.fn().mockResolvedValue(undefined);
    (window as any).openfrontDesktop = { achievements: { unlock } };
    await expect(desktopAchievements.unlock([])).resolves.toBe(false);
    expect(unlock).not.toHaveBeenCalled();
  });
});
