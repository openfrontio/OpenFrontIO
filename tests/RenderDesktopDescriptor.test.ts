import { spawnSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every case spawns tsx in a child process — under a second on its own, but
// well past the 5s default once the whole suite is running in parallel.
vi.setConfig({ testTimeout: 120_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI = path.join(REPO_ROOT, "src/server/RenderDesktopDescriptor.ts");

const TEMPLATE = "<html><%- cdnBase %></html>";
const TEMPLATE_SHA = createHash("sha256").update(TEMPLATE).digest("hex");

// The CLI resolves its static directory from its own __dirname
// (`../../static`), which is the whole point — it is meant to be run inside the
// built image where that directory is the build output. To exercise the real
// file rather than a paraphrase of it, stage a copy at the same depth inside a
// throwaway directory in the repo, with fixture `static/` next to it, and
// repoint its three imports back at the real sources. Anything the shipped
// file does — argument handling, which BuildOpts it passes, what it writes to
// stdout — is what runs here; only where it looks for `static/` changes.
//
// Inside the repo rather than os.tmpdir() so the rewritten relative imports and
// node_modules resolution both still work.
function stage(staticFiles: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(REPO_ROOT, ".tmp-desktop-cli-"));
  const serverDir = path.join(root, "src", "server");
  fs.mkdirSync(serverDir, { recursive: true });
  fs.mkdirSync(path.join(root, "static"), { recursive: true });

  const source = fs
    .readFileSync(CLI, "utf8")
    // Rewrites both the static `from "./X"` form and the dynamic
    // `import("./X")` form; `"../../static"` is deliberately left alone, since
    // pointing the CLI at the fixture build output is the whole trick.
    .replace(/"\.\/(\w+)"/g, '"../../../src/server/$1"')
    .replace(/"\.\.\/core\//g, '"../../../src/core/');
  fs.writeFileSync(path.join(serverDir, "RenderDesktopDescriptor.ts"), source);

  for (const [name, content] of Object.entries(staticFiles)) {
    fs.writeFileSync(path.join(root, "static", name), content);
  }
  return root;
}

const VALID_STATIC: Record<string, string> = {
  "index.html": TEMPLATE,
  "core-version.txt": "core-9\n",
  "asset-manifest.json": JSON.stringify({
    "images/a.png": "/_assets/images/a.deadbeef.png",
  }),
  "asset-hashes.json": JSON.stringify({
    "_assets/images/a.deadbeef.png": { sha256: "f".repeat(64), bytes: 12 },
    "assets/index-xyz.js": { sha256: "e".repeat(64), bytes: 34 },
  }),
};

let staged: string | null = null;

afterEach(() => {
  if (staged) {
    fs.rmSync(staged, { recursive: true, force: true });
    staged = null;
  }
});

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(
  args: string[],
  env: Record<string, string>,
  staticFiles: Record<string, string> = VALID_STATIC,
): RunResult {
  staged = stage(staticFiles);
  const entry = path.join(staged, "src/server/RenderDesktopDescriptor.ts");
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs"), entry, ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const STAGING_ENV = {
  GAME_ENV: "staging",
  GIT_COMMIT: "a".repeat(40),
  CDN_BASE: "https://cdn.example",
  DOMAIN: "openfront.dev",
};

describe("RenderDesktopDescriptor CLI", () => {
  it("writes the release descriptor the server would serve", () => {
    const result = run([], STAGING_ENV);

    expect(result.status).toBe(0);
    const d = JSON.parse(result.stdout);
    expect(d.schemaVersion).toBe(1);
    // clientVersion is GIT_COMMIT, not static/commit.txt: it has to be the
    // value the running server reports for itself, because that is what the
    // API's registry matches a flagged `latest` against.
    expect(d.clientVersion).toBe("a".repeat(40));
    expect(d.coreVersion).toBe("core-9");
    expect(d.cdnBase).toBe("https://cdn.example");
    // The raw EJS template, by design — the Steam shell renders it itself.
    expect(d.template.html).toBe(TEMPLATE);
    expect(d.template.sha256).toBe(TEMPLATE_SHA);
    expect(d.assets["_assets/images/a.deadbeef.png"]).toEqual({
      url: "/_assets/images/a.deadbeef.png",
      sha256: "f".repeat(64),
      bytes: 12,
    });
  });

  // version.json is polled once a minute by every running desktop client, so
  // it must stay the two fields and nothing else.
  it("writes only the pointer with --version-pointer", () => {
    const result = run(["--version-pointer"], STAGING_ENV);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      clientVersion: "a".repeat(40),
      coreVersion: "core-9",
    });
  });

  // stdout is the data channel and several things on the import path write to
  // it as if it were a log: dotenv's "injected env" banner, Logger.ts's OTEL
  // line, and winston's Console transport (stdout for every level, including
  // buildDescriptor's empty-cdnBase warning). Any of them would publish a
  // release.json no Steam client can parse, so the CLI redirects the lot to
  // stderr. This asserts both halves: stdout is only JSON, and the noise is
  // still there to be read.
  it("keeps log noise off stdout, on stderr", () => {
    const result = run([], { ...STAGING_ENV, CDN_BASE: "" });

    expect(result.stdout.startsWith("{")).toBe(true);
    expect(result.stdout.trimEnd().endsWith("}")).toBe(true);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stderr).toContain("remote logging disabled");
    // The winston warning buildDescriptor emits for an empty cdnBase.
    expect(result.stderr).toContain("CDN_BASE is unset");
  });

  // Same rule as Master.ts's descriptorOpts. Failing here fails the deploy,
  // which is the entire reason to build the descriptor before publishing it
  // rather than after.
  it("refuses to build a production descriptor with no CDN", () => {
    const result = run([], {
      ...STAGING_ENV,
      GAME_ENV: "prod",
      CDN_BASE: "",
      DOMAIN: "openfront.io",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CDN_BASE is unset");
  });

  it("allows an empty CDN outside production", () => {
    const result = run([], { ...STAGING_ENV, CDN_BASE: "" });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).cdnBase).toBe("");
  });

  // A broken build must stop the deploy rather than publish a descriptor the
  // shell will reject on every Steam client.
  it("exits non-zero when the build output is unusable", () => {
    const result = run([], STAGING_ENV, {
      ...VALID_STATIC,
      "asset-hashes.json": JSON.stringify({}),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to build desktop release");
  });

  it("rejects an unrecognised argument instead of silently full-rendering", () => {
    const result = run(["--pointer"], STAGING_ENV);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--pointer");
  });
});
