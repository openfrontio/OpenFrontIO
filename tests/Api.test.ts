import { beforeEach, describe, expect, it } from "vitest";
import { getApiBase } from "../src/client/Api";

describe("getApiBase", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to http://localhost:8787 on localhost when apiHost is not set and API_DOMAIN is unset", () => {
    expect(getApiBase()).toBe("http://localhost:8787");
  });
});
