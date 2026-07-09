import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setMarketingConsent } = vi.hoisted(() => ({
  setMarketingConsent: vi.fn(async () => true),
}));
vi.mock("../../src/client/Api", () => ({ setMarketingConsent }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { MarketingConsentToast } from "../../src/client/MarketingConsentToast";

type Consent = "approved" | "denied" | "no_response";

function userMe(consented: Consent, hasEmail: boolean) {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "p",
      marketingConsent: { consented, hasEmail },
    },
  };
}

function fireUserMe(detail: unknown) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

describe("marketing-consent-toast", () => {
  let el: MarketingConsentToast;

  beforeEach(async () => {
    // The @customElement decorator's define() side-effect doesn't run under the
    // test transform, so register the element explicitly (as other client
    // component tests do).
    if (!customElements.get("marketing-consent-toast")) {
      customElements.define("marketing-consent-toast", MarketingConsentToast);
    }
    el = document.createElement(
      "marketing-consent-toast",
    ) as MarketingConsentToast;
    document.body.appendChild(el);
    // Let the initial (hidden) render settle before firing consent events.
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
  });

  async function shown(): Promise<boolean> {
    await el.updateComplete;
    return el.querySelector('[role="dialog"]') !== null;
  }

  it("shows when consent is undecided and an email is on file", async () => {
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(true);
  });

  it("stays hidden when there is no email on the account", async () => {
    fireUserMe(userMe("no_response", false));
    expect(await shown()).toBe(false);
  });

  it("stays hidden once a decision already exists", async () => {
    fireUserMe(userMe("approved", true));
    expect(await shown()).toBe(false);
    fireUserMe(userMe("denied", true));
    expect(await shown()).toBe(false);
  });

  it("stays hidden when the player is not logged in", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(false);
  });

  it("records the choice and does not reappear after answering", async () => {
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(true);

    const yes = [...el.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("marketing_consent.yes"),
    );
    yes?.click();

    expect(setMarketingConsent).toHaveBeenCalledWith(true);
    expect(await shown()).toBe(false);

    // Re-firing the undecided state must not resurrect the prompt.
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(false);
  });
});
