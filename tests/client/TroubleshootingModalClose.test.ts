import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/HelpModal";
import type { HelpModal } from "../../src/client/HelpModal";
import { initNavigation } from "../../src/client/Navigation";
import "../../src/client/TroubleshootingModal";
import type { TroubleshootingModal } from "../../src/client/TroubleshootingModal";

vi.mock("../../src/client/utilities/Diagnostic", () => ({
  collectGraphicsDiagnostics: () => new Promise(() => {}),
}));

function inlinePage<T extends HTMLElement>(tag: string, id: string): T {
  const el = document.createElement(tag) as T;
  el.id = id;
  el.setAttribute("inline", "");
  el.className = "page-content hidden";
  document.body.appendChild(el);
  return el;
}

describe("TroubleshootingModal.close", () => {
  let help: HelpModal;
  let troubleshooting: TroubleshootingModal;

  beforeEach(async () => {
    history.replaceState(null, "", "/");
    const play = document.createElement("div");
    play.id = "page-play";
    document.body.appendChild(play);
    help = inlinePage<HelpModal>("help-modal", "page-help");
    troubleshooting = inlinePage<TroubleshootingModal>(
      "troubleshooting-modal",
      "page-troubleshooting",
    );
    await help.updateComplete;
    await troubleshooting.updateComplete;
    initNavigation();
  });

  afterEach(() => document.body.replaceChildren());

  it("does not open Help or its video when closed without being open", async () => {
    troubleshooting.close();
    await help.updateComplete;

    expect(help.isOpen()).toBe(false);
    expect(help.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("page-play")?.classList).not.toContain(
      "hidden",
    );
    expect(
      help.querySelector("#tutorial-video-iframe")?.getAttribute("src") ?? "",
    ).not.toContain("youtube");
  });

  it("returns to Help when the open panel is closed", async () => {
    help.open();
    troubleshooting.open();
    expect(help.isOpen()).toBe(false);

    troubleshooting.close();

    expect(troubleshooting.isOpen()).toBe(false);
    expect(troubleshooting.classList.contains("hidden")).toBe(true);
    expect(help.isOpen()).toBe(true);
    expect(help.classList.contains("hidden")).toBe(false);
  });
});
