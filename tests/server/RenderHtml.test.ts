import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAppShellContentCache,
  getAppShellContent,
  setAppShellCacheHeaders,
} from "../../src/server/RenderHtml";

describe("RenderHtml", () => {
  const originalGitCommit = process.env.GIT_COMMIT;
  let tempDir: string | null = null;

  beforeEach(() => {
    vi.stubEnv("NUM_WORKERS", "1");
    vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
    vi.stubEnv("DOMAIN", "localhost");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    process.env.GIT_COMMIT = originalGitCommit;
    clearAppShellContentCache();

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("reuses cached app shell content", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-html-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(
      htmlPath,
      "<script>window.GIT_COMMIT = <%- gitCommit %>;</script>",
      "utf8",
    );

    process.env.GIT_COMMIT = "first";
    const first = await getAppShellContent(htmlPath);

    process.env.GIT_COMMIT = "second";
    const second = await getAppShellContent(htmlPath);

    expect(first).toContain('"first"');
    expect(second).toBe(first);
    expect(second).not.toContain('"second"');
  });

  test("sets shared-cache headers for the app shell", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
    } as any;

    setAppShellCacheHeaders(response);

    expect(headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
    );
    expect(headers.get("Content-Type")).toBe("text/html");
  });
});

describe("RenderHtml serverHost pinning", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    vi.stubEnv("NUM_WORKERS", "1");
    vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
    vi.stubEnv("GIT_COMMIT", "abc");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    clearAppShellContentCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  // Same expression index.html uses to emit the optional serverHost line.
  const TEMPLATE =
    '<%- typeof serverHost !== "undefined" && serverHost ? "serverHost: " + serverHost + "," : "" %>';

  async function render(): Promise<string> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-html-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(htmlPath, TEMPLATE, "utf8");
    return getAppShellContent(htmlPath);
  }

  test("pins the page to the deployment's own host behind a load balancer", async () => {
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
    expect(await render()).toBe('serverHost: "blue.openfront.io",');
  });

  test("omits serverHost in dev so the client stays same-origin", async () => {
    vi.stubEnv("DOMAIN", "localhost");
    vi.stubEnv("SUBDOMAIN", "");
    expect(await render()).toBe("");
  });
});
