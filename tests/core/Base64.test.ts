import { base64urlToUuid, uuidToBase64url } from "../../src/core/Base64";

describe("Base64", () => {
  test("uuidToBase64url should translate correctly", async () => {
    expect(uuidToBase64url("1f6fe56d-c4ba-4476-8f22-04d797e82eed")).toBe(
      "H2_lbcS6RHaPIgTXl-gu7Q",
    );
  });
  test("base64urlToUuid should translate correctly", async () => {
    expect(base64urlToUuid("H2_lbcS6RHaPIgTXl-gu7Q")).toBe(
      "1f6fe56d-c4ba-4476-8f22-04d797e82eed",
    );
  });
  test("uuidToBase64url and base64urlToUuid should cancel each other out", async () => {
    expect(
      base64urlToUuid(uuidToBase64url("f8afad1b-05a3-41fd-b07a-1b7ddaa19bbc")),
    ).toBe("f8afad1b-05a3-41fd-b07a-1b7ddaa19bbc");
  });
});
