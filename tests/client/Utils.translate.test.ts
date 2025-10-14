import { translateText } from "../../src/client/Utils";

describe("translateText fallback", () => {
  const resetCaches = () => {
    const self = translateText as any;
    self.enTranslations = undefined;
    self.lastLang = null;
    if (self.formatterCache?.clear) {
      self.formatterCache.clear();
    } else {
      self.formatterCache = new Map();
    }
  };

  beforeEach(() => {
    resetCaches();
  });

  afterEach(() => {
    resetCaches();
  });

  it("replaces all occurrences of placeholders when running outside the browser", () => {
    const self = translateText as any;
    self.enTranslations = {
      test: {
        repeated: "{value} and {value} vs {value}",
      },
    };

    const result = translateText("test.repeated", { value: 7 });

    expect(result).toBe("7 and 7 vs 7");
  });

  it("handles placeholder names that contain regex metacharacters", () => {
    const self = translateText as any;
    self.enTranslations = {
      special: {
        escaped: "<{value$}>",
      },
    };

    const result = translateText("special.escaped", { value$: "ok" });

    expect(result).toBe("<ok>");
  });
});
