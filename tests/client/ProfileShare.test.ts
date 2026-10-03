import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyToClipboardMock = vi.hoisted(() => vi.fn(async () => undefined));
const showToastMock = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ isTouch: false }));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  copyToClipboard: copyToClipboardMock,
  showToast: showToastMock,
}));

vi.mock("../../src/client/Platform", () => ({ Platform: platform }));

import {
  discordShareText,
  ProfileShare,
  xShareUrl,
} from "../../src/client/components/ProfileShare";

if (!customElements.get("profile-share")) {
  customElements.define("profile-share", ProfileShare);
}

const URL_ = "https://openfront.io/player/aB3dE5fX";
const LINE = 'player_profile.share_text:{"name":"Wonder & Co"}';

describe("share links", () => {
  it("builds the X compose URL with the link and line encoded", () => {
    expect(xShareUrl(URL_, "Wonder & Co's profile #1")).toBe(
      "https://x.com/intent/post?url=https%3A%2F%2Fopenfront.io%2Fplayer%2FaB3dE5fX&text=Wonder%20%26%20Co's%20profile%20%231",
    );
  });

  it("puts the line before the link for Discord", () => {
    expect(discordShareText(URL_, "Look")).toBe(`Look\n${URL_}`);
  });
});

describe("<profile-share>", () => {
  let el: ProfileShare;
  let openSpy: ReturnType<typeof vi.spyOn>;

  async function render(): Promise<void> {
    el = document.createElement("profile-share") as ProfileShare;
    el.url = URL_;
    el.name = "Wonder & Co";
    document.body.appendChild(el);
    await el.updateComplete;
  }

  const button = (action: string) =>
    el.querySelector<HTMLButtonElement>(`[data-share="${action}"]`);

  beforeEach(() => {
    copyToClipboardMock.mockReset();
    copyToClipboardMock.mockResolvedValue(undefined);
    showToastMock.mockReset();
    platform.isTouch = false;
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    el?.remove();
    openSpy.mockRestore();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "share");
  });

  it("offers copy, X and Discord on a desktop", async () => {
    await render();
    expect(
      [...el.querySelectorAll("[data-share]")].map((b) =>
        b.getAttribute("data-share"),
      ),
    ).toEqual(["copy", "x", "discord"]);
    expect(button("copy")?.textContent).toContain(
      "player_profile.share_copy_link",
    );
  });

  it("copies the link, toasts and announces it", async () => {
    await render();
    button("copy")!.click();
    await vi.waitFor(() =>
      expect(copyToClipboardMock).toHaveBeenCalledWith(URL_),
    );
    await vi.waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("common.copied", "green"),
    );
    await el.updateComplete;
    const live = el.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("common.copied");
  });

  it("says so when the copy fails", async () => {
    copyToClipboardMock.mockRejectedValue(new Error("denied"));
    await render();
    button("copy")!.click();
    await vi.waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("common.failed_copy", "red"),
    );
  });

  it("opens X's composer in a new tab", async () => {
    await render();
    button("x")!.click();
    expect(openSpy).toHaveBeenCalledWith(
      xShareUrl(URL_, LINE),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("copies the line and link for Discord", async () => {
    await render();
    button("discord")!.click();
    await vi.waitFor(() =>
      expect(copyToClipboardMock).toHaveBeenCalledWith(`${LINE}\n${URL_}`),
    );
  });

  it("uses the native share sheet on a touch device that has one", async () => {
    platform.isTouch = true;
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    await render();
    expect(el.querySelectorAll("[data-share]")).toHaveLength(1);
    button("native")!.click();
    expect(share).toHaveBeenCalledWith({
      title: "player_profile.title",
      text: LINE,
      url: URL_,
    });
  });

  it("does nothing when the share sheet is dismissed, and copies when it fails", async () => {
    platform.isTouch = true;
    const share = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("dismissed", "AbortError"))
      .mockRejectedValueOnce(new Error("not allowed"));
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    await render();
    button("native")!.click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(copyToClipboardMock).not.toHaveBeenCalled();

    button("native")!.click();
    await vi.waitFor(() =>
      expect(copyToClipboardMock).toHaveBeenCalledWith(URL_),
    );
  });

  it("keeps the three buttons on a touch device without a share sheet", async () => {
    platform.isTouch = true;
    await render();
    expect(el.querySelectorAll("[data-share]")).toHaveLength(3);
  });
});

describe("<profile-share> as a menu, for a moment", () => {
  const MOMENT_URL = `${URL_}?moment=level50`;
  const MOMENT_LINE = "I just reached Level 50 on OpenFront!";
  let el: ProfileShare;
  let openSpy: ReturnType<typeof vi.spyOn>;

  async function render(): Promise<void> {
    el = document.createElement("profile-share") as ProfileShare;
    el.layout = "menu";
    el.label = "Share Level 50";
    el.url = MOMENT_URL;
    el.text = MOMENT_LINE;
    document.body.appendChild(el);
    await el.updateComplete;
  }

  const trigger = () =>
    el.querySelector<HTMLButtonElement>('[data-share="menu"]')!;
  const menu = () => el.querySelector<HTMLElement>("[data-share-menu]");
  const item = (action: string) =>
    el.querySelector<HTMLButtonElement>(
      `[data-share-menu] [data-share="${action}"]`,
    );

  async function open(): Promise<void> {
    trigger().click();
    await el.updateComplete;
  }

  beforeEach(() => {
    copyToClipboardMock.mockReset();
    copyToClipboardMock.mockResolvedValue(undefined);
    platform.isTouch = false;
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    el?.remove();
    openSpy.mockRestore();
    Reflect.deleteProperty(navigator, "share");
  });

  it("is one labelled button until opened", async () => {
    await render();
    expect(el.querySelectorAll("[data-share]")).toHaveLength(1);
    expect(trigger().textContent).toContain("Share Level 50");
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
  });

  it("opens the same three actions as a menu, focusing the first", async () => {
    await render();
    await open();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu()?.getAttribute("role")).toBe("menu");
    const actions = [...menu()!.querySelectorAll("[role=menuitem]")].map((b) =>
      b.getAttribute("data-share"),
    );
    expect(actions).toEqual(["copy", "x", "discord"]);
    await Promise.resolve();
    expect(document.activeElement).toBe(item("copy"));
  });

  it("shares the moment's link and line, then closes", async () => {
    await render();
    await open();
    item("copy")!.click();
    await el.updateComplete;
    expect(copyToClipboardMock).toHaveBeenCalledWith(MOMENT_URL);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    await open();
    item("x")!.click();
    expect(openSpy).toHaveBeenCalledWith(
      xShareUrl(MOMENT_URL, MOMENT_LINE),
      "_blank",
      "noopener,noreferrer",
    );

    await open();
    item("discord")!.click();
    await vi.waitFor(() =>
      expect(copyToClipboardMock).toHaveBeenCalledWith(
        `${MOMENT_LINE}\n${MOMENT_URL}`,
      ),
    );
  });

  it("closes on Escape, keeping the key from what holds it", async () => {
    await render();
    await open();
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    item("copy")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await el.updateComplete;
    document.body.removeEventListener("keydown", outer);
    expect(menu()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it("moves between the items with the arrow keys", async () => {
    await render();
    await open();
    await Promise.resolve();
    const key = (k: string) =>
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
      );
    key("ArrowDown");
    expect(document.activeElement).toBe(item("x"));
    key("End");
    expect(document.activeElement).toBe(item("discord"));
    key("ArrowDown");
    expect(document.activeElement).toBe(item("copy"));
    key("ArrowUp");
    expect(document.activeElement).toBe(item("discord"));
  });

  it("closes on a press outside it", async () => {
    await render();
    await open();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await el.updateComplete;
    expect(menu()).toBeNull();
  });

  it("opens the share sheet straight away on a touch device", async () => {
    platform.isTouch = true;
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    await render();
    expect(trigger().hasAttribute("aria-haspopup")).toBe(false);
    trigger().click();
    await el.updateComplete;
    expect(menu()).toBeNull();
    expect(share).toHaveBeenCalledWith({
      title: "player_profile.title",
      text: MOMENT_LINE,
      url: MOMENT_URL,
    });
  });
});
