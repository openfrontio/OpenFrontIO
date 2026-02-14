import { DioxusStatsModal } from "../../src/client/ProfileAndSettingsBridges";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

describe("DioxusStatsModal", () => {
  let modal: DioxusStatsModal;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clans: [],
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-07T00:00:00Z",
      }),
    }) as any;
    if (!customElements.get("dioxus-stats-modal")) {
      customElements.define("dioxus-stats-modal", DioxusStatsModal);
    }
    modal = document.createElement("dioxus-stats-modal") as DioxusStatsModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("registers as a custom element", () => {
    expect(modal).toBeInstanceOf(DioxusStatsModal);
    expect(modal.tagName.toLowerCase()).toBe("dioxus-stats-modal");
  });

  it("opens and closes without throwing", () => {
    expect(() => modal.open()).not.toThrow();
    expect(() => modal.close()).not.toThrow();
  });
});
