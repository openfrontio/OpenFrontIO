import { afterEach, describe, expect, it, vi } from "vitest";
import { clientPlatform } from "../../src/client/ClientPlatform";

const { onCrazyGames, onPoki, onViverse } = vi.hoisted(() => ({
  onCrazyGames: { value: false },
  onPoki: { value: false },
  onViverse: { value: false },
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: () => onCrazyGames.value },
}));
vi.mock("../../src/client/poki/PokiSDK", () => ({
  pokiSDK: { isOnPoki: () => onPoki.value },
}));
vi.mock("../../src/client/ViverseSDK", () => ({
  viverseSDK: { isOnViverse: () => onViverse.value },
}));

describe("clientPlatform", () => {
  afterEach(() => {
    onCrazyGames.value = false;
    onPoki.value = false;
    onViverse.value = false;
    delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
  });

  it("is web by default", () => {
    expect(clientPlatform()).toBe("web");
  });

  it("is crazygames inside the CrazyGames frame", () => {
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("crazygames");
  });

  it("is poki inside the Poki frame", () => {
    onPoki.value = true;
    expect(clientPlatform()).toBe("poki");
  });

  // CrazyGames' detection claims any iframe it can't identify (Safari
  // private), which includes Poki's.
  it("prefers poki over the CrazyGames iframe fallback", () => {
    onPoki.value = true;
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("poki");
  });

  it("is viverse inside the VIVERSE wrapper", () => {
    onViverse.value = true;
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("viverse");
  });

  // The Steam preload exposes `steam` whether or not Steam itself is running.
  it("is steam inside the Steam shell, even when Steam is not running", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      steam: {},
    };
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("steam");
  });

  // The Android shell's bridge has no `steam` key.
  it("is not steam inside a shell without a Steam bridge", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      shell: { version: "1.0.0", api: 7, platform: "android" },
    };
    expect(clientPlatform()).toBe("web");
  });
});
