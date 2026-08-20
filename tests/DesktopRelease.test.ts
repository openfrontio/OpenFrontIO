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
