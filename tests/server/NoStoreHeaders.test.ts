import { describe, expect, test } from "vitest";
import { setNoStoreHeaders } from "../../src/server/NoStoreHeaders";

describe("NoStoreHeaders", () => {
  test("sets explicit no-store headers", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
    } as any;

    setNoStoreHeaders(response);

    expect(headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    expect(headers.get("Pragma")).toBe("no-cache");
    expect(headers.get("Expires")).toBe("0");
  });
});
