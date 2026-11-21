import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { MultiTabModal } from "../../src/client/hud/layers/MultiTabModal";

const EN_JSON = path.join(
  __dirname,
  "..",
  "..",
  "resources",
  "lang",
  "en.json",
);

describe("multi_tab translations", () => {
  it("includes all multi_tab modal translation keys in en.json", () => {
    const en = JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
    expect(en.multi_tab).toBeDefined();
    expect(en.multi_tab.warning).toBe("Vigilant Mode Warning");
    expect(en.multi_tab.detected).toBe("Multiple open game tabs detected.");
    expect(en.multi_tab.please_wait).toBe("Please wait");
    expect(en.multi_tab.seconds).toBe("seconds");
    expect(en.multi_tab.explanation).toBe(
      "To ensure fair play, only one active game tab is permitted at a time.",
    );
  });

  it("stops monitoring on disconnectedCallback", () => {
    const modal = new MultiTabModal();
    const detector = { stopMonitoring: vi.fn() };
    (modal as any).detector = detector;
    modal.disconnectedCallback();
    expect(detector.stopMonitoring).toHaveBeenCalledTimes(1);
  });
});
