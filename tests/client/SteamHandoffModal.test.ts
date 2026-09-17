import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancelLaunchMock = vi.hoisted(() => vi.fn());
const launchSteamJoinMock = vi.hoisted(() => vi.fn(() => cancelLaunchMock));
vi.mock("../../src/client/SteamHandoff", () => ({
  launchSteamJoin: launchSteamJoinMock,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import "../../src/client/SteamHandoffModal";
import type { SteamHandoffModal } from "../../src/client/SteamHandoffModal";
import { UserSettings } from "../../src/core/game/UserSettings";

const LOBBY = "aB3xY9zQ12";

async function mount(): Promise<SteamHandoffModal> {
  const modal = document.createElement(
    "steam-handoff-modal",
  ) as SteamHandoffModal;
  document.body.appendChild(modal);
  await modal.updateComplete;
  return modal;
}

function click(modal: SteamHandoffModal, selector: string): void {
  modal.querySelector<HTMLElement>(selector)!.click();
}

describe("SteamHandoffModal", () => {
  let modal: SteamHandoffModal;
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    launchSteamJoinMock.mockClear();
    cancelLaunchMock.mockClear();
    replaceState = vi.spyOn(history, "replaceState");
    modal = await mount();
  });

  afterEach(() => {
    modal.remove();
    replaceState.mockRestore();
  });

  it("asks before launching anything", async () => {
    modal.offer(LOBBY, "ask", vi.fn());
    await modal.updateComplete;
    expect(modal.isOpen()).toBe(true);
    expect(launchSteamJoinMock).not.toHaveBeenCalled();
  });

  it("launches straight away for a remembered Steam choice", () => {
    modal.offer(LOBBY, "steam", vi.fn());
    expect(launchSteamJoinMock).toHaveBeenCalledExactlyOnceWith(LOBBY);
  });

  it("does not relaunch when the URL handler re-offers the same lobby", () => {
    modal.offer(LOBBY, "steam", vi.fn());
    modal.offer(LOBBY, "steam", vi.fn());
    expect(launchSteamJoinMock).toHaveBeenCalledTimes(1);
  });

  it("resumes the browser join without touching the lobby URL", async () => {
    const resume = vi.fn();
    modal.offer(LOBBY, "ask", resume);
    await modal.updateComplete;
    click(modal, ".steam-handoff-browser-btn");
    expect(resume).toHaveBeenCalledTimes(1);
    expect(modal.isOpen()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(new UserSettings().steamLobbyLinks()).toBe("ask");
  });

  // The launch waits for page load, so the player can get here first.
  it("cancels a pending launch when the browser is chosen instead", async () => {
    const resume = vi.fn();
    modal.offer(LOBBY, "steam", resume);
    await modal.updateComplete;
    click(modal, ".steam-handoff-browser-btn");
    expect(cancelLaunchMock).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("stores the choice only when asked to remember it", async () => {
    modal.offer(LOBBY, "ask", vi.fn());
    await modal.updateComplete;
    click(modal, ".steam-handoff-remember");
    click(modal, ".steam-handoff-steam-btn");
    expect(launchSteamJoinMock).toHaveBeenCalledExactlyOnceWith(LOBBY);
    expect(new UserSettings().steamLobbyLinks()).toBe("steam");
  });

  it("drops the lobby URL when dismissed without a choice", async () => {
    const resume = vi.fn();
    history.pushState(null, "", `/w0/game/${LOBBY}`);
    replaceState.mockClear();
    modal.offer(LOBBY, "ask", resume);
    await modal.updateComplete;
    modal.close();
    expect(resume).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });
});
