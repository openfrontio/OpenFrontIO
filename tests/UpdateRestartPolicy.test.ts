import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../update.sh");

const BEGIN = "# --- BEGIN restart policy (tested) ---";
const END = "# --- END restart policy (tested) ---";

// update.sh as a whole runs docker pull/run against a real host, so it cannot
// be executed here. The restart-policy decision inside it is pure, though --
// two strings in, one string out -- so lift exactly that block out of the
// shipped file and run it. Reading the real script rather than restating its
// logic is the point: a copy of the condition in this file would keep passing
// after someone edited update.sh, which is the only failure this test exists
// to catch.
function extractPolicyBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the restart-policy markers in ${SCRIPT}. If the block ` +
        `moved or was renamed, update the markers here and there together.`,
    );
  }
  return source.slice(start + BEGIN.length, end);
}

function restartPolicyFor(subdomain: string, domain: string): string {
  const script = `SUBDOMAIN='${subdomain}'\nDOMAIN='${domain}'\n${extractPolicyBlock()}\nprintf '%s' "$RESTART"\n`;
  return execFileSync("bash", ["-c", script], { encoding: "utf8" });
}

describe("update.sh restart policy", () => {
  // A crash here means a deployment somebody depends on stays down until the
  // next deploy touches it. For nightly that is the 07:00 UTC scheduled run,
  // so up to ~24 hours (OPE-361).
  it.each([
    ["main", "openfront.dev"],
    ["nightly", "openfront.dev"],
    ["green", "openfront.dev"],
    ["blue", "openfront.dev"],
  ])("restarts the long-lived %s.%s deployment after a crash", (sub, dom) => {
    expect(restartPolicyFor(sub, dom)).toBe("always");
  });

  it.each([["main"], ["nightly"], ["blue"], ["green"]])(
    "restarts production (%s.openfront.io) whatever its subdomain is",
    (sub) => {
      expect(restartPolicyFor(sub, "openfront.io")).toBe("always");
    },
  );

  // deploy.yml deploys every push on every branch to <branch>.openfront.dev,
  // so these accumulate one container per branch anyone has ever pushed.
  // `always` would resurrect every abandoned one on a host reboot.
  it.each([["fix-some-bug"], ["t3code-mirv-cooldown-timer"], ["experiment"]])(
    "leaves the per-branch preview %s.openfront.dev down after a crash",
    (sub) => {
      expect(restartPolicyFor(sub, "openfront.dev")).toBe("no");
    },
  );

  // The membership test is space-delimited rather than a substring match, and
  // these are the names that would wrongly match if that ever regressed to a
  // plain `*main*` / `*nightly*` glob. A branch called `main-feature` is an
  // ordinary preview and must not outlive its deploy.
  it.each([
    ["main-feature"],
    ["nightly-test"],
    ["remain"],
    ["overnightly"],
    ["premain"],
  ])("does not treat %s as a long-lived subdomain", (sub) => {
    expect(restartPolicyFor(sub, "openfront.dev")).toBe("no");
  });

  it("does not restart a deployment whose subdomain somehow arrived empty", () => {
    expect(restartPolicyFor("", "openfront.dev")).toBe("no");
  });
});
