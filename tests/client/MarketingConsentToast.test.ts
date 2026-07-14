import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setMarketingConsent } = vi.hoisted(() => ({
  setMarketingConsent: vi.fn(async () => true),
}));
vi.mock("../../src/client/Api", () => ({ setMarketingConsent }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { MarketingConsentToast } from "../../src/client/components/MarketingConsentToast";

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
    // Flush any in-flight async decide() (it awaits setMarketingConsent).
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    return el.querySelector('[role="dialog"]') !== null;
  }

  // Click the button whose accessible name / text matches, e.g. the "yes" or
  // "no" action or the dismiss ("dismiss") X.
  function clickButton(match: RegExp): void {
    const btn = [...el.querySelectorAll("button")].find((b) =>
      match.test(
        `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`,
      ),
    );
    btn?.click();
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

  it("records approval on 'yes' and does not reappear", async () => {
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(true);

    clickButton(/marketing_consent\.yes/);
    expect(await shown()).toBe(false);
    expect(setMarketingConsent).toHaveBeenCalledWith(true);

    // Re-firing the undecided state must not resurrect the prompt.
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(false);
  });

  it("records a denial on 'no thanks'", async () => {
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(true);

    clickButton(/marketing_consent\.no/);
    expect(await shown()).toBe(false);
    expect(setMarketingConsent).toHaveBeenCalledWith(false);
  });

  it("records nothing on a subtle dismiss (X) — leaves state undecided", async () => {
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(true);

    clickButton(/marketing_consent\.dismiss/);
    expect(await shown()).toBe(false);
    expect(setMarketingConsent).not.toHaveBeenCalled();
  });

  it("keeps the toast up when the write fails (no silent success)", async () => {
    setMarketingConsent.mockResolvedValueOnce(false);
    fireUserMe(userMe("no_response", true));
    expect(await shown()).toBe(true);

    clickButton(/marketing_consent\.yes/);
    expect(setMarketingConsent).toHaveBeenCalledWith(true);
    // The request failed, so the prompt stays visible for a retry.
    expect(await shown()).toBe(true);
  });

  // Responsive layout: a full-width top banner on small screens (so it doesn't
  // crop text on phones like the 14 Pro Max) and a top-right 236px card on sm+.
  // jsdom has no layout engine to evaluate media queries, so assert the
  // Tailwind classes that drive the two layouts are present.
  it("uses a full-width banner on mobile and a top-right card on sm+", async () => {
    fireUserMe(userMe("no_response", true));
    await el.updateComplete;
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    const cls = dialog.className;

    // Mobile (default): pinned left+right, auto width → spans the viewport.
    for (const c of ["left-4", "right-4", "w-auto"]) {
      expect(cls).toContain(c);
    }
    // sm+ (tablet/desktop): release the left edge and become a fixed 236px card.
    for (const c of ["sm:left-auto", "sm:right-4", "sm:w-[236px]"]) {
      expect(cls).toContain(c);
    }
  });
});
