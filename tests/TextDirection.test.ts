import { describe, expect, it } from "vitest";
import { isRTL } from "../src/client/Utils";

describe("RTL language detection", () => {
  it("marks right-to-left languages as RTL", () => {
    expect(isRTL("ar")).toBe(true);
    expect(isRTL("fa")).toBe(true);
    expect(isRTL("he")).toBe(true);
  });

  it("marks left-to-right languages as not RTL", () => {
    expect(isRTL("en")).toBe(false);
    expect(isRTL("de")).toBe(false);
    expect(isRTL("zh-CN")).toBe(false);
    expect(isRTL("pt-BR")).toBe(false);
  });

  it("ignores regional subtags when detecting the script", () => {
    expect(isRTL("ar-EG")).toBe(true);
    expect(isRTL("fa-IR")).toBe(true);
  });

  it("falls back to LTR for unknown or empty languages", () => {
    expect(isRTL("")).toBe(false);
    expect(isRTL("xx")).toBe(false);
  });
});
