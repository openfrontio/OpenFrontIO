jest.mock("../../resources/lang/en.json", () => ({
  test: {
    repeated: "{value} and {value} vs {value}",
  },
  special: {
    escaped: "<{value$}>",
  },
}));

import {
  __resetTranslationCacheForTesting,
  translateText,
} from "../../src/client/Utils";

describe("translateText fallback", () => {
  let originalDocument: Document | undefined;

  beforeEach(() => {
    __resetTranslationCacheForTesting();
    originalDocument = (global as any).document;
    delete (global as any).document;
  });

  afterEach(() => {
    __resetTranslationCacheForTesting();
    if (originalDocument !== undefined) {
      (global as any).document = originalDocument;
    } else {
      delete (global as any).document;
    }
  });

  it("replaces all occurrences of placeholders when running outside the browser", () => {
    const result = translateText("test.repeated", { value: 7 });

    expect(result).toBe("7 and 7 vs 7");
  });

  it("handles placeholder names that contain regex metacharacters", () => {
    const result = translateText("special.escaped", { value$: "ok" });

    expect(result).toBe("<ok>");
  });
});
