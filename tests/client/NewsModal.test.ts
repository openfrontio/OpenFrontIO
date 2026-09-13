import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Side-effect import registers <news-modal>; a type-only import would be
// elided and leave the element inert.
import "../../src/client/NewsModal";
import { NewsModal } from "../../src/client/NewsModal";

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewsModal", () => {
  it("starts on the loading placeholder", () => {
    const modal = new NewsModal();
    expect(modal.markdown).toBe("Loading...");
  });

  it("fetches the changelog on first open only", async () => {
    const fetchMock = vi.fn(async (_input: unknown) => ({
      ok: true,
      text: async () => "changelog body text",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const modal = new NewsModal();
    modal.open();

    await vi.waitFor(() => expect(modal.markdown).toContain("changelog body"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("changelog.md");

    // Already initialized: re-opening must not refetch.
    modal.open();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a failure message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    const modal = new NewsModal();
    modal.open();

    await vi.waitFor(() => expect(modal.markdown).toBe("Failed to load"));
  });
});
