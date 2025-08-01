import { base64urlToUuid } from "../../src/core/Base64";

describe("Base64", () => {
  test("nuke should destroy buildings and redraw out of range buildings", async () => {
    expect(base64urlToUuid("Ej5FZ+i7EtOkVkJmFBdAAA")).toBe(
      "123e4567-e8bb-12d3-a456-426614174000",
    );
  });
});
