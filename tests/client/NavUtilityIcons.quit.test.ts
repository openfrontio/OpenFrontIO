import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../src/client/components/NavUtilityIcons";

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

async function mount(): Promise<Mountable> {
  const el = document.createElement("nav-utility-icons") as Mountable;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function installShell(over: { quit?: unknown } = {}): {
  quit: ReturnType<typeof vi.fn>;
} {
  const quit = vi.fn(async () => undefined);
  window.openfrontDesktop = {
    shell: { api: 4 },
    quit,
    ...over,
  };
  return { quit };
}

function quitButton(el: ParentNode): HTMLButtonElement | null {
  return el.querySelector('[data-i18n-aria-label="main.quit"]');
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.currentPageId = "page-play";
});

afterEach(() => {
  window.openfrontDesktop = undefined;
});

// Moved here from the settings modal (OPE-445): a one-click door icon beside
// the cog rather than three menu levels deep. See NavUtilityIcons.ts for why
// that move does not reopen the no-confirmation decision from OPE-402.
describe("the nav's exit door", () => {
  it("renders on a desktop shell that exposes quit()", async () => {
    installShell();
    const el = await mount();
    expect(quitButton(el)).not.toBeNull();
  });

  // The regression that matters most: a door icon on the web is a button
  // that cannot work. The web build (and CrazyGames, which is a web build)
  // sets no openfrontDesktop global at all.
  it("is absent with no desktop shell", async () => {
    const el = await mount();
    expect(quitButton(el)).toBeNull();
  });

  // The shell currently in the Steam depot at the time of OPE-402 had other
  // bridge namespaces but no quit(); the icon must still feature-detect on
  // the method itself rather than on shell presence.
  it("is absent on a shell without quit()", async () => {
    window.openfrontDesktop = { shell: { api: 3 } };
    const el = await mount();
    expect(quitButton(el)).toBeNull();
  });

  it("asks the shell to quit when pressed", async () => {
    const { quit } = installShell();
    const el = await mount();
    quitButton(el)!.click();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  // No confirmation dialog, by decision (see the comment on
  // renderQuitButton). This fails on purpose if a confirm is later added
  // without updating that comment.
  it("quits on the first press, with nothing in between", async () => {
    const { quit } = installShell();
    const el = await mount();
    const before = el.querySelectorAll("button").length;
    quitButton(el)!.click();
    await el.updateComplete;
    expect(quit).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll("button").length).toBe(before);
  });

  // A shell whose quit() rejects (the renderer torn down mid-invoke is the
  // ordinary case) must not produce an unhandled rejection out of a click
  // handler.
  it("survives a quit() that rejects", async () => {
    installShell({
      quit: () => Promise.reject(new Error("channel closed")),
    });
    const el = await mount();
    expect(() => quitButton(el)!.click()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("sits right after the settings cog, outside the page-link list", async () => {
    installShell();
    const el = await mount();
    // Not a page link, so it must not show up among the router's targets.
    const pageButtons = Array.from(
      el.querySelectorAll<HTMLElement>(".nav-menu-item[data-page]"),
    ).map((b) => b.dataset.page);
    expect(pageButtons).toEqual(["page-news", "page-help", "page-settings"]);

    const settings = el.querySelector<HTMLElement>(
      '.nav-menu-item[data-page="page-settings"]',
    )!;
    expect(settings.nextElementSibling).toBe(quitButton(el));
  });

  it("labels the button for screen readers and on hover", async () => {
    installShell();
    const el = await mount();
    const button = quitButton(el)!;
    expect(button.getAttribute("data-i18n-aria-label")).toBe("main.quit");
    expect(button.getAttribute("data-i18n-title")).toBe("main.quit");
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
