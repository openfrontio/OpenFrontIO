import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { hashDirectory, hashSourceTree } from "../scripts/buildAssetHashes";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hashes-"));
});

describe("hashDirectory", () => {
  it("hashes every file with a posix-relative key and no leading slash", async () => {
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    await fs.writeFile(path.join(dir, "assets", "index-abc.js"), "hello");

    const result = await hashDirectory(dir);

    const expected = createHash("sha256").update("hello").digest("hex");
    expect(result).toEqual({
      "assets/index-abc.js": { sha256: expected, bytes: 5 },
    });
  });

  it("excludes index.html, which is served as a template not an asset", async () => {
    await fs.writeFile(path.join(dir, "index.html"), "<html></html>");
    await fs.writeFile(path.join(dir, "asset-manifest.json"), "{}");

    const result = await hashDirectory(dir);

    expect(result["index.html"]).toBeUndefined();
    expect(result["asset-manifest.json"]).toBeUndefined();
  });
});

describe("hashSourceTree", () => {
  it("is stable across runs and changes when a file changes", async () => {
    await fs.writeFile(path.join(dir, "a.ts"), "export const a = 1;");
    const first = await hashSourceTree(dir);
    expect(await hashSourceTree(dir)).toBe(first);

    await fs.writeFile(path.join(dir, "a.ts"), "export const a = 2;");
    expect(await hashSourceTree(dir)).not.toBe(first);
  });

  it("does not depend on directory read order", async () => {
    await fs.writeFile(path.join(dir, "z.ts"), "z");
    await fs.writeFile(path.join(dir, "a.ts"), "a");
    const first = await hashSourceTree(dir);

    const other = await fs.mkdtemp(path.join(os.tmpdir(), "hashes-"));
    await fs.writeFile(path.join(other, "a.ts"), "a");
    await fs.writeFile(path.join(other, "z.ts"), "z");

    expect(await hashSourceTree(other)).toBe(first);
  });
});
