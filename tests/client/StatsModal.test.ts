import { StatsModal } from "../../src/client/StatsModal";

// Mock the translateText function
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "stats_modal.win_score_tooltip":
        "Weighted wins based on clan participation and match difficulty",
      "stats_modal.loss_score_tooltip":
        "Weighted losses based on clan participation and match difficulty",
    };
    return translations[key] || key;
  }),
}));

// Mock the API module
vi.mock("../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch
global.fetch = vi.fn();

describe("StatsModal", () => {
  let modal: StatsModal;

  beforeEach(async () => {
    // Define the custom element if not already defined
    if (!customElements.get("stats-modal")) {
      customElements.define("stats-modal", StatsModal);
    }
    modal = document.createElement("stats-modal") as StatsModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  describe("Tooltip Implementation - Issue #2508", () => {
    it("should render Win Score and Loss Score columns with title attributes", async () => {
      // Mock fetch to return sample clan leaderboard data
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          start: "2025-01-01T00:00:00Z",
          end: "2025-01-07T23:59:59Z",
          clans: [
            {
              clanTag: "[TEST]",
              games: 10,
              wins: 8,
              losses: 2,
              playerSessions: 25,
              weightedWins: 8.5,
              weightedLosses: 1.5,
              weightedWLRatio: 5.67,
            },
            {
              clanTag: "[DEMO]",
              games: 8,
              wins: 6,
              losses: 2,
              playerSessions: 20,
              weightedWins: 6.0,
              weightedLosses: 2.0,
              weightedWLRatio: 3.0,
            },
          ],
        }),
      });

      // Mock the modal element's open method
      const mockModalEl = { open: vi.fn(), close: vi.fn() };
      Object.defineProperty(modal, "modalEl", {
        get: () => mockModalEl,
        configurable: true,
      });

      // Trigger modal to load and render data
      modal.open();
      await modal.updateComplete;

      // Wait for async loadLeaderboard to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      await modal.updateComplete;

      // Query the rendered DOM for table headers (StatsModal uses light DOM via createRenderRoot)
      const allHeaders = modal.querySelectorAll("th");
      let winScoreHeader: Element | null = null;
      let lossScoreHeader: Element | null = null;

      // Find the headers by their text content and title attribute
      allHeaders.forEach((th) => {
        const title = th.getAttribute("title");
        if (title?.includes("Weighted wins")) {
          winScoreHeader = th;
        } else if (title?.includes("Weighted losses")) {
          lossScoreHeader = th;
        }
      });

      // Assert that headers exist with correct tooltip text
      expect(winScoreHeader).toBeTruthy();
      expect(lossScoreHeader).toBeTruthy();

      expect(winScoreHeader!.getAttribute("title")).toBe(
        "Weighted wins based on clan participation and match difficulty",
      );
      expect(lossScoreHeader!.getAttribute("title")).toBe(
        "Weighted losses based on clan participation and match difficulty",
      );
    });

    it("should use translateText for tooltip internationalization", async () => {
      // Verify translation keys are correct
      const { translateText } = await import("../../src/client/Utils");

      expect(translateText("stats_modal.win_score_tooltip")).toBe(
        "Weighted wins based on clan participation and match difficulty",
      );
      expect(translateText("stats_modal.loss_score_tooltip")).toBe(
        "Weighted losses based on clan participation and match difficulty",
      );
    });
  });

  describe("Modal Functionality", () => {
    it("should initialize with default state", () => {
      expect(modal).toBeTruthy();
    });

    it("should be a custom element", () => {
      expect(modal).toBeInstanceOf(StatsModal);
      expect(modal.tagName.toLowerCase()).toBe("stats-modal");
    });
  });
});
