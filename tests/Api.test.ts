import { beforeEach, describe, expect, it } from "vitest";
import { getApiBase } from "../src/client/Api";

describe("getApiBase", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // API_DOMAIN is forced empty under vitest via the vite.config `define`, so this
  // regression test exercises the fallback branch deterministically regardless of
  // any API_DOMAIN in the host shell / CI.
  it("falls back to http://localhost:8787 on localhost when apiHost is not set and API_DOMAIN is empty", () => {
    expect(getApiBase()).toBe("http://localhost:8787");
  });
});
