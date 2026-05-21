import { describe, it, expect, beforeEach } from "vitest";
import { setTitle } from "../../src/client/PageTitleManager";

describe("PageTitleManager", () => {
  beforeEach(() => {
    document.title = "";
  });

  it("should set a custom title", () => {
    setTitle("Custom Title");
    expect(document.title).toBe("Custom Title");
  });
});
