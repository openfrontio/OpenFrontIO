import { beforeEach, describe, expect, it } from "vitest";
import { getApiBase, getAudience } from "../src/client/Api";
import { ClientEnv } from "../src/client/ClientEnv";

function setConfig(jwtAudience: string) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience,
    instanceId: "desktop",
    gitCommit: "test",
  };
  ClientEnv.reset();
}

describe("getApiBase localhost fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    // getAudience() now reads the audience from BOOTSTRAP_CONFIG, so the
    // localhost branch is reached via jwtAudience "localhost".
    setConfig("localhost");
  });

  // API_DOMAIN is forced empty under vitest via the vite.config `define`, so this
  // regression test exercises the fallback branch deterministically regardless of
  // any API_DOMAIN in the host shell / CI.
  it("falls back to http://localhost:8787 on localhost when apiHost is not set and API_DOMAIN is empty", () => {
    expect(getApiBase()).toBe("http://localhost:8787");
  });
});

describe("getAudience / getApiBase from BOOTSTRAP_CONFIG", () => {
  beforeEach(() => ClientEnv.reset());

  it("returns the configured audience (desktop staging)", () => {
    setConfig("openfront.dev");
    expect(getAudience()).toBe("openfront.dev");
    expect(getApiBase()).toBe("https://api.openfront.dev");
  });

  it("returns the configured audience (prod)", () => {
    setConfig("openfront.io");
    expect(getAudience()).toBe("openfront.io");
    expect(getApiBase()).toBe("https://api.openfront.io");
  });
});
