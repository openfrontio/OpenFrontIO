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

// The identity deploy.sh writes: the tests below boot as letter "a" with one
// worker, on whichever host their DOMAIN/SUBDOMAIN name.
function stubIdentity() {
  vi.stubEnv("INSTANCE_LETTER", "a");
  vi.stubEnv("NUM_WORKERS", "1");
}

describe("RenderHtml", () => {
  const originalGitCommit = process.env.GIT_COMMIT;
  let tempDir: string | null = null;

  beforeEach(() => {
    stubIdentity();
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

  test("injects the one-entry map and own instance letter", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-html-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(
      htmlPath,
      "cluster: <%- cluster %>, instanceLetter: <%- instanceLetter %>",
      "utf8",
    );
    process.env.GIT_COMMIT = "abc";

    const rendered = await getAppShellContent(htmlPath);

    // DOMAIN=localhost with no SUBDOMAIN: the map names the bare domain.
    expect(rendered).toContain('instanceLetter: "a"');
    expect(rendered).toContain('"host":"localhost"');
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
    stubIdentity();
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
    stubIdentity();
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

describe("RenderHtml stripePublishableKey injection", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    stubIdentity();
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

  // Same expression index.html uses to emit the optional key line.
  const TEMPLATE =
    '<%- typeof stripePublishableKey !== "undefined" && stripePublishableKey ? "stripePublishableKey: " + stripePublishableKey + "," : "" %>';

  async function render(): Promise<string> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-html-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(htmlPath, TEMPLATE, "utf8");
    return getAppShellContent(htmlPath);
  }

  test("carries the deployment's key into the page", async () => {
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_abc");
    expect(await render()).toBe('stripePublishableKey: "pk_test_abc",');
  });

  test("omits the line entirely for a deployment without a key", async () => {
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
    expect(await render()).toBe("");
  });
});

describe("RenderHtml faroCollectorUrl injection", () => {
  beforeEach(() => {
    stubIdentity();
    vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
    vi.stubEnv("GIT_COMMIT", "abc");
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearAppShellContentCache();
  });

  test("carries the collector URL into the page", async () => {
    vi.stubEnv("FARO_COLLECTOR_URL", "https://faro.example/collect/k");
    const html = await renderHtmlContent(REAL_TEMPLATE);
    expect(html).toContain(
      '\n        faroCollectorUrl: "https://faro.example/collect/k",',
    );
  });

  test("omits the line entirely when no collector is configured", async () => {
    vi.stubEnv("FARO_COLLECTOR_URL", "");
    const html = await renderHtmlContent(REAL_TEMPLATE);
    expect(html).not.toContain("faroCollectorUrl");
    expect(bootstrapConfig(html)).not.toHaveProperty("faroCollectorUrl");
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
    stubIdentity();
    vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("SITE_HOST", "openfront.io");
    vi.stubEnv("INSTANCE_ID", "i-1");
    vi.stubEnv("GIT_COMMIT", "abc");
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_abc");
    vi.stubEnv("FARO_COLLECTOR_URL", "https://faro.example/collect/k");
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
    // Environment-scoped, so the static per-version page must carry it:
    // it is how a page served by the static Worker still gets a key.
    ["stripePublishableKey"],
    ["faroCollectorUrl"],
    ["cdnBase"],
    ["assetManifest"],
  ])("keeps the build/environment value %s", async (field) => {
    const config = bootstrapConfig(
      await renderHtmlContent(REAL_TEMPLATE, { perServer: false }),
    );

    expect(config[field], field).toBeDefined();
  });

  // Rendering without the per-server locals must not go anywhere near the
  // server's identity: the pipeline builds this page from an image, and
  // requiring one for the rendering host would be a deploy-time failure for
  // no reason.
  it("renders without an identity at all", async () => {
    vi.stubEnv("INSTANCE_LETTER", "");
    vi.stubEnv("NUM_WORKERS", "");
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
        '        stripePublishableKey: "pk_test_abc",',
        '        faroCollectorUrl: "https://faro.example/collect/k",',
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
