import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import {
  CurrencyDisplay,
  formatCurrencyAmount,
} from "../../../src/client/components/CurrencyDisplay";

async function renderDisplay(props: Partial<CurrencyDisplay>) {
  if (!customElements.get("currency-display")) {
    customElements.define("currency-display", CurrencyDisplay);
  }
  const el = document.createElement("currency-display") as CurrencyDisplay;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("formatCurrencyAmount", () => {
  it("formats a player wallet number", () => {
    expect(formatCurrencyAmount(1000)).toBe((1000).toLocaleString());
  });

  it("formats a zero rather than dropping it", () => {
    expect(formatCurrencyAmount(0)).toBe("0");
    expect(formatCurrencyAmount("0")).toBe("0");
  });

  it("groups thousands for a bigint string", () => {
    expect(formatCurrencyAmount("1000")).toBe((1000).toLocaleString());
  });

  it("formats a value past Number.MAX_SAFE_INTEGER without losing precision", () => {
    // 9007199254740993 is not representable as a double; via Number() this
    // would come back as ...992.
    expect(formatCurrencyAmount("9007199254740993")).toBe(
      BigInt("9007199254740993").toLocaleString(),
    );
    expect(formatCurrencyAmount("9007199254740993")).not.toBe(
      formatCurrencyAmount("9007199254740992"),
    );
  });

  it("returns null for an absent amount so callers can hide the widget", () => {
    // null is what GET /public/clan/:clanTag serves for an unregistered tag.
    expect(formatCurrencyAmount(null)).toBeNull();
    expect(formatCurrencyAmount(undefined)).toBeNull();
  });

  it("returns null for an empty string instead of BigInt's 0n", () => {
    expect(formatCurrencyAmount("")).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(formatCurrencyAmount("1.5")).toBeNull();
    expect(formatCurrencyAmount("abc")).toBeNull();
    expect(formatCurrencyAmount(NaN)).toBeNull();
  });
});

describe("currency-display", () => {
  it("renders both sides for a player wallet (numbers)", async () => {
    const el = await renderDisplay({ hard: 5, soft: 1000 });
    expect(el.querySelector("plutonium-icon")).toBeTruthy();
    expect(el.querySelector("cap-icon")).toBeTruthy();
    expect(el.textContent).toContain((1000).toLocaleString());
  });

  it("renders bigint-string clan balances exactly", async () => {
    const el = await renderDisplay({ hard: "0", soft: "9007199254740993" });
    expect(el.textContent).toContain(
      BigInt("9007199254740993").toLocaleString(),
    );
  });

  it("hides only the side that has no amount", async () => {
    const el = await renderDisplay({ hard: null, soft: "150" });
    expect(el.querySelector("plutonium-icon")).toBeNull();
    expect(el.querySelector("cap-icon")).toBeTruthy();
  });

  it("renders nothing at all when neither side has an amount", async () => {
    const el = await renderDisplay({ hard: null, soft: null });
    expect(el.querySelector("cap-icon")).toBeNull();
    expect(el.querySelector("plutonium-icon")).toBeNull();
    expect(el.textContent?.trim()).toBe("");
  });

  it("still renders a zero balance", async () => {
    const el = await renderDisplay({ hard: "0", soft: "0" });
    expect(el.querySelector("cap-icon")).toBeTruthy();
    expect(el.textContent).toContain("0");
  });
});
