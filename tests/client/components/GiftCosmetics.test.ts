import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OModal } from "../../../src/client/components/baseComponents/Modal";
import { BaseModal } from "../../../src/client/components/BaseModal";
import { CosmeticButton } from "../../../src/client/components/CosmeticButton";
import { GiftFriendPicker } from "../../../src/client/components/GiftFriendPicker";
import type { ResolvedCosmetic } from "../../../src/client/Cosmetics";
import type { FriendsListResponse } from "../../../src/core/ApiSchemas";
import type { Flag } from "../../../src/core/CosmeticSchemas";

const fetchFriends = vi.hoisted(() => vi.fn());

vi.mock("../../../src/client/FriendsApi", () => ({ fetchFriends }));

@customElement("gift-test-modal")
class GiftTestModal extends BaseModal {
  protected modalConfig() {
    return {
      title: "Store",
      hideHeader: false,
      hideCloseButton: false,
    };
  }

  protected renderBody() {
    return html`<button type="button" data-store-gift>Store Gift</button>`;
  }
}

@customElement("titleless-custom-header-test-modal")
class TitlelessCustomHeaderTestModal extends BaseModal {
  protected modalConfig() {
    return {
      hideHeader: true,
      hideCloseButton: false,
    };
  }

  protected renderHeaderSlot() {
    return html`<h2>Custom store header</h2>`;
  }
}

@customElement("explicit-label-test-modal")
class ExplicitLabelTestModal extends BaseModal {
  protected modalConfig() {
    return {
      accessibleLabel: "Custom store",
      hideHeader: true,
      hideCloseButton: false,
    };
  }

  protected renderHeaderSlot() {
    return html`<h2>Custom store header</h2>`;
  }
}

function friend(publicId: string) {
  return { publicId, createdAt: "2026-07-18T12:00:00.000Z" };
}

function friendsPage(
  results: FriendsListResponse["results"],
  total: number,
  page: number,
  limit = 50,
): FriendsListResponse {
  return { results, total, page, limit };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mount<T extends LitElement>(element: T): Promise<T> {
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

function deepActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

async function renderedModal(host: BaseModal): Promise<OModal> {
  await host.updateComplete;
  const modal = host.querySelector<OModal>("o-modal");
  expect(modal).not.toBeNull();
  await modal!.updateComplete;
  await Promise.resolve();
  return modal!;
}

async function openNestedPicker() {
  fetchFriends.mockResolvedValue(friendsPage([], 0, 1));
  const invoke = document.createElement("button");
  document.body.appendChild(invoke);
  const store = await mount(new GiftTestModal());
  invoke.focus();
  store.open();
  await renderedModal(store);
  const storeGift =
    store.querySelector<HTMLButtonElement>("[data-store-gift]")!;
  storeGift.focus();

  const picker = await mount(new GiftFriendPicker());
  await picker.open();
  const pickerModal = await renderedModal(picker);
  const pickerClose = pickerModal.shadowRoot?.querySelector<HTMLButtonElement>(
    "button[data-modal-close]",
  );
  expect(pickerClose).toBeInstanceOf(HTMLButtonElement);
  expect(deepActiveElement()).toBe(pickerClose);

  return { invoke, store, storeGift, picker, pickerClose };
}

describe("gift cosmetics components", () => {
  beforeEach(() => {
    fetchFriends.mockReset();
    const langSelector = document.createElement(
      "lang-selector",
    ) as HTMLElement & {
      currentLang: string;
    };
    langSelector.currentLang = "debug";
    document.body.appendChild(langSelector);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("requests friends in 50-item pages and collects later pages", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      friend(`friend-${index}`),
    );
    fetchFriends
      .mockResolvedValueOnce(friendsPage(firstPage, 51, 1))
      .mockResolvedValueOnce(friendsPage([friend("friend-50")], 51, 2));
    const picker = await mount(new GiftFriendPicker());

    await picker.open();
    await picker.updateComplete;

    expect(fetchFriends).toHaveBeenNthCalledWith(1, 1, 50);
    expect(fetchFriends).toHaveBeenNthCalledWith(2, 2, 50);
    expect(picker.querySelectorAll("[data-friend-public-id]")).toHaveLength(51);
  });

  it("stops pagination safely when a page is unexpectedly empty", async () => {
    const fullPage = Array.from({ length: 50 }, (_, index) =>
      friend(`friend-${index}`),
    );
    fetchFriends
      .mockResolvedValueOnce(friendsPage(fullPage, 100, 1))
      .mockResolvedValueOnce(friendsPage([], 100, 2));
    const picker = await mount(new GiftFriendPicker());

    await picker.open();

    expect(fetchFriends).toHaveBeenCalledTimes(2);
  });

  it("renders a localized load error instead of the no-friends state", async () => {
    fetchFriends.mockResolvedValue(false);
    const picker = await mount(new GiftFriendPicker());

    await picker.open();
    await picker.updateComplete;

    expect(picker.textContent).toContain("store.gift_load_error");
    expect(picker.textContent).not.toContain("store.gift_no_friends");
  });

  it("ignores stale loads and invokes the newest callback after closing", async () => {
    const stale = deferred<FriendsListResponse | false>();
    const newest = deferred<FriendsListResponse | false>();
    fetchFriends
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(newest.promise);
    const picker = await mount(new GiftFriendPicker());
    const oldCallback = vi.fn();
    const newCallback = vi.fn(() => {
      expect(picker.isOpen()).toBe(false);
    });

    picker.onSelect = oldCallback;
    const staleOpen = picker.open();
    await vi.waitFor(() => expect(fetchFriends).toHaveBeenCalledTimes(1));
    picker.onSelect = newCallback;
    const newestOpen = picker.open();
    newest.resolve(friendsPage([friend("newest-friend")], 1, 1));
    await newestOpen;
    stale.resolve(friendsPage([friend("stale-friend")], 1, 1));
    await staleOpen;
    await picker.updateComplete;

    expect(picker.textContent).toContain("newest-friend");
    expect(picker.textContent).not.toContain("stale-friend");
    picker
      .querySelector<HTMLButtonElement>("[data-friend-public-id] button")!
      .click();
    expect(newCallback).toHaveBeenCalledWith("newest-friend");
    expect(oldCallback).not.toHaveBeenCalled();
  });

  it("closes only the topmost picker on Escape", async () => {
    fetchFriends.mockReturnValue(new Promise(() => undefined));
    const store = await mount(new GiftTestModal());
    store.open();
    const picker = await mount(new GiftFriendPicker());
    void picker.open();
    await picker.updateComplete;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();

    expect(picker.isOpen()).toBe(false);
    expect(store.isOpen()).toBe(true);
  });

  it("renders the localized title as the modal dialog's accessible name", async () => {
    fetchFriends.mockResolvedValue(friendsPage([], 0, 1));
    const picker = await mount(new GiftFriendPicker());

    await picker.open();
    const modal = await renderedModal(picker);
    const dialog =
      modal.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]');
    const labelledBy = dialog?.getAttribute("aria-labelledby");

    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(labelledBy).toBeTruthy();
    expect(
      modal.shadowRoot?.getElementById(labelledBy!)?.textContent?.trim(),
    ).toBe("store.gift_pick_friend");
  });

  it("does not expose an unnamed dialog role for a titleless custom-header modal", async () => {
    const host = await mount(new TitlelessCustomHeaderTestModal());
    host.open();
    const modal = await renderedModal(host);
    const panel =
      modal.shadowRoot?.querySelector<HTMLElement>("[data-modal-panel]");

    expect(panel).toBeInstanceOf(HTMLElement);
    expect(panel?.hasAttribute("role")).toBe(false);
    expect(panel?.hasAttribute("aria-modal")).toBe(false);
    expect(panel?.hasAttribute("aria-labelledby")).toBe(false);
    expect(panel?.hasAttribute("aria-label")).toBe(false);
  });

  it("plumbs an explicit accessible label to a named dialog", async () => {
    const host = await mount(new ExplicitLabelTestModal());
    host.open();
    const modal = await renderedModal(host);
    const panel =
      modal.shadowRoot?.querySelector<HTMLElement>("[data-modal-panel]");

    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(panel?.getAttribute("aria-label")).toBe("Custom store");
    expect(panel?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("moves focus from the invoking control into the opened picker", async () => {
    fetchFriends.mockResolvedValue(friendsPage([], 0, 1));
    const invoke = document.createElement("button");
    document.body.appendChild(invoke);
    const picker = await mount(new GiftFriendPicker());
    invoke.focus();

    await picker.open();
    const modal = await renderedModal(picker);
    const close = modal.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-modal-close]",
    );

    expect(deepActiveElement()).toBe(close);
  });

  it("moves focus to the stable close control marker in the English locale", async () => {
    const langSelector = document.querySelector(
      "lang-selector",
    ) as HTMLElement & {
      currentLang: string;
      translations?: Record<string, string>;
      defaultTranslations?: Record<string, string>;
    };
    langSelector.currentLang = "en";
    langSelector.translations = { "common.close": "Close" };
    langSelector.defaultTranslations = { "common.close": "Close" };
    fetchFriends.mockResolvedValue(friendsPage([], 0, 1));
    const invoke = document.createElement("button");
    document.body.appendChild(invoke);
    const picker = await mount(new GiftFriendPicker());
    invoke.focus();

    await picker.open();
    const modal = await renderedModal(picker);
    const close = modal.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-modal-close]",
    );

    expect(close?.getAttribute("aria-label")).toBe("Close");
    expect(deepActiveElement()).toBe(close);
  });

  it("traps forward and reverse Tab in the top picker across shadow and slotted controls", async () => {
    fetchFriends.mockResolvedValue(
      friendsPage([friend("specific-friend")], 1, 1),
    );
    const store = await mount(new GiftTestModal());
    store.open();
    const storeModal = await renderedModal(store);
    const backgroundGift =
      store.querySelector<HTMLButtonElement>("[data-store-gift]")!;
    backgroundGift.focus();

    const picker = await mount(new GiftFriendPicker());
    await picker.open();
    const pickerModal = await renderedModal(picker);
    const close = pickerModal.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-modal-close]",
    );
    const recipient = picker.querySelector<HTMLButtonElement>(
      "[data-friend-public-id] button",
    )!;
    expect(close).toBeInstanceOf(HTMLButtonElement);
    if (!close) throw new Error("Picker close button was not rendered");

    close.focus();
    const reverseTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    close.dispatchEvent(reverseTab);
    expect(reverseTab.defaultPrevented).toBe(true);
    expect(deepActiveElement()).toBe(recipient);

    recipient.focus();
    const forwardTab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    recipient.dispatchEvent(forwardTab);
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(deepActiveElement()).toBe(close);
    expect(deepActiveElement()).not.toBe(backgroundGift);
    expect(storeModal.isModalOpen).toBe(true);
  });

  it("restores focus to the connected invoking control when closed", async () => {
    fetchFriends.mockResolvedValue(friendsPage([], 0, 1));
    const invoke = document.createElement("button");
    document.body.appendChild(invoke);
    const picker = await mount(new GiftFriendPicker());
    invoke.focus();
    await picker.open();
    const modal = await renderedModal(picker);
    modal.shadowRoot
      ?.querySelector<HTMLButtonElement>("button[data-modal-close]")
      ?.focus();

    picker.close();

    expect(deepActiveElement()).toBe(invoke);
  });

  it("restores focus to the connected invoking control when disconnected", async () => {
    fetchFriends.mockResolvedValue(friendsPage([], 0, 1));
    const invoke = document.createElement("button");
    document.body.appendChild(invoke);
    const picker = await mount(new GiftFriendPicker());
    invoke.focus();
    await picker.open();
    const modal = await renderedModal(picker);
    modal.shadowRoot
      ?.querySelector<HTMLButtonElement>("button[data-modal-close]")
      ?.focus();

    picker.remove();

    expect(deepActiveElement()).toBe(invoke);
  });

  it("keeps focus in the newer top dialog when the underlying modal closes", async () => {
    const { store, picker, pickerClose } = await openNestedPicker();

    store.close();
    await Promise.resolve();

    expect(picker.isOpen()).toBe(true);
    expect(deepActiveElement()).toBe(pickerClose);
  });

  it("keeps focus in the newer top dialog when the underlying modal disconnects", async () => {
    const { store, picker, pickerClose } = await openNestedPicker();

    store.remove();
    await Promise.resolve();

    expect(picker.isOpen()).toBe(true);
    expect(deepActiveElement()).toBe(pickerClose);
  });

  it("restores focus from a closing top dialog to its underlying modal", async () => {
    const { storeGift, picker } = await openNestedPicker();

    picker.close();
    await Promise.resolve();

    expect(deepActiveElement()).toBe(storeGift);
  });

  it("does not restore behind a newer modal opened during onClose", async () => {
    const invoke = document.createElement("button");
    document.body.appendChild(invoke);
    const underlying = new OModal();
    underlying.title = "Underlying";
    await mount(underlying);
    const newer = new OModal();
    newer.title = "Newer";
    await mount(newer);
    invoke.focus();
    underlying.open();
    await underlying.updateComplete;
    await Promise.resolve();
    underlying.onClose = () => newer.open();

    underlying.close();

    expect(deepActiveElement()).not.toBe(invoke);
    await newer.updateComplete;
    await Promise.resolve();
    expect(deepActiveElement()).toBe(
      newer.shadowRoot?.querySelector("[data-modal-close]"),
    );
  });

  it("renders the shared close glyph as an accessible button", async () => {
    const modal = await mount(new OModal());
    modal.open();
    await modal.updateComplete;

    const close = modal.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-modal-close]",
    );
    expect(close).toBeInstanceOf(HTMLButtonElement);
    expect(close?.type).toBe("button");
  });

  it("Gift click invokes only gifting and does not start normal checkout", async () => {
    const resolved: ResolvedCosmetic = {
      type: "flag",
      cosmetic: {
        name: "camo",
        rarity: "common",
        product: {
          productId: "prod_1",
          priceId: "price_1",
          price: "4.99",
        },
        url: "/flags/test.svg",
      } as Flag,
      colorPalette: null,
      relationship: "purchasable",
      key: "flag:camo",
    };
    const gift = vi.fn();
    const purchase = vi.fn(async () => undefined);
    const button = new CosmeticButton();
    button.resolved = resolved;
    button.onGift = gift;
    button.onPurchase = purchase;
    await mount(button);

    const giftButton = Array.from(button.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("store.gift"),
    );
    expect(giftButton?.getAttribute("type")).toBe("button");
    giftButton?.click();
    await Promise.resolve();

    expect(gift).toHaveBeenCalledTimes(1);
    expect(purchase).not.toHaveBeenCalled();
  });

  it("labels each recipient Gift button with the friend's public ID", async () => {
    fetchFriends.mockResolvedValue(
      friendsPage([friend("specific-friend")], 1, 1),
    );
    const picker = await mount(new GiftFriendPicker());

    await picker.open();
    await picker.updateComplete;

    expect(
      picker
        .querySelector("[data-friend-public-id] button")
        ?.getAttribute("aria-label"),
    ).toBe("store.gift_to_friend::friend=specific-friend");
  });
});
