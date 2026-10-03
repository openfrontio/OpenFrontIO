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
