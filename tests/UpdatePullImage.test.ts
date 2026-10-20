import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../update.sh");

const BEGIN = "# --- BEGIN pull image (tested) ---";
const END = "# --- END pull image (tested) ---";

// Same arrangement as tests/UpdateFlagLatest.test.ts: lift the real block out
// of update.sh and run it against a fake docker, so an edit that changes how
// the host authenticates fails here instead of on a deploy.
function extractPullBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the pull-image markers in ${SCRIPT}. If the block ` +
        `moved or was renamed, update the markers here and there together.`,
    );
  }
  return source.slice(start + BEGIN.length, end);
}

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

// Runs the block under update.sh's own `set -eo pipefail`. The fake docker
// logs each call (and what `login` read on stdin), and fails `pull` or
// `login` when told to.
function runPull(env: {
  GHCR_TOKEN?: string;
  GHCR_USER?: string;
  failPull?: boolean;
  failLogin?: boolean;
}) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-image-"));
  const binDir = path.join(tempDir, "bin");
  fs.mkdirSync(binDir);
  const logFile = path.join(tempDir, "calls");
  fs.writeFileSync(logFile, "");
  const envFile = path.join(tempDir, "deploy.env");
  fs.writeFileSync(
    envFile,
    `GHCR_IMAGE=ghcr.io/openfrontio/openfront-prod:v1\nGHCR_TOKEN=${env.GHCR_TOKEN ?? ""}\nGHCR_USER=${env.GHCR_USER ?? ""}\nAPI_KEY=k3y\n`,
  );
  const fakeDocker = `#!/bin/bash
if [ "$1" = login ]; then
  echo "login \${*:2} stdin=$(cat)" >> '${logFile}'
  [ -n "\${FAIL_LOGIN:-}" ] && exit 1
  exit 0
fi
echo "$*" >> '${logFile}'
if [ "$1" = pull ] && [ -n "\${FAIL_PULL:-}" ]; then exit 1; fi
exit 0
`;
  fs.writeFileSync(path.join(binDir, "docker"), fakeDocker, { mode: 0o755 });

  const script = [
    "set -eo pipefail",
    `export PATH='${binDir}':"$PATH"`,
    "GHCR_IMAGE=ghcr.io/openfrontio/openfront-prod:v1",
    `ENV_FILE='${envFile}'`,
    extractPullBlock(),
    'echo "reached end"',
  ].join("\n");
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      ...(env.GHCR_TOKEN !== undefined ? { GHCR_TOKEN: env.GHCR_TOKEN } : {}),
      ...(env.GHCR_USER !== undefined ? { GHCR_USER: env.GHCR_USER } : {}),
      ...(env.failPull ? { FAIL_PULL: "1" } : {}),
      ...(env.failLogin ? { FAIL_LOGIN: "1" } : {}),
    },
  });
  return {
    status: result.status,
    reachedEnd: result.stdout.includes("reached end"),
    envFile: fs.readFileSync(envFile, "utf8"),
    leftoverBackup: fs.existsSync(`${envFile}.bak`),
    calls: fs
      .readFileSync(logFile, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== ""),
  };
}

describe("update.sh pull image", () => {
  it("logs in with the token on stdin, pulls, then logs out", () => {
    const r = runPull({ GHCR_TOKEN: "ghs_token", GHCR_USER: "evan" });
    expect(r.status).toBe(0);
    expect(r.reachedEnd).toBe(true);
    expect(r.calls).toEqual([
      "login ghcr.io -u evan --password-stdin stdin=ghs_token",
      "pull ghcr.io/openfrontio/openfront-prod:v1",
      "logout ghcr.io",
    ]);
  });

  it("drops the token from the env file the containers get", () => {
    const r = runPull({ GHCR_TOKEN: "ghs_token", GHCR_USER: "evan" });
    expect(r.envFile).toBe(
      "GHCR_IMAGE=ghcr.io/openfrontio/openfront-prod:v1\nAPI_KEY=k3y\n",
    );
    expect(r.leftoverBackup).toBe(false);
  });

  it("drops the token from the env file when the pull fails", () => {
    const r = runPull({ GHCR_TOKEN: "ghs_token", failPull: true });
    expect(r.envFile).not.toContain("ghs_token");
  });

  it("never puts the token on the command line", () => {
    const r = runPull({ GHCR_TOKEN: "ghs_token" });
    const argv = r.calls.map((c) => c.replace(/ stdin=.*$/, ""));
    expect(argv.join("\n")).not.toContain("ghs_token");
  });

  it("logs out and fails the deploy when the pull fails", () => {
    const r = runPull({ GHCR_TOKEN: "ghs_token", failPull: true });
    expect(r.status).not.toBe(0);
    expect(r.reachedEnd).toBe(false);
    expect(r.calls[r.calls.length - 1]).toBe("logout ghcr.io");
  });

  it("fails the deploy when the login fails", () => {
    const r = runPull({ GHCR_TOKEN: "ghs_token", failLogin: true });
    expect(r.status).not.toBe(0);
    expect(r.reachedEnd).toBe(false);
    expect(r.calls.some((c) => c.startsWith("pull"))).toBe(false);
  });

  it("pulls anonymously without a token", () => {
    const r = runPull({});
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["pull ghcr.io/openfrontio/openfront-prod:v1"]);
  });
});
