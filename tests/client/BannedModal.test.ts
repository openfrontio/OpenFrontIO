import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// translateText stand-in that mirrors the real one's key-resolution: a known
// key renders to `[key]` (so it differs from the key — the component's
// unknown-category fallback keys off `label === key`), an UNKNOWN key returns
// the key unchanged (simulating a missing translation), and params are appended
// so assertions can see interpolated values.
const language = vi.hoisted(() => ({ current: "en" }));

vi.mock("../../src/client/Utils", () => ({
  getCurrentLanguage: () => language.current,
  translateText: (key: string, params?: Record<string, string | number>) => {
    // Only this category has no translation, to exercise the fallback path.
    if (key === "ban_notice.category.brand_new_reason") return key;
    return params
      ? `[${key}] ${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")}`
      : `[${key}]`;
  },
}));

import { BannedModal } from "../../src/client/components/BannedModal";

function fireUserMe(detail: unknown) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

describe("banned-modal", () => {
  let el: BannedModal;

  beforeEach(async () => {
    // The @customElement define() side-effect doesn't run under the test
    // transform, so register explicitly (as other client component tests do).
    if (!customElements.get("banned-modal")) {
      customElements.define("banned-modal", BannedModal);
    }
    el = document.createElement("banned-modal") as BannedModal;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    language.current = "en";
    vi.clearAllMocks();
  });

  async function text(): Promise<string> {
    await el.updateComplete;
    return el.textContent ?? "";
  }

  it("renders nothing when the player is not banned", async () => {
    fireUserMe({ ban: null, user: {}, player: {} });
    expect((await text()).trim()).toBe("");
  });

  it("renders nothing when @me failed to load", async () => {
    fireUserMe(false);
    expect((await text()).trim()).toBe("");
  });

  it("shows the localized category, reason and lift date for a temp ban", async () => {
    fireUserMe({
      ban: {
        category: "cheating",
        reason: "aimbot in ranked",
        expiresAt: "2026-08-01T00:00:00.000Z",
      },
      user: {},
      player: {},
    });
    const t = await text();
    // The title is a heading inside the card, not the shell's floating header.
    expect(el.querySelector("h2")?.textContent).toContain("ban_notice.title");
    expect(el.querySelector("o-modal")?.hasAttribute("title")).toBe(false);
    expect(t).toContain("ban_notice.category.cheating");
    expect(t).toContain("ban_notice.reason_label");
    expect(t).toContain("aimbot in ranked");
    expect(t).toContain("ban_notice.expires_label");
    expect(t).not.toContain("ban_notice.expires_never");
  });

  it("writes the expiry date in the selected game language", async () => {
    language.current = "de";
    fireUserMe({
      ban: {
        category: "other",
        reason: null,
        expiresAt: "2026-03-15T12:00:00.000Z",
      },
      user: {},
      player: {},
    });
    expect(await text()).toContain("März");
  });

  it("writes the expiry date in English for a language Intl doesn't support", async () => {
    // Toki Pona: selectable in game, but without it Intl would use the browser's.
    language.current = "tp";
    fireUserMe({
      ban: {
        category: "other",
        reason: null,
        expiresAt: "2026-03-15T12:00:00.000Z",
      },
      user: {},
      player: {},
    });
    expect(await text()).toContain("March");
  });

  // The notice can render before the language files load, and nothing else
  // re-renders it: LangSelector.applyTranslation() has to requestUpdate() it by
  // tag, or it keeps the raw keys and an English date.
  it("recovers from rendering before the language loaded", async () => {
    fireUserMe({
      ban: {
        category: "other",
        reason: null,
        expiresAt: "2026-03-15T12:00:00.000Z",
      },
      user: {},
      player: {},
    });
    expect(await text()).toContain("March");

    language.current = "de";
    el.requestUpdate();
    expect(await text()).toContain("März");
  });

  it("is registered for re-translation in LangSelector", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "client", "LangSelector.ts"),
      "utf8",
    );
    expect(source).toContain('"banned-modal",');
  });

  it("links the appeal to the OpenFront Discord in a new tab", async () => {
    fireUserMe({
      ban: { category: "other", reason: null, expiresAt: null },
      user: {},
      player: {},
    });
    await el.updateComplete;
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://discord.gg/openfront");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toContain("ban_notice.contact_discord");
  });

  it("shows 'permanent' and no reason line for a permanent ban with no reason", async () => {
    fireUserMe({
      ban: { category: "other", reason: null, expiresAt: null },
      user: {},
      player: {},
    });
    const t = await text();
    expect(t).toContain("ban_notice.category.other");
    expect(t).toContain("ban_notice.expires_never");
    expect(t).not.toContain("ban_notice.reason_label");
  });

  it("clears the notice when a later @me arrives with no ban (unbanned in-session)", async () => {
    fireUserMe({
      ban: { category: "cheating", reason: null, expiresAt: null },
      user: {},
      player: {},
    });
    expect(await text()).toContain("ban_notice.category.cheating");

    // The player is unbanned and @me re-dispatches without a ban.
    fireUserMe({ ban: null, user: {}, player: {} });
    expect((await text()).trim()).toBe("");
  });

  it("falls back to the generic category for an unknown value", async () => {
    fireUserMe({
      ban: { category: "brand_new_reason", reason: null, expiresAt: null },
      user: {},
      player: {},
    });
    // Unknown key → translateText returns the key unchanged → fallback to other.
    expect(await text()).toContain("ban_notice.category.other");
  });
});
