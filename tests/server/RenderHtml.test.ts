import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import vm from "vm";
import {
  clearAppShellContentCache,
  getAppShellContent,
  renderHtmlContent,
  setAppShellCacheHeaders,
} from "../../src/server/RenderHtml";
import { ServerEnv } from "../../src/server/ServerEnv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// The real template, not a fixture. Everything above renders a one-line stub,
// which is the right scope for those tests but cannot catch the thing this
// file most needs to catch: that the guarded BOOTSTRAP_CONFIG block in
// index.html still produces the page the client (and the Steam shell, which
// renders the same file) boots from.
const REAL_TEMPLATE = path.resolve(__dirname, "../../index.html");

function bootstrapConfig(html: string): Record<string, unknown> {
  const match = /window\.BOOTSTRAP_CONFIG = (\{[\s\S]*?\n\s*\});/.exec(html);
  if (match === null) {
    throw new Error("rendered page has no window.BOOTSTRAP_CONFIG assignment");
  }
  return vm.runInNewContext(`(${match[1]})`) as Record<string, unknown>;
}

describe("RenderHtml environment-only render", () => {
  beforeEach(() => {
    vi.stubEnv("CLUSTER_JSON", TEST_CLUSTER);
    vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("SITE_HOST", "openfront.io");
    vi.stubEnv("INSTANCE_ID", "i-1");
    vi.stubEnv("GIT_COMMIT", "abc");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearAppShellContentCache();
  });

  // The point of the mode. This page is uploaded once per version and served
  // to every player on it, so naming one server in it would pin the whole
  // version to that server.
  it.each([
    ["cluster"],
    ["instanceLetter"],
    ["instanceId"],
    ["serverHost"],
    ["siteHost"],
  ])("omits the per-server value %s entirely", async (field) => {
    const html = await renderHtmlContent(REAL_TEMPLATE, { perServer: false });

    // Double-escaped on purpose: this is a template literal, so a single \s
    // would reach RegExp as a literal "s" and the assertion could never fail.
    const line = new RegExp(`^\\s*${field}:`, "m");
    // Prove the pattern can match at all before asserting it does not.
    expect(await renderHtmlContent(REAL_TEMPLATE)).toMatch(line);
    expect(html).not.toMatch(line);
    expect(bootstrapConfig(html)).not.toHaveProperty(field);
  });

  it.each([
    ["gitCommit"],
    ["gameEnv"],
    ["turnstileSiteKey"],
    ["jwtAudience"],
    ["cdnBase"],
    ["assetManifest"],
  ])("keeps the build/environment value %s", async (field) => {
    const config = bootstrapConfig(
      await renderHtmlContent(REAL_TEMPLATE, { perServer: false }),
    );

    expect(config[field], field).toBeDefined();
  });

  // Rendering without the per-server locals must not go anywhere near
  // CLUSTER_JSON: the pipeline builds this page from an image, and requiring a
  // valid cluster entry for the rendering host would be a deploy-time failure
  // for no reason.
  it("renders without a cluster map at all", async () => {
    vi.stubEnv("CLUSTER_JSON", "");
    vi.stubEnv("SUBDOMAIN", "nobody");

    const html = await renderHtmlContent(REAL_TEMPLATE, { perServer: false });

    expect(html).toContain("BOOTSTRAP_CONFIG");
    expect(bootstrapConfig(html).gitCommit).toBe("abc");
  });

  // A full render is what the game server serves and what the legacy
  // index-<short>.html replay shell is built from, so guarding those lines had
  // to leave it byte-for-byte identical — same order, same eight-space
  // indentation, same trailing commas.
  it("still emits every guarded line, in place, when the locals are supplied", async () => {
    const html = await renderHtmlContent(REAL_TEMPLATE);

    expect(html).toContain(
      [
        "      window.BOOTSTRAP_CONFIG = {",
        '        gitCommit: "abc",',
        "        assetManifest: {},",
        '        cdnBase: "",',
        `        gameEnv: ${JSON.stringify(ServerEnv.gameEnvName())},`,
        `        cluster: ${JSON.stringify(ServerEnv.cluster())},`,
        '        instanceLetter: "a",',
        '        turnstileSiteKey: "test-key",',
        '        jwtAudience: "openfront.io",',
        '        instanceId: "i-1",',
        '        serverHost: "blue.openfront.io",',
        '        siteHost: "openfront.io",',
        "      };",
      ].join("\n"),
    );
  });

  // INSTANCE_ID is unset on every deployment that does not set it, and
  // ServerEnv.instanceId() answers "" rather than undefined. The guard tests
  // the rendered LOCAL (the JSON string `""`, which is truthy), not the value,
  // so the line survives — as it must, since ClientEnv treats a missing
  // instanceId as a missing BOOTSTRAP_CONFIG.
  it("keeps instanceId in a full render even when it is empty", async () => {
    vi.stubEnv("INSTANCE_ID", "");

    const html = await renderHtmlContent(REAL_TEMPLATE);

    expect(html).toContain('\n        instanceId: "",');
    expect(bootstrapConfig(html).instanceId).toBe("");
  });

  it("defaults to the full render when no options are passed", async () => {
    const config = bootstrapConfig(await renderHtmlContent(REAL_TEMPLATE));

    expect(config.instanceLetter).toBe("a");
    expect(config.serverHost).toBe("blue.openfront.io");
  });
});
