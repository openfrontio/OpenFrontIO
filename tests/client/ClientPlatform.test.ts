import { afterEach, describe, expect, it, vi } from "vitest";
import { clientPlatform } from "../../src/client/ClientPlatform";

const { onCrazyGames, onPoki } = vi.hoisted(() => ({
  onCrazyGames: { value: false },
  onPoki: { value: false },
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: () => onCrazyGames.value },
}));
vi.mock("../../src/client/PokiSDK", () => ({
  pokiSDK: { isOnPoki: () => onPoki.value },
}));

describe("clientPlatform", () => {
  afterEach(() => {
    onCrazyGames.value = false;
    onPoki.value = false;
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

  it("is steam inside the desktop shell, even without a Steam bridge", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {};
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("steam");
  });
});
