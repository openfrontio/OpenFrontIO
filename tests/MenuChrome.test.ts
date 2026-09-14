import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideMenuChrome,
  menuChromeIsTornDown,
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
  // Module-level teardown flag: reset so state cannot leak between tests.
  restoreMenuChrome();
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

// The gate that decides whether any of the above runs.
//
// It is keyed on "did we tear the chrome down?" rather than on any separate
// signal that happens to correlate. The first version of this gate read the
// `in-game` body class, and that was subtly wrong: the teardown runs in
// `prestart.then(...)` while setInGameSignal(true) runs later in
// `join.then(...)`. For multiplayer those are two distinct server messages
// with a real window between them while terrain loads -- the "prestart->start
// window" ClientGameRunner names. A leave inside that window found the chrome
// torn down but the class unset, so nothing restored: the exact bug this PR
// exists to fix, arriving through a narrower door.
describe("menuChromeIsTornDown", () => {
  it("is false at the menu, so a pre-start leave restores nothing", () => {
    expect(menuChromeIsTornDown()).toBe(false);
  });

  it("is true as soon as the chrome is hidden", () => {
    hideMenuChrome();

    expect(menuChromeIsTornDown()).toBe(true);
  });

  // The regression. The teardown has happened; the in-game signal has not
  // been set and will not be until the join resolves. Restore must still fire.
  it("is true during the prestart->start window, before any in-game signal", () => {
    hideMenuChrome();
    expect(document.body.classList.contains("in-game")).toBe(false);

    expect(menuChromeIsTornDown()).toBe(true);
  });

  it("is false again once the chrome has been restored", () => {
    hideMenuChrome();
    restoreMenuChrome();

    expect(menuChromeIsTornDown()).toBe(false);
  });

  // Deliberately independent of the body class, so the two cannot drift.
  it("does not consult the in-game class", () => {
    document.body.classList.add("in-game");

    expect(menuChromeIsTornDown()).toBe(false);
  });
});

// A slot may already carry an inline display for reasons of its own -- an ad
// the page decided not to show, or a layout the stylesheet does not describe.
// Blanking it on restore would reveal a slot somebody deliberately hid, so
// hide records what it displaced and restore puts that value back.
describe("restoreMenuChrome preserves a slot's own inline display", () => {
  it("leaves a slot that was already hidden hidden", () => {
    const el = ad();
    el.style.display = "none";

    hideMenuChrome();
    restoreMenuChrome();

    expect(el.style.display).toBe("none");
  });

  it("puts back a non-default display value", () => {
    const el = ad();
    el.style.display = "flex";

    hideMenuChrome();
    restoreMenuChrome();

    expect(el.style.display).toBe("flex");
  });

  // The trap. hideMenuChrome() runs TWICE on a real join -- once in
  // prestart.then() and again in join.then() (Main.ts). A naive "record the
  // current value on every hide" would capture "none" from its own first pass
  // and then restore a permanently hidden slot.
  it("does not record its own handiwork when hide runs twice", () => {
    const el = ad();
    el.style.display = "flex";

    hideMenuChrome();
    hideMenuChrome();
    restoreMenuChrome();

    expect(el.style.display).toBe("flex");
  });

  // A slot added to the page between the two hide passes still gets recorded.
  it("records a slot that appears after the first hide", () => {
    hideMenuChrome();
    const late = ad();
    late.style.display = "block";
    hideMenuChrome();
    restoreMenuChrome();

    expect(late.style.display).toBe("block");
  });

  it("still clears the style for a slot that had none", () => {
    const el = ad();

    hideMenuChrome();
    restoreMenuChrome();

    expect(el.style.display).toBe("");
  });
});
