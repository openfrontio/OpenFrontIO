import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../deploy.sh");

const BEGIN = "# --- BEGIN identity (tested) ---";
const END = "# --- END identity (tested) ---";

// Same trick as UpdateRestartPolicy.test.ts: deploy.sh as a whole scps and
// sshes to a real box, but the identity block inside it is pure -- the deploy
// target's fields in, the container's identity out -- so lift exactly that
// block out of the shipped file and run it. Reading the real script rather
// than restating its logic is the point: a copy here would keep passing after
// someone edited deploy.sh.
function extractBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the identity markers in ${SCRIPT}. If the block moved ` +
        `or was renamed, update the markers here and there together.`,
    );
  }
  return source.slice(start + BEGIN.length, end);
}

interface Identity {
  letter: string;
  numWorkers: string;
  gameHost: string;
  deploymentName: string;
  siteHost: string;
}

interface Inputs {
  env: "prod" | "staging";
  machine: string;
  subdomain: string;
  domain: string;
  gameDomain?: string;
  letter?: string;
  numWorkers?: string;
  gameHost?: string;
  siteHost?: string;
}

function resolve(env: Inputs): Identity {
  const assign = (name: string, value: string | undefined) =>
    value === undefined ? "" : `${name}='${value}'\n`;
  const script =
    `set -e\n` +
    `ENV='${env.env}'\nHOST='${env.machine}'\nSUBDOMAIN='${env.subdomain}'\n` +
    `DOMAIN='${env.domain}'\nGAME_DOMAIN='${env.gameDomain ?? ""}'\n` +
    assign("INSTANCE_LETTER", env.letter) +
    assign("NUM_WORKERS", env.numWorkers) +
    assign("GAME_HOST", env.gameHost) +
    assign("SITE_HOST", env.siteHost) +
    `${extractBlock()}\n` +
    `printf '%s\\n%s\\n%s\\n%s\\n%s' "$INSTANCE_LETTER" "$NUM_WORKERS" "$GAME_HOST" "$DEPLOYMENT_NAME" "\${SITE_HOST:-}"\n`;
  const out = execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The block echoes a progress line before the printf; the last five lines
  // are the answer.
  const [letter, numWorkers, gameHost, deploymentName, siteHost] = out
    .split("\n")
    .slice(-5);
  return { letter, numWorkers, gameHost, deploymentName, siteHost };
}

function failure(env: Inputs): string {
  try {
    resolve(env);
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    expect(err.status).toBe(1);
    return err.stdout ?? "";
  }
  throw new Error("expected the block to exit 1");
}

describe("deploy.sh identity", () => {
  // Prod: the game host is the bare subdomain, the page is the apex
  // (release.yml passes SITE_HOST). The letter and worker count stay empty
  // for update.sh to fill in from the registry.
  it("resolves prod's hosts and leaves the identity to the registry", () => {
    const r = resolve({
      env: "prod",
      machine: "falk2",
      subdomain: "blue",
      domain: "openfront.io",
      siteHost: "openfront.io",
    });
    expect(r).toEqual({
      letter: "",
      numWorkers: "",
      gameHost: "blue.openfront.io",
      deploymentName: "blue",
      siteHost: "openfront.io",
    });
  });

  // A branch preview is its own site with its own single server: nothing to
  // configure, so nothing is.
  it("resolves a standalone dev deployment's hosts", () => {
    const r = resolve({
      env: "staging",
      machine: "staging",
      subdomain: "feat-foo",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
    });
    expect(r).toEqual({
      letter: "",
      numWorkers: "",
      gameHost: "feat-foo.server.openfront.dev",
      deploymentName: "feat-foo",
      // Under GAME_DOMAIN the page has its own name, which the Worker serves.
      siteHost: "feat-foo.openfront.dev",
    });
  });

  it("keeps a standalone prod deployment's page on its own name", () => {
    const r = resolve({
      env: "prod",
      machine: "falk2",
      subdomain: "beta",
      domain: "openfront.io",
    });
    expect(r.gameHost).toBe("beta.openfront.io");
    expect(r.siteHost).toBe("");
  });

  // A machine-scoped fleet member: the entry passes the game host with the
  // machine in it, and the container name follows so the same slot on two
  // machines cannot collide when both are names for one box.
  it("qualifies the container name for a machine-scoped game host", () => {
    const r = resolve({
      env: "staging",
      machine: "nbg3",
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      letter: "f",
      numWorkers: "2",
      gameHost: "blue.nbg3.server.openfront.dev",
      siteHost: "openfront.dev",
    });
    expect(r).toEqual({
      letter: "f",
      numWorkers: "2",
      gameHost: "blue.nbg3.server.openfront.dev",
      deploymentName: "nbg3-blue",
      siteHost: "openfront.dev",
    });
  });

  it("keeps the bare container name for any other explicit game host", () => {
    const r = resolve({
      env: "staging",
      machine: "staging",
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      letter: "a",
      numWorkers: "2",
      gameHost: "blue.server.openfront.dev",
      siteHost: "openfront.dev",
    });
    expect(r.deploymentName).toBe("blue");
  });

  // A manual workflow_dispatch of a colour passes no SITE_HOST; the slot must
  // still register under the apex or it silently leaves the site's list.
  const dev = {
    env: "staging",
    machine: "staging",
    domain: "openfront.dev",
    gameDomain: "server.openfront.dev",
  } as const;
  const prod = {
    env: "prod",
    machine: "falk2",
    domain: "openfront.io",
  } as const;
  it.each<[string, Inputs, string]>([
    ["blue on dev", { ...dev, subdomain: "blue" }, "openfront.dev"],
    ["green on dev", { ...dev, subdomain: "green" }, "openfront.dev"],
    ["blue on prod", { ...prod, subdomain: "blue" }, "openfront.io"],
    ["green on prod", { ...prod, subdomain: "green" }, "openfront.io"],
    [
      "an explicit SITE_HOST on a colour",
      { ...dev, subdomain: "green", siteHost: "green.openfront.dev" },
      "green.openfront.dev",
    ],
    ["main on dev", { ...dev, subdomain: "main" }, "main.openfront.dev"],
    [
      "bluegreen (not a slot)",
      { ...dev, subdomain: "bluegreen" },
      "bluegreen.openfront.dev",
    ],
    [
      "blue2 (not a slot)",
      { ...dev, subdomain: "blue2" },
      "blue2.openfront.dev",
    ],
    ["blue2 on prod (not a slot)", { ...prod, subdomain: "blue2" }, ""],
  ])("resolves the site of %s", (_what, inputs, siteHost) => {
    expect(resolve(inputs).siteHost).toBe(siteHost);
  });

  // The escape hatch for a hand-run deploy while the API is down: a value
  // given here reaches the env file, and update.sh then skips the registry.
  it("passes an explicit letter and worker count through", () => {
    const r = resolve({
      env: "prod",
      machine: "falk2",
      subdomain: "blue",
      domain: "openfront.io",
      letter: "c",
      numWorkers: "20",
    });
    expect(r.letter).toBe("c");
    expect(r.numWorkers).toBe("20");
  });

  it.each(["ab", "C", "1"])("refuses letter %j", (letter) => {
    expect(
      failure({
        env: "staging",
        machine: "staging",
        subdomain: "blue",
        domain: "openfront.dev",
        letter,
      }),
    ).toContain("one lowercase letter");
  });

  it.each(["0", "-1", "two", "2.5"])("refuses worker count %j", (n) => {
    expect(
      failure({
        env: "staging",
        machine: "staging",
        subdomain: "blue",
        domain: "openfront.dev",
        numWorkers: n,
      }),
    ).toContain("positive integer");
  });

  it("refuses a game host that is not a hostname", () => {
    expect(
      failure({
        env: "staging",
        machine: "staging",
        subdomain: "blue",
        domain: "openfront.dev",
        gameHost: "blue.openfront.dev`; rm -rf /",
      }),
    ).toContain("must be a hostname");
  });
});
