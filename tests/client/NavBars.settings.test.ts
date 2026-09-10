import { beforeEach, describe, expect, it } from "vitest";

import { DesktopNavBar } from "../../src/client/components/DesktopNavBar";
import { MobileNavBar } from "../../src/client/components/MobileNavBar";

// Settings is a top-level nav item again (OPE-173): it used to be reachable
// only through the account dropdown, which shows as "Sign in" when logged out.
describe.each([
  ["desktop-nav-bar", DesktopNavBar],
  ["mobile-nav-bar", MobileNavBar],
])("%s settings item", (tag, ctor) => {
  let el: HTMLElement & { updateComplete: Promise<unknown> };

  beforeEach(async () => {
    // The @customElement decorator's define() side-effect doesn't run under the
    // test transform, so register the element explicitly.
    if (!customElements.get(tag)) {
      customElements.define(tag, ctor as CustomElementConstructor);
    }
    window.currentPageId = "page-play";
    el = document.createElement(tag) as typeof el;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  const settingsItem = () =>
    el.querySelector<HTMLElement>('.nav-menu-item[data-page="page-settings"]');

  it("renders a settings nav item the delegated router can route", () => {
    const item = settingsItem();
    expect(item).not.toBeNull();
    // Navigation.ts routes every .nav-menu-item[data-page] click through
    // showPage(), and index.html already carries
    // <user-setting id="page-settings" inline>, so no routing code is needed.
    expect(item!.getAttribute("data-i18n")).toBe("main.settings");
  });

  it("marks the settings item active once the settings page is shown", async () => {
    expect(settingsItem()!.classList.contains("active")).toBe(false);

    window.dispatchEvent(
      new CustomEvent("showPage", { detail: "page-settings" }),
    );
    await el.updateComplete;

    expect(settingsItem()!.classList.contains("active")).toBe(true);
  });
});
