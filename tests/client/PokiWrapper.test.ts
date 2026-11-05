import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

// Runs the script of the page we upload to Poki (poki-wrapper/index.html)
// against a fake SDK, with the game frame's messages handed straight to it.

const GAME = "https://openfront.io";
const page = readFileSync("poki-wrapper/index.html", "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(page)![1];

type Poki = NonNullable<Window["PokiSDK"]>;
type Handler = (event: Partial<MessageEvent>) => void;

describe("Poki wrapper page", () => {
  let poki: Poki;
  let frame: HTMLIFrameElement;
  let replies: Mock<(message: unknown, targetOrigin?: unknown) => void>;
  let onMessage: Handler;
  let sdkScripts: HTMLScriptElement[];

  beforeEach(() => {
    poki = {
      init: vi.fn(async () => {}),
      gameLoadingFinished: vi.fn(),
      gameplayStart: vi.fn(),
      gameplayStop: vi.fn(),
      commercialBreak: vi.fn(async (onStart?: () => void) => onStart?.()),
      shareableURL: vi.fn(async () => ""),
      getURLParam: vi.fn(() => ""),
      openExternalLink: vi.fn(),
      login: vi.fn(async () => {}),
      getUser: vi.fn(async () => null),
      getToken: vi.fn(async () => "poki-token"),
    };
    window.PokiSDK = poki;
    sdkScripts = [];
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      sdkScripts.push(node as HTMLScriptElement);
      return node;
    });
    frame = document.createElement("iframe");
    document.body.appendChild(frame);
    // oxlint-disable-next-line no-implied-eval -- Running the page's own script is the test.
    new Function("f", "addEventListener", script)(
      frame,
      (_type: string, handler: Handler) => (onMessage = handler),
    );
    // After the script sets the frame's src, which gives it a new window.
    replies = vi.fn();
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(replies);
    sdkScripts[0].onload!(new Event("load"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    frame.remove();
    delete window.PokiSDK;
  });

  let nextId = 0;
  async function fromGame(
    method: string,
    args: unknown[] = [],
    options: { origin?: string; source?: Window | null; id?: string } = {},
  ): Promise<void> {
    onMessage({
      data: {
        ofPoki: true,
        id: options.id ?? `call-${++nextId}`,
        method,
        args,
      },
      origin: options.origin ?? GAME,
      source:
        options.source === undefined ? frame.contentWindow : options.source,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function gameLoad(): Promise<void> {
    await fromGame("hello");
    await fromGame("init");
    await fromGame("gameLoadingFinished");
  }

  it("starts Poki once across game loads", async () => {
    await gameLoad();
    await gameLoad();
    expect(sdkScripts).toHaveLength(1);
    expect(poki.init).toHaveBeenCalledOnce();
    expect(poki.gameLoadingFinished).toHaveBeenCalledOnce();
    expect(replies).toHaveBeenCalledWith(
      { ofPoki: true, id: "call-1", result: true },
      GAME,
    );
  });

  it("stops the gameplay a reloaded game left running", async () => {
    await gameLoad();
    await fromGame("gameplayStart");
    await fromGame("gameplayStart");
    expect(poki.gameplayStart).toHaveBeenCalledOnce();

    await fromGame("hello");
    expect(poki.gameplayStop).toHaveBeenCalledOnce();
    await fromGame("gameplayStart");
    expect(poki.gameplayStart).toHaveBeenCalledTimes(2);
  });

  it("tells the game when an ad starts, then when the break ends", async () => {
    await fromGame("commercialBreak", [], { id: "ad" });
    expect(replies.mock.calls.map(([message]) => message)).toEqual([
      { ofPoki: true, id: "ad", event: "commercialBreakStart" },
      { ofPoki: true, id: "ad", result: undefined },
    ]);
  });

  it("only answers our game frame, and only for its own methods", async () => {
    await fromGame("getToken", [], { origin: "https://evil.example" });
    await fromGame("getToken", [], { source: window });
    await fromGame("constructor");
    expect(poki.getToken).not.toHaveBeenCalled();
    expect(replies).not.toHaveBeenCalled();
  });
});
