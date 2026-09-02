import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  APP_REJECTION_MAX,
  APP_REJECTION_MIN,
  CloseCode,
  CloseReason,
  isTerminalClose,
} from "../src/core/CloseCodes";

const PROJECT_ROOT = path.join(__dirname, "..");

function readEnJson(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "resources", "lang", "en.json"),
      "utf-8",
    ),
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("isTerminalClose", () => {
  it("treats a normal close as terminal", () => {
    expect(isTerminalClose(CloseCode.Normal)).toBe(true);
  });

  it("treats every application rejection as terminal", () => {
    for (const code of [
      CloseCode.BadRequest,
      CloseCode.Unauthorized,
      CloseCode.Forbidden,
      CloseCode.Banned,
      CloseCode.GameNotFound,
      CloseCode.GameClosed,
      CloseCode.LobbyFull,
    ]) {
      expect(isTerminalClose(code)).toBe(true);
    }
  });

  it("treats transport and server faults as retryable", () => {
    for (const code of [
      CloseCode.ProtocolError,
      CloseCode.InternalError,
      CloseCode.TryAgainLater,
      1006,
    ]) {
      expect(isTerminalClose(code)).toBe(false);
    }
  });

  it("bounds the terminal range to the private-use range", () => {
    expect(isTerminalClose(APP_REJECTION_MIN - 1)).toBe(false);
    expect(isTerminalClose(APP_REJECTION_MIN)).toBe(true);
    expect(isTerminalClose(APP_REJECTION_MAX)).toBe(true);
    expect(isTerminalClose(APP_REJECTION_MAX + 1)).toBe(false);
    expect(isTerminalClose(4099)).toBe(true);
    expect(isTerminalClose(4100)).toBe(true);
    expect(isTerminalClose(4199)).toBe(true);
  });
});

describe("CloseCode", () => {
  it("assigns every application rejection a distinct code in the private range", () => {
    const appCodes = Object.values(CloseCode).filter(
      (code) => code >= APP_REJECTION_MIN,
    );
    expect(appCodes.length).toBeGreaterThan(0);
    for (const code of appCodes) {
      expect(code).toBeLessThanOrEqual(APP_REJECTION_MAX);
    }
    expect(new Set(Object.values(CloseCode)).size).toBe(
      Object.values(CloseCode).length,
    );
  });

  it("keeps the registered codes out of the private range", () => {
    for (const code of [
      CloseCode.Normal,
      CloseCode.ProtocolError,
      CloseCode.InternalError,
      CloseCode.TryAgainLater,
    ]) {
      expect(code).toBeLessThan(APP_REJECTION_MIN);
    }
  });
});

describe("CloseReason", () => {
  it("uses snake_case keys under the close_reason namespace", () => {
    for (const key of Object.values(CloseReason)) {
      expect(key).toMatch(/^close_reason\.[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });

  it("fits every key in the 123-byte close frame reason limit", () => {
    for (const key of Object.values(CloseReason)) {
      expect(Buffer.byteLength(key, "utf8")).toBeLessThanOrEqual(123);
    }
  });

  it("has no en.json entry without a key", () => {
    const en = readEnJson();
    const namespace = en["close_reason"] as Record<string, string>;
    expect(namespace).toBeDefined();
    const known = new Set(
      Object.values(CloseReason).map((k) => k.slice("close_reason.".length)),
    );
    expect(Object.keys(namespace).filter((k) => !known.has(k))).toEqual([]);
  });
});

it("closes sockets only through CloseCode", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(path.join(PROJECT_ROOT, "src"))) {
    const content = fs.readFileSync(file, "utf-8");
    for (const match of content.matchAll(/\.close\(\s*[0-9]/g)) {
      const line = content.slice(0, match.index).split("\n").length;
      offenders.push(`${path.relative(PROJECT_ROOT, file)}:${line}`);
    }
  }
  expect(offenders).toEqual([]);
});
