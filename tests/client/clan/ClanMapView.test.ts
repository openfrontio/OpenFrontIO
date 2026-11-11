import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authMockFactory,
  flushAsync,
  utilsMockFactory,
} from "./ClanModalTestUtils";

vi.mock("../../../src/client/Api", () => ({
  getAudience: vi.fn(() => "openfront.dev"),
}));
vi.mock("../../../src/client/Auth", () => authMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());

import { getAudience } from "../../../src/client/Api";
import { userAuth } from "../../../src/client/Auth";
import { translationTemplates } from "../../../src/client/Utils";
import {
  ClanMapView,
  clanMapOrigin,
} from "../../../src/client/components/clan/ClanMapView";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MAP_ORIGIN = "https://clanmap.openfront.dev";

describe("clanMapOrigin", () => {
  it("targets the clanmap subdomain of the audience", () => {
    expect(clanMapOrigin()).toBe(MAP_ORIGIN);
  });

  it("targets the local worker in the localhost audience", () => {
    asMock(getAudience).mockReturnValueOnce("localhost");
    expect(clanMapOrigin()).toBe("http://clanmap.localhost:8787");
  });
});

describe("ClanMapView", () => {
  let view: ClanMapView;
  let frame: HTMLIFrameElement;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    if (!customElements.get("clan-map-view")) {
      customElements.define("clan-map-view", ClanMapView);
    }
    view = document.createElement("clan-map-view") as ClanMapView;
    document.body.appendChild(view);
    await flushAsync(view);
    frame = view.querySelector("iframe")!;
    postMessage = vi.fn();
    frame.contentWindow!.postMessage = postMessage as never;
  });

  afterEach(() => {
    view.remove();
    vi.clearAllMocks();
  });

  function ready(init: Partial<MessageEventInit> = {}) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: MAP_ORIGIN,
        source: frame.contentWindow,
        data: { type: "clanmap:ready" },
        ...init,
      }),
    );
  }

  it("frames the map page with fullscreen allowed", () => {
    expect(frame.getAttribute("src")).toBe(`${MAP_ORIGIN}/`);
    expect(frame.getAttribute("allow")).toBe("fullscreen");
    expect(frame.hasAttribute("sandbox")).toBe(false);
  });

  it("asks the page for its full-screen layout when full", async () => {
    view.full = true;
    await flushAsync(view);
    expect(view.querySelector("iframe")!.getAttribute("src")).toBe(
      `${MAP_ORIGIN}/?full=1`,
    );
  });

  it("answers clanmap:ready with the JWT, targeted at the map origin", async () => {
    ready();
    await flushAsync();

    expect(userAuth).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      { type: "clanmap:auth", jwt: "test-token" },
      MAP_ORIGIN,
    );
  });

  it("sends the page its text in the player's language, before the JWT", async () => {
    ready();
    await flushAsync();

    expect(translationTemplates).toHaveBeenCalledWith("clan_map.");
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      { type: "clanmap:lang", rtl: false, strings: { claim_land: "Claim land" } },
      MAP_ORIGIN,
    );
  });

  it("sends a signed-out viewer the text but no JWT", async () => {
    asMock(userAuth).mockResolvedValueOnce(false);
    ready();
    await flushAsync();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].type).toBe("clanmap:lang");
  });

  it("ignores messages from another origin", async () => {
    ready({ origin: "https://evil.example" });
    await flushAsync();

    expect(userAuth).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("ignores messages from a window other than its own frame", async () => {
    ready({ source: window });
    await flushAsync();

    expect(userAuth).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("ignores other message types", async () => {
    ready({ data: { type: "clanmap:other" } });
    await flushAsync();

    expect(postMessage).not.toHaveBeenCalled();
  });

  const spinner = () => view.querySelector('[role="status"]');

  it("covers the frame with a spinner until the page reports loaded", async () => {
    expect(spinner()).not.toBeNull();

    ready({ data: { type: "clanmap:loaded" } });
    await flushAsync(view);

    expect(spinner()).toBeNull();
  });

  it("keeps the spinner for clanmap:loaded from a foreign origin", async () => {
    ready({ origin: "https://evil.example", data: { type: "clanmap:loaded" } });
    await flushAsync(view);

    expect(spinner()).not.toBeNull();
  });

  it("keeps the spinner for clanmap:loaded from a window other than its own frame", async () => {
    ready({ source: window, data: { type: "clanmap:loaded" } });
    await flushAsync(view);

    expect(spinner()).not.toBeNull();
  });

  it("stops listening once removed", async () => {
    view.remove();
    ready();
    await flushAsync();

    expect(userAuth).not.toHaveBeenCalled();
  });
});
