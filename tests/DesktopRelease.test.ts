import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDescriptor,
  clearDesktopReleaseCache,
  getDescriptor,
} from "../src/server/DesktopRelease";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock("../src/server/Logger", () => ({
  logger: {
    child: () => ({ warn: warnMock }),
  },
}));

let dir: string;

beforeEach(async () => {
  clearDesktopReleaseCache();
  warnMock.mockClear();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "release-"));
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

describe("buildDescriptor", () => {
  it("carries the template inline with its own hash", async () => {
    const d = await buildDescriptor(dir, {
      clientVersion: "sha-1",
      cdnBase: "https://cdn.example",
    });

    expect(d.template.html).toBe("<html><%- cdnBase %></html>");
    expect(d.template.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lists every hashed file with a leading-slash url", async () => {
    const d = await buildDescriptor(dir, {
      clientVersion: "sha-1",
      cdnBase: "https://cdn.example",
    });

    expect(d.assets["assets/index-xyz.js"]).toEqual({
      url: "/assets/index-xyz.js",
      sha256: "e".repeat(64),
      bytes: 34,
    });
    expect(Object.keys(d.assets)).toHaveLength(2);
  });

  it("reports the core version with the trailing newline stripped", async () => {
    const d = await buildDescriptor(dir, {
      clientVersion: "sha-1",
      cdnBase: "https://cdn.example",
    });

    expect(d.coreVersion).toBe("abc123");
  });

  // A build-time failure beats 100% of clients failing at runtime: the shell's
  // parseDescriptor aborts the WHOLE descriptor on the first url outside
  // /assets/ and /_assets/, so a stray hash entry is not a degraded asset, it
  // is every Steam player stuck in `failed`.
  it("throws when a hash entry is outside the allowed roots, naming the offender", async () => {
    await fs.writeFile(
      path.join(dir, "asset-hashes.json"),
      JSON.stringify({
        "assets/index-xyz.js": { sha256: "e".repeat(64), bytes: 34 },
        LICENSE: { sha256: "d".repeat(64), bytes: 11 },
      }),
    );

    await expect(
      buildDescriptor(dir, {
        clientVersion: "sha-1",
        cdnBase: "https://cdn.example",
      }),
    ).rejects.toThrow(/LICENSE/);
  });

  // The prefix alone is not the shell's rule. parseDescriptor runs the full
  // safeOverlayPath over both the KEY and the url, so a filename containing any
  // of these would pass a prefix-only guard here and then abort the parse of
  // the whole descriptor for 100% of clients -- the same class of bug as the
  // root-file case above, just latent until someone adds such a filename.
  it.each([
    ["a percent sign", "_assets/images/50%25-off.deadbeef.png"],
    ["a backslash", "_assets/images\\evil.deadbeef.png"],
    ["a query string", "assets/index.js?v=2"],
    ["a fragment", "assets/index.js#frag"],
    ["a traversal segment", "assets/../../etc/passwd"],
    ["a NUL byte", "assets/index\u0000.js"],
  ])("throws when an asset key contains %s", async (_label, key) => {
    await fs.writeFile(
      path.join(dir, "asset-hashes.json"),
      JSON.stringify({
        "assets/index-xyz.js": { sha256: "e".repeat(64), bytes: 34 },
        [key]: { sha256: "d".repeat(64), bytes: 11 },
      }),
    );

    await expect(
      buildDescriptor(dir, {
        clientVersion: "sha-1",
        cdnBase: "https://cdn.example",
      }),
    ).rejects.toThrow(/safeOverlayPath/);
  });

  // sha256/bytes come from a generated file and were previously cast without
  // being checked, so a malformed entry passed the build and only surfaced
  // once the shell's parseDescriptor rejected the WHOLE descriptor at
  // runtime -- the same failure class as the path checks above.
  it.each([
    ["missing", undefined],
    ["too short", "e".repeat(63)],
    ["uppercase", "E".repeat(64)],
    ["not hex", "g".repeat(64)],
  ])("throws when an asset hash's sha256 is %s", async (_label, sha256) => {
    await fs.writeFile(
      path.join(dir, "asset-hashes.json"),
      JSON.stringify({
        "assets/index-xyz.js": { sha256, bytes: 34 },
      }),
    );

    await expect(
      buildDescriptor(dir, {
        clientVersion: "sha-1",
        cdnBase: "https://cdn.example",
      }),
    ).rejects.toThrow(/sha256/);
  });

  it.each([
    ["a string", "34"],
    ["negative", -1],
    ["non-integer", 1.5],
    ["missing", undefined],
  ])("throws when an asset hash's bytes is %s", async (_label, bytes) => {
    await fs.writeFile(
      path.join(dir, "asset-hashes.json"),
      JSON.stringify({
        "assets/index-xyz.js": { sha256: "e".repeat(64), bytes },
      }),
    );

    await expect(
      buildDescriptor(dir, {
        clientVersion: "sha-1",
        cdnBase: "https://cdn.example",
      }),
    ).rejects.toThrow(/bytes/);
  });

  // Nothing checked these at build time at all before.
  it.each([
    ["escapes the overlay", "/../../etc/passwd"],
    ["is outside the allowed roots", "/etc/passwd"],
    ["hides traversal behind encoding", "/assets/..%2f..%2fescape"],
    ["is malformed encoding", "/assets/a%zz.js"],
  ])("throws when a manifest value %s", async (_label, target) => {
    await fs.writeFile(
      path.join(dir, "asset-manifest.json"),
      JSON.stringify({ "images/a.png": target }),
    );

    await expect(
      buildDescriptor(dir, {
        clientVersion: "sha-1",
        cdnBase: "https://cdn.example",
      }),
    ).rejects.toThrow(/safeManifestTarget/);
  });

  // The guard must not be so strict it rejects what the real build emits.
  it("accepts the real build's shapes: a literal space in a key, %20 in a manifest value", async () => {
    await fs.writeFile(
      path.join(dir, "asset-hashes.json"),
      JSON.stringify({
        "_assets/flags/1_East Anglia.719bac9ef408.svg": {
          sha256: "f".repeat(64),
          bytes: 12,
        },
      }),
    );
    await fs.writeFile(
      path.join(dir, "asset-manifest.json"),
      JSON.stringify({
        "flags/1_East Anglia.svg":
          "/_assets/flags/1_East%20Anglia.719bac9ef408.svg",
      }),
    );

    const d = await buildDescriptor(dir, {
      clientVersion: "sha-1",
      cdnBase: "https://cdn.example",
    });

    expect(d.assets["_assets/flags/1_East Anglia.719bac9ef408.svg"].url).toBe(
      "/_assets/flags/1_East Anglia.719bac9ef408.svg",
    );
    expect(d.assetManifest["flags/1_East Anglia.svg"]).toBe(
      "/_assets/flags/1_East%20Anglia.719bac9ef408.svg",
    );
  });

  // The descriptor's `assets` map is keyed by EMITTED PATH; asset-manifest.json
  // maps SEMANTIC NAME -> hashed url. Deriving one from the other leaves every
  // _assets/** lookup missing, so the two must both travel.
  it("carries asset-manifest.json verbatim as the semantic mapping", async () => {
    const d = await buildDescriptor(dir, {
      clientVersion: "sha-1",
      cdnBase: "https://cdn.example",
    });

    expect(d.assetManifest).toEqual({
      "images/a.png": "/_assets/images/a.deadbeef.png",
    });
    // Distinct key-spaces: the semantic name is not an assets key.
    expect(d.assets["images/a.png"]).toBeUndefined();
  });

  it("throws rather than serving a descriptor whose asset manifest is empty", async () => {
    await fs.writeFile(path.join(dir, "asset-manifest.json"), "{}");

    await expect(
      buildDescriptor(dir, { clientVersion: "s", cdnBase: "https://c" }),
    ).rejects.toThrow(/asset-manifest\.json/);
  });

  it("throws rather than serving a descriptor with no assets", async () => {
    await fs.writeFile(path.join(dir, "asset-hashes.json"), "{}");

    await expect(
      buildDescriptor(dir, { clientVersion: "s", cdnBase: "https://c" }),
    ).rejects.toThrow(/asset-hashes\.json/);
  });

  it("warns but does not throw when cdnBase is empty, and still returns a valid descriptor", async () => {
    const d = await buildDescriptor(dir, {
      clientVersion: "sha-1",
      cdnBase: "",
    });

    expect(d.cdnBase).toBe("");
    expect(Object.keys(d.assets)).toHaveLength(2);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatch(/CDN_BASE/);
  });
});

describe("getDescriptor", () => {
  it("memoises: repeat calls with the same arguments do not rebuild", async () => {
    const opts = { clientVersion: "sha-1", cdnBase: "https://cdn.example" };

    const d1 = await getDescriptor(dir, opts);
    const d2 = await getDescriptor(dir, opts);

    expect(d2).toBe(d1);
  });

  it("does not stay poisoned by a rejected build — a later call can retry and succeed", async () => {
    const hashesPath = path.join(dir, "asset-hashes.json");
    const goodHashes = await fs.readFile(hashesPath, "utf-8");
    await fs.rm(hashesPath);

    const opts = { clientVersion: "sha-1", cdnBase: "https://cdn.example" };

    await expect(getDescriptor(dir, opts)).rejects.toThrow();

    await fs.writeFile(hashesPath, goodHashes);

    const d = await getDescriptor(dir, opts);
    expect(d.assets["assets/index-xyz.js"]).toEqual({
      url: "/assets/index-xyz.js",
      sha256: "e".repeat(64),
      bytes: 34,
    });
  });
});
