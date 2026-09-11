import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAppShellContentCache,
  getAppShellContent,
  setAppShellCacheHeaders,
} from "../../src/server/RenderHtml";

// Covers both hosts the tests below boot as: the pinned blue deployment and
// the bare-domain dev box.
const TEST_CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", color: "blue", numWorkers: 1 },
  b: { host: "localhost", color: "blue", numWorkers: 1 },
});

describe("RenderHtml", () => {
  const originalGitCommit = process.env.GIT_COMMIT;
  let tempDir: string | null = null;

  beforeEach(() => {
    vi.stubEnv("CLUSTER_JSON", TEST_CLUSTER);
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

  test("injects the cluster map and own instance letter", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-html-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(
      htmlPath,
      "cluster: <%- cluster %>, instanceLetter: <%- instanceLetter %>",
      "utf8",
    );
    process.env.GIT_COMMIT = "abc";

    const rendered = await getAppShellContent(htmlPath);

    // DOMAIN=localhost with no SUBDOMAIN resolves to entry "b".
    expect(rendered).toContain('instanceLetter: "b"');
    expect(rendered).toContain('"host":"blue.openfront.io"');
    expect(rendered).toContain('"numWorkers":1');
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
    vi.stubEnv("CLUSTER_JSON", TEST_CLUSTER);
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

describe("RenderHtml siteHost injection", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    vi.stubEnv("CLUSTER_JSON", TEST_CLUSTER);
    vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
    vi.stubEnv("GIT_COMMIT", "abc");
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    clearAppShellContentCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  // Same expression index.html uses to emit the optional siteHost line.
  const TEMPLATE =
    '<%- typeof siteHost !== "undefined" && siteHost ? "siteHost: " + siteHost + "," : "" %>';

  async function render(): Promise<string> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-html-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(htmlPath, TEMPLATE, "utf8");
    return getAppShellContent(htmlPath);
  }

  test("advertises the apex behind a load balancer (unknown-letter redirect target)", async () => {
    vi.stubEnv("SITE_HOST", "openfront.io");
    expect(await render()).toBe('siteHost: "openfront.io",');
  });

  test("omits siteHost for a standalone deployment", async () => {
    vi.stubEnv("SITE_HOST", "");
    expect(await render()).toBe("");
  });
});
