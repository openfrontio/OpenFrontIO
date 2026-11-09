import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import {
  STEAM_SKIN_DROP_KEYS,
  type SteamSkinDropAnswer,
} from "../../src/client/SteamSkinDrop";
import "../../src/client/SteamSkinDropModal";
import type { SteamSkinDropModal } from "../../src/client/SteamSkinDropModal";

// The preview's WebGL chunk cannot load here, as on a device without WebGL2.
vi.mock("../../src/client/components/cosmetics/CosmeticRenderCanvas", () => {
  throw new Error("no WebGL");
});

const resolved: ResolvedCosmetic = {
  type: "skin",
  cosmetic: {
    name: "moon",
    url: "/skins/moon.png",
    product: null,
    rarity: "epic",
    steamExclusive: true,
  } as never,
  colorPalette: null,
  relationship: "purchasable",
  key: "skin:moon",
};

const K = STEAM_SKIN_DROP_KEYS;

describe("SteamSkinDropModal", () => {
  let modal: SteamSkinDropModal;
  let answer: Promise<SteamSkinDropAnswer>;
  let settled: SteamSkinDropAnswer[];

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    modal = document.createElement(
      "steam-skin-drop-modal",
    ) as SteamSkinDropModal;
    document.body.appendChild(modal);
    settled = [];
    answer = modal.show(resolved);
    void answer.then((a) => settled.push(a));
    await modal.updateComplete;
  });

  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const flush = async () => {
    await modal.updateComplete;
    await Promise.resolve();
    await Promise.resolve();
  };
  it.each(["join-lobby", "session-cleared"])(
    "%s abandons the open popup",
    async (event) => {
      document.dispatchEvent(new CustomEvent(event));
      await flush();
      expect(settled).toEqual(["abandoned"]);
      expect(modal.querySelector("[data-steam-skin-drop]")).toBeNull();
    },
  );

  const buttonWithText = (text: string) =>
    [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;
  const dialog = () =>
    document.body.querySelector("confirm-dialog") as
      | (HTMLElement & { updateComplete: Promise<unknown> })
      | null;
  const openPrompt = async () => {
    modal.querySelector<HTMLElement>("[data-cosmetic-name]")!.click();
    await modal.updateComplete;
    await dialog()!.updateComplete;
  };

  it("renders the real cosmetic-card and the message", () => {
    const card = modal.querySelector("cosmetic-card") as unknown as {
      resolved: ResolvedCosmetic;
    };
    expect(card.resolved).toBe(resolved);
    expect(modal.textContent).toContain(K.message);
  });

  it("is aria-modal and moves focus into the panel", () => {
    const panel = modal.querySelector<HTMLElement>("[role='dialog']")!;
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(buttonWithText(K.claimEquip));
  });

  it("takes focus back if it is lost right after show()", async () => {
    (document.activeElement as HTMLElement).blur();
    expect(modal.contains(document.activeElement)).toBe(false);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(buttonWithText(K.claimEquip));
  });

  it("keeps Tab inside the panel", () => {
    const panel = modal.querySelector<HTMLElement>("[role='dialog']")!;
    const primary = buttonWithText(K.claimEquip);
    primary.focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    primary.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(primary);
  });

  it("puts the card first, then the message, then the buttons", () => {
    const card = modal.querySelector("cosmetic-card")!;
    const message = [...modal.querySelectorAll("p")].find((p) =>
      p.textContent?.includes(K.message),
    )!;
    const claim = buttonWithText(K.claim);
    const before = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(card.compareDocumentPosition(message) & before).toBeTruthy();
    expect(message.compareDocumentPosition(claim) & before).toBeTruthy();
  });

  it('Claim resolves "claim"', async () => {
    buttonWithText(K.claim).click();
    expect(await answer).toBe("claim");
    await modal.updateComplete;
    expect(modal.querySelector("cosmetic-card")).toBeNull();
  });

  it('Claim & equip resolves "equip"', async () => {
    buttonWithText(K.claimEquip).click();
    expect(await answer).toBe("equip");
  });

  it('the close button resolves "dismiss"', async () => {
    modal
      .querySelector<HTMLButtonElement>(`button[aria-label="${K.close}"]`)!
      .click();
    expect(await answer).toBe("dismiss");
  });

  it("a backdrop click does not resolve", async () => {
    modal.querySelector<HTMLElement>("[data-steam-skin-drop]")!.click();
    await flush();
    expect(settled).toEqual([]);
    expect(modal.querySelector("cosmetic-card")).not.toBeNull();
  });

  it("clicking the card opens the preview prompt and does not resolve", async () => {
    await openPrompt();
    expect(dialog()!.getAttribute("variant")).toBe("warning");
    expect(document.body.textContent).toContain(K.previewPrompt);
    expect(settled).toEqual([]);
  });

  it("the corner preview bubble opens the same prompt", async () => {
    const outer = vi.fn();
    document.body.addEventListener("open-cosmetic-preview", outer);
    modal.querySelector("cosmetic-preview-bubble")!.dispatchEvent(
      new CustomEvent("open-cosmetic-preview", {
        bubbles: true,
        composed: true,
        detail: resolved,
      }),
    );
    await modal.updateComplete;
    await dialog()!.updateComplete;
    expect(document.body.textContent).toContain(K.previewPrompt);
    expect(modal.querySelector("cosmetic-preview-modal")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(settled).toEqual([]);
  });

  it("Back returns to the popup, and Preview opens cosmetic-preview-modal with the popup hidden", async () => {
    await openPrompt();
    buttonWithText(K.previewBack).click();
    await modal.updateComplete;
    expect(dialog()).toBeNull();
    expect(modal.querySelector("cosmetic-card")).not.toBeNull();

    await openPrompt();
    buttonWithText(K.previewConfirm).click();
    await modal.updateComplete;
    expect(dialog()).toBeNull();
    expect(modal.querySelector("cosmetic-preview-modal")).not.toBeNull();
    expect(modal.querySelector("cosmetic-card")).toBeNull();
    expect(settled).toEqual([]);
  });

  it("closing the preview returns to the popup, still unanswered", async () => {
    await openPrompt();
    buttonWithText(K.previewConfirm).click();
    await modal.updateComplete;
    modal
      .querySelector("cosmetic-preview-modal")!
      .dispatchEvent(new CustomEvent("close-preview", { bubbles: true }));
    await flush();
    expect(modal.querySelector("cosmetic-preview-modal")).toBeNull();
    expect(modal.querySelector("cosmetic-card")).not.toBeNull();
    expect(settled).toEqual([]);
    buttonWithText(K.claim).click();
    expect(await answer).toBe("claim");
  });

  it('a second show() settles the first as "abandoned"', async () => {
    const second = modal.show(resolved);
    expect(await answer).toBe("abandoned");
    await modal.updateComplete;
    buttonWithText(K.claim).click();
    expect(await second).toBe("claim");
  });

  it('removing the popup settles a pending answer as "abandoned"', async () => {
    modal.remove();
    expect(await answer).toBe("abandoned");
  });
});
