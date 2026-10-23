import type { LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string, p?: Record<string, string | number>) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
}));

import "../../src/client/components/ffaRating/OfstatsCredit";

let el: HTMLElement;
afterEach(() => el?.remove());

describe("<ofstats-credit>", () => {
  it("links to OFstats's how-it-works page in a new tab", async () => {
    el = document.createElement("ofstats-credit");
    document.body.appendChild(el);
    await (el as LitElement).updateComplete;
    const a = el.querySelector("a")!;
    expect(a.href).toBe("https://ofstats.io/leaderboard/how-it-works");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.textContent).toContain("ffa_rating.credit");
  });
});
