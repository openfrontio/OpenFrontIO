import { normalizeNewsMarkdown } from "../../src/client/NewsMarkdown";

describe("normalizeNewsMarkdown", () => {
  it("converts openfront pull request URLs to short markdown links", () => {
    const input =
      "Fix attack logic in https://github.com/openfrontio/OpenFrontIO/pull/1234";

    const result = normalizeNewsMarkdown(input);

    expect(result).toContain(
      "[#1234](https://github.com/openfrontio/OpenFrontIO/pull/1234)",
    );
  });

  it("converts openfront compare URLs to markdown links", () => {
    const input =
      "Full Changelog: https://github.com/openfrontio/OpenFrontIO/compare/v1.0.0...v1.1.0";

    const result = normalizeNewsMarkdown(input);

    expect(result).toContain(
      "[v1.0.0...v1.1.0](https://github.com/openfrontio/OpenFrontIO/compare/v1.0.0...v1.1.0)",
    );
  });

  it("converts github @mentions to profile links", () => {
    const input = "- Feature by @evanpelle in release notes";

    const result = normalizeNewsMarkdown(input);

    expect(result).toContain("[@evanpelle](https://github.com/evanpelle)");
  });

  it("does not convert existing markdown-linked mentions", () => {
    const input = "Credit [@evanpelle](https://github.com/evanpelle)";

    const result = normalizeNewsMarkdown(input);

    expect(result).toBe(input);
  });

  it("does not convert email addresses", () => {
    const input = "Contact support@openfront.io for help";

    const result = normalizeNewsMarkdown(input);

    expect(result).toBe(input);
  });
});
