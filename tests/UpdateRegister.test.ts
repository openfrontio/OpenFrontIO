import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../update.sh");

const BEGIN = "# --- BEGIN register (tested) ---";
const END = "# --- END register (tested) ---";

// Same arrangement as tests/UpdateFlagLatest.test.ts: the real function is
// lifted out of the shipped file and run against a fake curl.
function extractRegisterBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the register markers in ${SCRIPT}. If the block ` +
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

interface Reply {
  /** "000" models a curl that reached nothing and exited non-zero. */
  code: string;
  body?: string;
}

interface Result {
  status: number;
  output: string;
  letter: string;
  numWorkers: string;
  requests: string[];
}

function runRegister(replies: Reply[]): Result {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "register-"));
  const binDir = path.join(tempDir, "bin");
  fs.mkdirSync(binDir);
  const countFile = path.join(tempDir, "count");
  const logFile = path.join(tempDir, "requests");
  fs.writeFileSync(countFile, "0");
  fs.writeFileSync(logFile, "");
  replies.forEach((r, i) =>
    fs.writeFileSync(path.join(tempDir!, `body${i}`), r.body ?? ""),
  );

  const fakeCurl = `#!/bin/bash
CODES=(${replies.map((r) => `'${r.code}'`).join(" ")})
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
CODE="\${CODES[$idx]}"
if [ "$CODE" = "000" ]; then printf '000'; exit 7; fi
cat '${tempDir}'/body$idx > "$OUT"
printf '%s' "$CODE"
`;
  const curlPath = path.join(binDir, "curl");
  fs.writeFileSync(curlPath, fakeCurl);
  fs.chmodSync(curlPath, 0o755);

  const script = [
    `export PATH='${binDir}':"$PATH"`,
    "REGISTER_ATTEMPTS=3",
    "REGISTER_RETRY_DELAY=0",
    extractRegisterBlock(),
    `register_identity 'https://api.openfront.io' 'k3y' 'openfront.io' 'blue.openfront.io' 32`,
    'echo "exit=$?"',
    'echo "letter=${REGISTERED_LETTER:-}"',
    'echo "workers=${REGISTERED_NUM_WORKERS:-}"',
  ].join("\n");

  const output = execFileSync("bash", ["-c", script], { encoding: "utf8" });
  return {
    status: Number(/exit=(\d+)/.exec(output)?.[1]),
    output,
    letter: /letter=(.*)/.exec(output)?.[1] ?? "",
    numWorkers: /workers=(.*)/.exec(output)?.[1] ?? "",
    requests: fs.readFileSync(logFile, "utf8").trim().split("\n"),
  };
}

const OK = { code: "200", body: '{"letter":"c","numWorkers":20}' };

describe("update.sh register_identity", () => {
  it("asks the registry who this host is and takes its answer", () => {
    const r = runRegister([OK]);
    expect(r.status).toBe(0);
    expect(r.letter).toBe("c");
    expect(r.numWorkers).toBe("20");
    expect(r.requests).toEqual([
      'https://api.openfront.io/cluster/register {"site":"openfront.io","host":"blue.openfront.io","cpus":32}',
    ]);
  });

  it("retries an API it cannot reach, then succeeds", () => {
    const r = runRegister([{ code: "000" }, { code: "502" }, OK]);
    expect(r.status).toBe(0);
    expect(r.letter).toBe("c");
    expect(r.requests).toHaveLength(3);
  });

  // The container is not swapped yet at this point, so failing here leaves
  // the old one serving.
  it("fails the deploy when the API never answers", () => {
    const r = runRegister([{ code: "000" }]);
    expect(r.status).toBe(1);
    expect(r.requests).toHaveLength(3);
    expect(r.output).toContain("INSTANCE_LETTER and NUM_WORKERS");
  });

  it.each(["400", "401", "404", "409"])(
    "fails at once on a %s, which a retry cannot fix",
    (code) => {
      const r = runRegister([{ code, body: '{"reason":"nope"}' }, OK]);
      expect(r.status).toBe(1);
      expect(r.requests).toHaveLength(1);
      expect(r.output).toContain("nope");
    },
  );

  it.each([
    ["a missing letter", '{"numWorkers":20}'],
    ["a letter that is not one", '{"letter":"cc","numWorkers":20}'],
    ["a letter that would be shell", '{"letter":"$(id)","numWorkers":20}'],
    ["a zero worker count", '{"letter":"c","numWorkers":0}'],
    ["a fractional worker count", '{"letter":"c","numWorkers":2.5}'],
    ["a body that is not JSON", "<html>challenge</html>"],
  ])("refuses a 200 carrying %s", (_what, body) => {
    const r = runRegister([{ code: "200", body }]);
    expect(r.status).toBe(1);
    expect(r.letter).toBe("");
  });
});
