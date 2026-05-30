import { describe, expect, it } from "vitest";
import { FORBIDDEN_LABELS } from "../config";
import { assertNotForbidden, type Action } from "../github";

describe("assertNotForbidden", () => {
  it("allows non-forbidden labels", () => {
    expect(() =>
      assertNotForbidden({ type: "add_label", label: "bug" }),
    ).not.toThrow();
    expect(() =>
      assertNotForbidden({ type: "remove_label", label: "needs-info" }),
    ).not.toThrow();
  });

  it("throws when trying to add a Layer A label", () => {
    for (const forbidden of FORBIDDEN_LABELS) {
      expect(() =>
        assertNotForbidden({ type: "add_label", label: forbidden }),
      ).toThrow(/forbidden label/);
    }
  });

  it("throws when trying to remove a Layer A label", () => {
    for (const forbidden of FORBIDDEN_LABELS) {
      expect(() =>
        assertNotForbidden({ type: "remove_label", label: forbidden }),
      ).toThrow(/forbidden label/);
    }
  });

  it("does not throw for comment / close actions", () => {
    const actions: Action[] = [
      { type: "comment", body: "hello" },
      { type: "close", reason: "not_planned" },
    ];
    for (const a of actions) {
      expect(() => assertNotForbidden(a)).not.toThrow();
    }
  });

  it("FORBIDDEN_LABELS contains exactly the Layer A labels", () => {
    expect(FORBIDDEN_LABELS.has("approved")).toBe(true);
    expect(FORBIDDEN_LABELS.has("not-approved")).toBe(true);
    expect(FORBIDDEN_LABELS.has("stale")).toBe(true);
    expect(FORBIDDEN_LABELS.has("keep-open")).toBe(true);
    expect(FORBIDDEN_LABELS.has("auto-closed-stale")).toBe(true);
    expect(FORBIDDEN_LABELS.has("bug")).toBe(false);
    expect(FORBIDDEN_LABELS.has("needs-info")).toBe(false);
  });
});
