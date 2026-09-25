import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdentityToken } from "../../../src/client/Api";
import { IdentityTokenCard } from "../../../src/client/components/IdentityTokenCard";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  copyToClipboard: vi.fn(async () => {}),
}));

vi.mock("../../../src/client/Api", () => ({
  createIdentityToken: vi.fn(),
}));

const mockCreate = vi.mocked(createIdentityToken);

describe("IdentityTokenCard", () => {
  let card: IdentityTokenCard;

  beforeEach(async () => {
    if (!customElements.get("identity-token-card")) {
      customElements.define("identity-token-card", IdentityTokenCard);
    }
    card = document.createElement("identity-token-card") as IdentityTokenCard;
    document.body.appendChild(card);
    await card.updateComplete;
  });

  afterEach(() => {
    card.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function select(): HTMLSelectElement {
    return card.querySelector("select")!;
  }
  function tokenInput(): HTMLInputElement | null {
    return card.querySelector("input[readonly]");
  }
  async function generate(): Promise<void> {
    (card.querySelector("o-button") as HTMLElement).click();
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled());
    await card.updateComplete;
  }

  it("offers both sites and mints a token for the selected one", async () => {
    expect([...select().options].map((o) => o.value)).toEqual([
      "ofstats.io",
      "trackerfront.io",
    ]);
    select().value = "trackerfront.io";
    select().dispatchEvent(new Event("change"));
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        token: "tok-123",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });

    await generate();

    expect(mockCreate).toHaveBeenCalledWith("trackerfront.io");
    expect(tokenInput()?.value).toBe("tok-123");
    expect(card.textContent).toContain("account_modal.identity_token_note");
  });

  it("drops the token when the site changes", async () => {
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        token: "tok-123",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    await generate();
    expect(tokenInput()).not.toBeNull();

    select().value = "trackerfront.io";
    select().dispatchEvent(new Event("change"));
    await card.updateComplete;

    expect(tokenInput()).toBeNull();
  });

  it("drops the token once it expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        token: "tok-123",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    await generate();
    expect(tokenInput()).not.toBeNull();

    vi.advanceTimersByTime(600_000);
    await card.updateComplete;

    expect(tokenInput()).toBeNull();
  });

  it("shows the rate-limit message on 429", async () => {
    mockCreate.mockResolvedValue({ ok: false, code: "rate_limited" });
    await generate();

    expect(tokenInput()).toBeNull();
    expect(card.textContent).toContain(
      "account_modal.identity_token_rate_limited",
    );
  });
});
