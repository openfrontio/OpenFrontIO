import { describe, expect, it } from "vitest";
import {
  promotionsHidden,
  promotionsPromptDue,
  promotionsPromptStringsReady,
} from "../../src/client/Promotions";

const settings = (hidden: boolean, seen: boolean) => ({
  hideSaleBanners: () => hidden,
  promotionsPromptSeen: () => seen,
});

describe("promotionsHidden", () => {
  it("follows the sale-banners switch on Steam", () => {
    expect(promotionsHidden(settings(true, true), true)).toBe(true);
    expect(promotionsHidden(settings(false, true), true)).toBe(false);
  });
  it("is always false off Steam, whatever is stored", () => {
    expect(promotionsHidden(settings(true, true), false)).toBe(false);
  });
});

describe("promotionsPromptDue", () => {
  it("once per Steam device", () => {
    expect(promotionsPromptDue(settings(false, false), true)).toBe(true);
    expect(promotionsPromptDue(settings(false, true), true)).toBe(false);
  });
  it("not to someone who already turned promotions off", () => {
    expect(promotionsPromptDue(settings(true, false), true)).toBe(false);
  });
  it("never off Steam", () => {
    expect(promotionsPromptDue(settings(false, false), false)).toBe(false);
  });
});

describe("promotionsPromptStringsReady", () => {
  it("waits for the language files", () => {
    expect(promotionsPromptStringsReady((key) => key)).toBe(false);
    expect(promotionsPromptStringsReady((key) => `t(${key})`)).toBe(true);
  });
});
