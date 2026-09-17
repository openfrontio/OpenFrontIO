import ejs from "ejs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vm from "vm";
import {
  buildDescriptor,
  clearDesktopReleaseCache,
} from "../../src/server/DesktopRelease";
import {
  buildBootstrapConfig,
  clearAppShellContentCache,
  renderHtmlContent,
} from "../../src/server/RenderHtml";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ warn: vi.fn() }) },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_TEMPLATE = path.resolve(__dirname, "../../index.html");

const TEST_CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", color: "blue", numWorkers: 1 },
  b: { host: "localhost", color: "blue", numWorkers: 1 },
});

const PER_SERVER_FIELDS = [
  "cluster",
  "instanceLetter",
  "instanceId",
  "serverHost",
  "siteHost",
] as const;

function bootstrapConfigOf(html: string): Record<string, unknown> {
  const match = /window\.BOOTSTRAP_CONFIG = (\{[\s\S]*?\n\s*\});/.exec(html);
  if (match === null) {
    throw new Error("rendered page has no window.BOOTSTRAP_CONFIG assignment");
  }
  return vm.runInNewContext(`(${match[1]})`) as Record<string, unknown>;
}

function stubProdLikeEnv(): void {
  vi.stubEnv("CLUSTER_JSON", TEST_CLUSTER);
  vi.stubEnv("TURNSTILE_SITE_KEY", "test-key");
  vi.stubEnv("DOMAIN", "openfront.io");
  vi.stubEnv("SUBDOMAIN", "blue");
  vi.stubEnv("SITE_HOST", "openfront.io");
  vi.stubEnv("INSTANCE_ID", "i-1");
  vi.stubEnv("GIT_COMMIT", "abc");
  vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_abc");
  vi.stubEnv("CDN_BASE", "https://cdn.example");
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearAppShellContentCache();
  clearDesktopReleaseCache();
});

// One function owns the BOOTSTRAP_CONFIG field list; the page and the desktop
// descriptor both derive from it. These pin down what it returns so that a
// change to it is a deliberate change to both consumers.
describe("buildBootstrapConfig", () => {
  beforeEach(stubProdLikeEnv);

  const MANIFEST = { "images/a.png": "/_assets/images/a.deadbeef.png" };

  it("returns exactly the environment values with perServer false", () => {
    const config = buildBootstrapConfig({
      perServer: false,
      assetManifest: MANIFEST,
      cdnBase: "https://cdn.example",
    });

    expect(config).toEqual({
      gitCommit: "abc",
      assetManifest: MANIFEST,
      cdnBase: "https://cdn.example",
      gameEnv: ServerEnv.gameEnvName(),
      turnstileSiteKey: "test-key",
      jwtAudience: "openfront.io",
      stripePublishableKey: "pk_test_abc",
    });
    // toEqual treats an undefined-valued key as absent; the descriptor is
    // JSON but the template guard is `typeof x !== "undefined"`, so check
    // the KEYS, not just the values.
    expect(Object.keys(config)).not.toEqual(
      expect.arrayContaining([...PER_SERVER_FIELDS]),
    );
    for (const field of PER_SERVER_FIELDS) {
      expect(config).not.toHaveProperty(field);
    }
  });

  it("adds every per-server value with perServer true", () => {
    const config = buildBootstrapConfig({
      perServer: true,
      assetManifest: MANIFEST,
      cdnBase: "https://cdn.example",
    });

    expect(config).toEqual({
      gitCommit: "abc",
      assetManifest: MANIFEST,
      cdnBase: "https://cdn.example",
      gameEnv: ServerEnv.gameEnvName(),
      cluster: JSON.parse(TEST_CLUSTER),
      instanceLetter: "a",
      turnstileSiteKey: "test-key",
      jwtAudience: "openfront.io",
      stripePublishableKey: "pk_test_abc",
      instanceId: "i-1",
      serverHost: "blue.openfront.io",
      siteHost: "openfront.io",
    });
  });

  // Absent, not undefined: the template drops a guarded line only for an
  // absent local, and a JSON round-trip would silently drop an undefined
  // value anyway, so the two consumers must see the same shape.
  it.each([
    [
      "serverHost",
      () => {
        // No SUBDOMAIN is dev: clusterSelf() then resolves by DOMAIN, so
        // point it at TEST_CLUSTER's localhost entry.
        vi.stubEnv("SUBDOMAIN", "");
        vi.stubEnv("DOMAIN", "localhost");
      },
    ],
    ["siteHost", () => vi.stubEnv("SITE_HOST", "")],
    ["stripePublishableKey", () => vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "")],
  ])("omits the key %s (not undefined-valued) when unset", (field, unset) => {
    unset();

    const config = buildBootstrapConfig({
      perServer: true,
      assetManifest: {},
      cdnBase: "",
    });

    expect(config).not.toHaveProperty(field);
  });

  it("keeps instanceId in a full render even when it is empty", () => {
    vi.stubEnv("INSTANCE_ID", "");

    const config = buildBootstrapConfig({
      perServer: true,
      assetManifest: {},
      cdnBase: "",
    });

    expect(config).toHaveProperty("instanceId", "");
  });

  it("never reads the cluster map with perServer false", () => {
    vi.stubEnv("CLUSTER_JSON", "");
    vi.stubEnv("SUBDOMAIN", "nobody");
    const cluster = vi.spyOn(ServerEnv, "cluster");

    expect(() =>
      buildBootstrapConfig({
        perServer: false,
        assetManifest: {},
        cdnBase: "",
      }),
    ).not.toThrow();
    expect(cluster).not.toHaveBeenCalled();
  });
});

describe("renderHtmlContent derives the page from buildBootstrapConfig", () => {
  beforeEach(stubProdLikeEnv);

  // The page's BOOTSTRAP_CONFIG, parsed back, must be the object the builder
  // returned (the runtime manifest is whatever static/ holds in this
  // checkout, so compare against a builder call using the page's own value).
  it.each([[true], [false]])(
    "perServer=%s: the page carries exactly the builder's object",
    async (perServer) => {
      const page = bootstrapConfigOf(
        await renderHtmlContent(REAL_TEMPLATE, { perServer }),
      );
      const expected = buildBootstrapConfig({
        perServer,
        assetManifest: page.assetManifest as Record<string, string>,
        cdnBase: "https://cdn.example",
      });

      expect(page).toEqual(expected);
      expect(Object.keys(page).sort()).toEqual(Object.keys(expected).sort());
    },
  );

  // The environment-only block, byte for byte -- the counterpart of the full
  // render assertion in RenderHtml.test.ts. This is the page uploaded per
  // version, so its exact bytes are what every player of a version boots
  // from.
  it("emits the environment-only block byte for byte", async () => {
    const html = await renderHtmlContent(REAL_TEMPLATE, { perServer: false });

    expect(html).toContain(
      [
        "      window.BOOTSTRAP_CONFIG = {",
        '        gitCommit: "abc",',
        "        assetManifest: {},",
        '        cdnBase: "https://cdn.example",',
        `        gameEnv: ${JSON.stringify(ServerEnv.gameEnvName())},`,
        '        turnstileSiteKey: "test-key",',
        '        jwtAudience: "openfront.io",',
        '        stripePublishableKey: "pk_test_abc",',
        "      };",
      ].join("\n"),
    );
  });

  // Ready for the single-placeholder template: the whole object is also
  // offered as one local. Nothing in index.html reads it yet.
  it("passes the whole object as the bootstrapConfig local", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bootstrap-config-"));
    try {
      const htmlPath = path.join(dir, "index.html");
      await fs.writeFile(htmlPath, "<%- bootstrapConfig %>", "utf8");

      const rendered = await renderHtmlContent(htmlPath, { perServer: false });

      expect(JSON.parse(rendered)).toEqual(
        buildBootstrapConfig({
          perServer: false,
          assetManifest: JSON.parse(rendered).assetManifest,
          cdnBase: "https://cdn.example",
        }),
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("desktop release descriptor bootstrap", () => {
  let dir: string;

  beforeEach(async () => {
    stubProdLikeEnv();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "release-bootstrap-"));
    await fs.writeFile(
      path.join(dir, "index.html"),
      "<html><%- cdnBase %></html>",
    );
    await fs.writeFile(path.join(dir, "core-version.txt"), "abc123\n");
    await fs.writeFile(
      path.join(dir, "asset-manifest.json"),
      JSON.stringify({ "images/a.png": "/_assets/images/a.deadbeef.png" }),
    );
    await fs.writeFile(
      path.join(dir, "asset-hashes.json"),
      JSON.stringify({
        "_assets/images/a.deadbeef.png": { sha256: "f".repeat(64), bytes: 12 },
        "assets/index-xyz.js": { sha256: "e".repeat(64), bytes: 34 },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const OPTS = {
    clientVersion: "abc",
    cdnBase: "https://cdn.example",
    requireCdnBase: false,
  };

  it("carries the environment values and no server value", async () => {
    const d = await buildDescriptor(dir, OPTS);

    expect(d.schemaVersion).toBe(1);
    expect(d.bootstrap).toMatchObject({
      gitCommit: "abc",
      gameEnv: ServerEnv.gameEnvName(),
      turnstileSiteKey: "test-key",
      jwtAudience: "openfront.io",
      stripePublishableKey: "pk_test_abc",
      cdnBase: "https://cdn.example",
      assetManifest: d.assetManifest,
    });
    for (const field of PER_SERVER_FIELDS) {
      expect(d.bootstrap, field).not.toHaveProperty(field);
    }
    // And the JSON the shell actually parses drops nothing on the way.
    expect(JSON.parse(JSON.stringify(d)).bootstrap).toEqual(d.bootstrap);
  });

  // The descriptor and the page must never drift: both come from the one
  // builder, with the descriptor's own manifest and cdnBase.
  it("equals buildBootstrapConfig({ perServer: false }) for the same env", async () => {
    const d = await buildDescriptor(dir, OPTS);

    expect(d.bootstrap).toEqual(
      buildBootstrapConfig({
        perServer: false,
        assetManifest: d.assetManifest,
        cdnBase: OPTS.cdnBase,
      }),
    );
  });

  // Published per version from inside the image, where there is no reason to
  // have a valid cluster entry for the building host.
  it("builds without a cluster map at all", async () => {
    vi.stubEnv("CLUSTER_JSON", "");
    vi.stubEnv("SUBDOMAIN", "nobody");

    const d = await buildDescriptor(dir, OPTS);

    expect(d.bootstrap?.gitCommit).toBe("abc");
    expect(d.bootstrap).not.toHaveProperty("cluster");
  });
});

// Steam shell contract.
//
// openfront-desktop fetches release.json and renders `template.html` -- the
// raw index.html -- ITSELF, with the locals its buildRenderContext supplies.
// The list below mirrors that function, frozen at the shell that is installed
// today; `bootstrapConfig` is the one the next shell adds. In EJS a placeholder
// with no local is a ReferenceError, i.e. a blank window for every Steam
// player, so adding an unguarded placeholder to index.html must fail HERE, in
// this repo's CI -- not in the desktop repo after the release has shipped.
// Guarding a placeholder with `typeof x !== "undefined" && x` is fine; that is
// how siteHost and stripePublishableKey, which the shell does not supply, get
// through.
//
// Do NOT add to this list to make a failing test pass. A new value the shell
// must carry belongs in buildBootstrapConfig, where the descriptor's
// `bootstrap` delivers it to the shell without a shell release.
describe("Steam shell contract", () => {
  const SHELL_LOCALS = {
    gitCommit: JSON.stringify("abc"),
    assetManifest: JSON.stringify({ "images/a.png": "/_assets/images/a.png" }),
    cdnBase: JSON.stringify("https://cdn.example"),
    cdnBaseRaw: "https://cdn.example",
    gameEnv: JSON.stringify("prod"),
    numWorkers: JSON.stringify(1),
    cluster: JSON.stringify({
      a: { host: "blue.openfront.io", color: "blue", numWorkers: 1 },
    }),
    instanceLetter: JSON.stringify("a"),
    turnstileSiteKey: JSON.stringify("test-key"),
    jwtAudience: JSON.stringify("openfront.io"),
    instanceId: JSON.stringify("desktop"),
    serverHost: JSON.stringify("blue.openfront.io"),
    manifestHref: "https://cdn.example/manifest.json",
    faviconHref: "https://cdn.example/images/Favicon.svg",
    gameplayScreenshotUrl: "https://cdn.example/images/GameplayScreenshot.png",
    backgroundImageUrl: "https://cdn.example/images/background.webp",
    desktopLogoImageUrl: "https://cdn.example/images/OpenFront.png",
    mobileLogoImageUrl: "https://cdn.example/images/OF.png",
    bootstrapConfig: JSON.stringify({ gitCommit: "abc" }),
  };

  it("renders index.html with exactly the locals today's shell supplies", async () => {
    const template = await fs.readFile(REAL_TEMPLATE, "utf-8");

    const html = ejs.render(template, { ...SHELL_LOCALS });

    const config = bootstrapConfigOf(html);
    expect(config.gitCommit).toBe("abc");
    expect(config.gameEnv).toBe("prod");
    expect(config.turnstileSiteKey).toBe("test-key");
    expect(config.jwtAudience).toBe("openfront.io");
  });

  // Prove the contract can fail: a template that names a local the shell does
  // not supply must throw, or the test above guards nothing.
  it("fails on a placeholder the shell does not supply", () => {
    expect(() =>
      ejs.render("<%- notSuppliedByTheShell %>", { ...SHELL_LOCALS }),
    ).toThrow(ReferenceError);
  });
});
