import { afterEach, describe, expect, it, vi } from "vitest";
import { clientPlatform } from "../../src/client/ClientPlatform";

const { onCrazyGames } = vi.hoisted(() => ({ onCrazyGames: { value: false } }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: () => onCrazyGames.value },
}));

describe("clientPlatform", () => {
  afterEach(() => {
    onCrazyGames.value = false;
    delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
  });

  it("is web by default", () => {
    expect(clientPlatform()).toBe("web");
  });

  it("is crazygames inside the CrazyGames frame", () => {
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("crazygames");
  });

  it("is steam inside the desktop shell, even without a Steam bridge", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {};
    onCrazyGames.value = true;
    expect(clientPlatform()).toBe("steam");
  });
});
