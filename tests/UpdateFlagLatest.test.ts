import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../update.sh");

const BEGIN = "# --- BEGIN flag latest (tested) ---";
const END = "# --- END flag latest (tested) ---";

// Same arrangement as tests/UpdateRestartPolicy.test.ts: update.sh as a whole
// drives docker and ssh, but the decision this block makes is reachable — it
// talks to exactly one thing, curl, and that can be replaced. Lift the real
// function out of the shipped file rather than restating it, so an edit to
// update.sh that changes the outcome fails here instead of on a deploy.
function extractFlagLatestBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the flag-latest markers in ${SCRIPT}. If the block ` +
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

interface Result {
  status: number;
  output: string;
  /** One line per request the function actually made. */
  requests: string[];
}

/**
 * Run the real flag_latest against a fake curl that hands back `codes` in
 * order, repeating the last one forever once they run out (which is how a
 * genuinely-stuck API behaves, and what the retry deadline has to end).
 */
function runFlagLatest(
  codes: string[],
  opts: { clusterStateSource?: string; timeout?: number } = {},
): Result {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-latest-"));
  const binDir = path.join(tempDir, "bin");
  fs.mkdirSync(binDir);
  const countFile = path.join(tempDir, "count");
  const logFile = path.join(tempDir, "requests");
  fs.writeFileSync(countFile, "0");
  fs.writeFileSync(logFile, "");

  // Writes the response body where -o points, logs the URL and payload, and
  // prints the scripted status code on stdout the way -w "%{http_code}" does.
  const fakeCurl = `#!/bin/bash
CODES=(${codes.map((c) => `'${c}'`).join(" ")})
n="$(cat '${countFile}')"
idx="$n"
if [ "$idx" -ge "\${#CODES[@]}" ]; then idx=$(( \${#CODES[@]} - 1 )); fi
echo $(( n + 1 )) > '${countFile}'
OUT=/dev/null
URL=""
DATA=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) OUT="$2"; shift 2 ;;
    -d) DATA="$2"; shift 2 ;;
    http*) URL="$1"; shift ;;
    *) shift ;;
  esac
done
echo "\${URL} \${DATA}" >> '${logFile}'
printf 'scripted body for %s' "\${CODES[$idx]}" > "$OUT"
printf '%s' "\${CODES[$idx]}"
`;
  const curlPath = path.join(binDir, "curl");
  fs.writeFileSync(curlPath, fakeCurl);
  fs.chmodSync(curlPath, 0o755);

  const script = [
    `export PATH='${binDir}':"$PATH"`,
    `FLAG_LATEST_TIMEOUT=${opts.timeout ?? 5}`,
    "FLAG_LATEST_RETRY_DELAY=0",
    extractFlagLatestBlock(),
    `flag_latest 'openfront.io' 'abc123' 'https://api.openfront.io' 'k3y' '${opts.clusterStateSource ?? ""}'`,
    'echo "exit=$?"',
  ].join("\n");

  const output = execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    // A run that hangs is a bug in the loop, not a slow machine: every sleep
    // is zero here.
    timeout: 30_000,
  });
  const statusMatch = /exit=(\d+)/.exec(output);
  if (statusMatch === null) {
    throw new Error(`flag_latest produced no exit line:\n${output}`);
  }
  return {
    status: Number(statusMatch[1]),
    output,
    requests: fs
      .readFileSync(logFile, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== ""),
  };
}

describe("update.sh flag_latest", () => {
  it("posts the site and the full version to /cluster/latest", () => {
    const result = runFlagLatest(["200"]);

    expect(result.status).toBe(0);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toContain(
      "https://api.openfront.io/cluster/latest",
    );
    expect(result.requests[0]).toContain('"site": "openfront.io"');
    expect(result.requests[0]).toContain('"version": "abc123"');
  });

  // The whole reason the call is last in update.sh: the API refuses a version
  // nothing has registered for, and the container takes ~10s to register. A
  // single 409 must not end the deploy.
  it("retries a 409 until a server has registered for this version", () => {
    const result = runFlagLatest(["409", "409", "200"]);

    expect(result.status).toBe(0);
    expect(result.requests).toHaveLength(3);
    expect(result.output).toContain("Flagged abc123 as latest");
  });

  it.each([["000"], ["500"], ["502"], ["503"]])(
    "retries an unreachable or broken API (%s)",
    (code) => {
      const result = runFlagLatest([code, "200"]);

      expect(result.status).toBe(0);
      expect(result.requests).toHaveLength(2);
    },
  );

  // Every deploy hits this until the registry ships, so it must be quiet and
  // must not retry: there is no route to come back.
  it("accepts a 404 immediately — the API predates the registry", () => {
    const result = runFlagLatest(["404"]);

    expect(result.status).toBe(0);
    expect(result.requests).toHaveLength(1);
    expect(result.output).toContain("not deployed yet");
  });

  // While clients still boot from BOOTSTRAP_CONFIG, an unflagged version
  // changes nothing a player can see. Failing here would fail every deploy for
  // a warning.
  it("warns but succeeds when 409 outlasts the retries and the site still boots from the page", () => {
    const result = runFlagLatest(["409"], { timeout: 0 });

    expect(result.status).toBe(0);
    expect(result.output).toContain("Failed to flag abc123 as latest");
    expect(result.output).toContain("Continuing");
  });

  // ...but once the site's clients ask the API for their server list, an
  // unflagged version means no server is open: nobody can start a game. A
  // deploy that ends there has not succeeded.
  it("fails the deploy when 409 outlasts the retries and CLUSTER_STATE_SOURCE=api", () => {
    const result = runFlagLatest(["409"], {
      timeout: 0,
      clusterStateSource: "api",
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("CLUSTER_STATE_SOURCE=api");
  });

  it("still tolerates a 404 when CLUSTER_STATE_SOURCE=api", () => {
    const result = runFlagLatest(["404"], { clusterStateSource: "api" });

    expect(result.status).toBe(0);
  });

  // A bad key or a malformed body is not a race with a booting container, so
  // spending 90 seconds on it only delays the report.
  it.each([["400"], ["401"], ["403"]])(
    "does not retry a client error (%s)",
    (code) => {
      const result = runFlagLatest([code]);

      expect(result.status).toBe(0);
      expect(result.requests).toHaveLength(1);
      expect(result.output).toContain(`HTTP ${code}`);
    },
  );

  it("fails the deploy on a client error when CLUSTER_STATE_SOURCE=api", () => {
    const result = runFlagLatest(["401"], { clusterStateSource: "api" });

    expect(result.status).toBe(1);
  });

  // Anything other than the literal "api" is not the switch. An env file
  // carrying CLUSTER_STATE_SOURCE=page (or a typo) must keep the lenient
  // behaviour rather than start failing deploys.
  it.each([["page"], ["API"], ["api-preview"], [""]])(
    "treats CLUSTER_STATE_SOURCE=%s as not-the-API",
    (value) => {
      const result = runFlagLatest(["409"], {
        timeout: 0,
        clusterStateSource: value,
      });

      expect(result.status).toBe(0);
    },
  );
});
