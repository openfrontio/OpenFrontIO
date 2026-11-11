import { html, render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { hudModalHeader } from "../../src/client/hud/HudModal";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

function mount(props: Parameters<typeof hudModalHeader>[0]): HTMLElement {
  const root = document.createElement("div");
  render(hudModalHeader(props), root);
  return root;
}

describe("hudModalHeader", () => {
  it("renders the title as an h2 a dialog can point aria-labelledby at", () => {
    const root = mount({
      title: "Menu",
      titleId: "menu-title",
      onClose: () => {},
    });
    const h2 = root.querySelector("h2")!;
    expect(h2.id).toBe("menu-title");
    expect(h2.textContent!.trim()).toBe("Menu");
  });

  it("names the close button and calls onClose once per click", () => {
    const onClose = vi.fn();
    const root = mount({ title: "Menu", titleId: "t", onClose });
    const close = root.querySelector<HTMLButtonElement>(
      'button[aria-label="common.close"]',
    )!;
    expect(close).not.toBeNull();
    expect(close.title).toBe("common.close");
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    close.click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("puts the actions before the close button", () => {
    const root = mount({
      title: "Quick chat",
      titleId: "t",
      onClose: () => {},
      actions: html`<button data-action>All phrases</button>`,
    });
    const buttons = [...root.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].hasAttribute("data-action")).toBe(true);
    expect(buttons[1].getAttribute("aria-label")).toBe("common.close");
  });

  it("shows the subtitle after the title, and adds nothing without one", () => {
    const withSubtitle = mount({
      title: "Quick chat",
      titleId: "t",
      subtitle: "Bob",
      onClose: () => {},
    });
    expect(
      withSubtitle.querySelector("h2")!.nextElementSibling!.textContent!.trim(),
    ).toBe("Bob");

    const without = mount({
      title: "Quick chat",
      titleId: "t",
      onClose: () => {},
    });
    // The next element is already the one holding the close button.
    const next = without.querySelector("h2")!.nextElementSibling!;
    expect(next.querySelector("button")).not.toBeNull();
  });
});
