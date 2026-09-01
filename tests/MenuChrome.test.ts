import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideMenuChrome,
  inStartedGame,
  restoreMenuChrome,
} from "../src/client/MenuChrome";

// OPE-255. Starting a game hides the menu's ad rails and closes the promos.
// Every exit from a STARTED game used to be a full `window.location.href = "/"`
// navigation, and it was the reload -- not any code -- that put them back.
// openInvite() leaves in place instead, so the teardown needed a real inverse.
// These two live in one module precisely so they cannot drift apart again.

function ad(): HTMLElement {
  const el = document.createElement("div");
  el.className = "ad";
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.classList.remove("in-game");
});

describe("hideMenuChrome", () => {
  it("hides every ad slot", () => {
    const a = ad();
    const b = ad();

    hideMenuChrome();

    expect(a.style.display).toBe("none");
    expect(b.style.display).toBe("none");
  });

  it("is a no-op when there is nothing to hide", () => {
    expect(() => hideMenuChrome()).not.toThrow();
  });
});

describe("restoreMenuChrome", () => {
  it("un-hides every ad slot", () => {
    const a = ad();
    const b = ad();
    hideMenuChrome();

    restoreMenuChrome();

    expect(a.style.display).toBe("");
    expect(b.style.display).toBe("");
  });

  // Clearing the inline style rather than forcing "block" matters: these slots
  // get their real layout from the stylesheet, and a slot the page had its own
  // reason to keep hidden must not be forced visible by our restore.
  it("clears the inline style instead of forcing a display value", () => {
    const el = ad();
    hideMenuChrome();

    restoreMenuChrome();

    expect(el.getAttribute("style")).not.toContain("display");
  });

  it("round-trips an untouched slot back to how it started", () => {
    const el = ad();
    const before = el.getAttribute("style");

    hideMenuChrome();
    restoreMenuChrome();

    expect(el.getAttribute("style") ?? "").toBe(before ?? "");
  });

  it("reopens the promos section", () => {
    const promos = document.createElement("homepage-promos") as HTMLElement & {
      show: () => void;
    };
    promos.show = vi.fn();
    document.body.appendChild(promos);

    restoreMenuChrome();

    expect(promos.show).toHaveBeenCalledOnce();
  });

  // The promos element is ad machinery. On the Steam shell -- the only place
  // this restore path can be reached -- ads never load, so it may not be
  // upgraded and may expose no show() at all. That must not throw and take the
  // lobby-socket restart below it down with it.
  it("tolerates a promos element that has no show()", () => {
    document.body.appendChild(document.createElement("homepage-promos"));

    expect(() => restoreMenuChrome()).not.toThrow();
  });

  it("tolerates the promos element being absent entirely", () => {
    expect(() => restoreMenuChrome()).not.toThrow();
  });
});

// The gate that decides whether any of the above runs. handleLeaveLobby is
// dispatched from several places -- the `leave-lobby` listener (fed by
// ClientGameRunner, HostLobbyModal and JoinLobbyModal), a direct call on the
// join path, and openInvite -- and they all converge on one body, so what
// varies between them is not the restore but whether a game had STARTED.
describe("inStartedGame", () => {
  it("is false at the menu, so a pre-start leave restores nothing", () => {
    expect(inStartedGame()).toBe(false);
  });

  it("is true once the in-game signal is set", () => {
    document.body.classList.add("in-game");

    expect(inStartedGame()).toBe(true);
  });

  // Joining a lobby is not starting a game. Restoring here would reconnect a
  // socket that was never stopped and drop its snapshot for nothing.
  it("stays false for a lobby that was joined but never started", () => {
    document.body.classList.remove("in-game");

    expect(inStartedGame()).toBe(false);
  });
});
