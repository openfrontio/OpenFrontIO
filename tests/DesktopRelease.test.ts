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
