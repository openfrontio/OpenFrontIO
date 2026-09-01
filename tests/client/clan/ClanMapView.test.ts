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

  it("answers clanmap:ready with the JWT, targeted at the map origin", async () => {
    ready();
    await flushAsync();

    expect(userAuth).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      { type: "clanmap:auth", jwt: "test-token" },
      MAP_ORIGIN,
    );
  });

  it("stays silent for a signed-out viewer", async () => {
    asMock(userAuth).mockResolvedValueOnce(false);
    ready();
    await flushAsync();

    expect(postMessage).not.toHaveBeenCalled();
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

  it("fullscreens the frame element on request", () => {
    const request = vi.fn(() => Promise.resolve());
    frame.requestFullscreen = request as never;

    view.enterFullscreen();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stops listening once removed", async () => {
    view.remove();
    ready();
    await flushAsync();

    expect(userAuth).not.toHaveBeenCalled();
  });
});
