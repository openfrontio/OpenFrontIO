import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import "../../src/client/components/card/CardItemPreview";
import type { CardItemPreview } from "../../src/client/components/card/CardItemPreview";
import { defaultPlayerCardView } from "../../src/client/components/card/PlayerCardModel";

const BG = {
  product: null,
  rarity: "epic",
  name: "bg_storm",
  url: "/bg/storm.webp",
};

let preview: CardItemPreview;
let opener: HTMLButtonElement;
const onClose = vi.fn();

async function render() {
  opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  preview = document.createElement("card-item-preview") as CardItemPreview;
  preview.entry = { type: "cardBackground", item: BG as never };
  preview.view = {
    ...defaultPlayerCardView("iamlewis", null),
    background: { name: "bg_storm", url: "/bg/storm.webp", rarity: "epic" },
  };
  preview.onClose = onClose;
  document.body.appendChild(preview);
  await preview.updateComplete;
}

afterEach(() => {
  preview?.remove();
  opener?.remove();
  onClose.mockReset();
});

describe("<card-item-preview>", () => {
  it("is a modal dialog with the item's name and a large animated card", async () => {
    await render();
    const dialog = preview.querySelector("[role='dialog']")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Storm");
    const card = preview.querySelector("player-card")!;
    expect(card.getAttribute("size")).toBe("account");
    expect(card.hasAttribute("animated")).toBe(true);
  });

  it("moves focus in, and back to what opened it on close", async () => {
    await render();
    expect(document.activeElement).toBe(
      preview.querySelector("[data-card-preview-close]"),
    );
    preview.remove();
    expect(document.activeElement).toBe(opener);
  });

  it("Escape closes it, and only it", async () => {
    await render();
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.removeEventListener("keydown", behind);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it("keeps Tab inside", async () => {
    await render();
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(preview.contains(document.activeElement)).toBe(true);
  });

  it("the close button and the backdrop close it", async () => {
    await render();
    preview
      .querySelector<HTMLButtonElement>("[data-card-preview-close]")!
      .click();
    preview.querySelector<HTMLElement>("[data-card-preview-backdrop]")!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
