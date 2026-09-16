import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../deploy.sh");

const BEGIN = "# --- BEGIN game host (tested) ---";
const END = "# --- END game host (tested) ---";

// Same trick as UpdateRestartPolicy.test.ts: deploy.sh as a whole scps and
// sshes to a real box, but the cluster lookup inside it is pure -- a handful
// of strings in, a game host, a container name and a site host out -- so
// lift exactly that block out of the shipped file and run it. Reading the
// real script rather than restating its logic is the point: a copy here
// would keep passing after someone edited deploy.sh.
function extractBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the game host markers in ${SCRIPT}. If the block ` +
        `moved or was renamed, update the markers here and there together.`,
    );
  }
  return source.slice(start + BEGIN.length, end);
}

interface Resolved {
  gameHost: string;
  deploymentName: string;
  siteHost: string;
  cluster: Record<string, { host: string }>;
}

function resolve(env: {
  env: "prod" | "staging";
  machine: string;
  subdomain: string;
  domain: string;
  gameDomain?: string;
  clusterJson?: string;
  expectedColor?: string;
  siteHost?: string;
}): Resolved {
  const assign = (name: string, value: string | undefined) =>
    value === undefined ? "" : `${name}='${value}'\n`;
  const script =
    `set -e\n` +
    `ENV='${env.env}'\nHOST='${env.machine}'\nSUBDOMAIN='${env.subdomain}'\n` +
    `DOMAIN='${env.domain}'\nGAME_DOMAIN='${env.gameDomain ?? ""}'\n` +
    assign("CLUSTER_JSON", env.clusterJson) +
    assign("EXPECTED_COLOR", env.expectedColor) +
    assign("SITE_HOST", env.siteHost) +
    `${extractBlock()}\n` +
    `printf '%s\\n%s\\n%s\\n%s' "$GAME_HOST" "$DEPLOYMENT_NAME" "\${SITE_HOST:-}" "$CLUSTER_JSON"\n`;
  const out = execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = out.split("\n");
  // The block echoes progress lines before the printf; the last four lines
  // are the answer.
  const [gameHost, deploymentName, siteHost, cluster] = lines.slice(-4);
  return { gameHost, deploymentName, siteHost, cluster: JSON.parse(cluster) };
}

function failure(env: Parameters<typeof resolve>[0]): string {
  try {
    resolve(env);
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    expect(err.status).toBe(1);
    return err.stdout ?? "";
  }
  throw new Error("expected the block to exit 1");
}

// The dev fleet, machine-scoped: staging2 is a second name for the staging
// box, so both machines' blue and green share one Traefik.
const DEV_FLEET = JSON.stringify({
  a: {
    host: "blue.staging.server.openfront.dev",
    color: "blue",
    numWorkers: 2,
  },
  b: {
    host: "green.staging.server.openfront.dev",
    color: "green",
    numWorkers: 2,
  },
  f: {
    host: "blue.staging2.server.openfront.dev",
    color: "blue",
    numWorkers: 2,
  },
  g: {
    host: "green.staging2.server.openfront.dev",
    color: "green",
    numWorkers: 2,
  },
});

// Prod as it is today: one box, standalone-shaped hosts.
const PROD = JSON.stringify({
  c: { host: "blue.openfront.io", color: "blue", numWorkers: 20 },
  d: { host: "green.openfront.io", color: "green", numWorkers: 20 },
});

describe("deploy.sh game host", () => {
  it("resolves a machine-scoped entry and qualifies the container name", () => {
    const r = resolve({
      env: "staging",
      machine: "staging2",
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      clusterJson: DEV_FLEET,
    });
    expect(r.gameHost).toBe("blue.staging2.server.openfront.dev");
    expect(r.deploymentName).toBe("staging2-blue");
    // A fleet member's page is the apex.
    expect(r.siteHost).toBe("openfront.dev");
    expect(Object.keys(r.cluster)).toEqual(["a", "b", "f", "g"]);
  });

  // The same slot on the other "machine" must land on its own entry and its
  // own container, or the two would swap each other out on the shared box.
  it("keeps the two machines' blue apart", () => {
    const r = resolve({
      env: "staging",
      machine: "staging",
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      clusterJson: DEV_FLEET,
    });
    expect(r.gameHost).toBe("blue.staging.server.openfront.dev");
    expect(r.deploymentName).toBe("staging-blue");
  });

  it("falls back to the standalone shape for a host outside the map", () => {
    const r = resolve({
      env: "staging",
      machine: "staging",
      subdomain: "main",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      clusterJson: DEV_FLEET,
    });
    expect(r.gameHost).toBe("main.server.openfront.dev");
    expect(r.deploymentName).toBe("main");
    // A standalone deployment under GAME_DOMAIN pages at its own name.
    expect(r.siteHost).toBe("main.openfront.dev");
    // The shared map is ignored: a synthesized single-entry map instead.
    expect(r.cluster).toEqual({
      a: { host: "main.server.openfront.dev", color: "blue", numWorkers: 2 },
    });
  });

  // Prod is unchanged by all of this: no GAME_DOMAIN, no machine in the
  // host, the bare subdomain as the container name.
  it("resolves today's prod entry by the bare subdomain", () => {
    const r = resolve({
      env: "prod",
      machine: "falk2",
      subdomain: "blue",
      domain: "openfront.io",
      clusterJson: PROD,
      expectedColor: "blue",
    });
    expect(r.gameHost).toBe("blue.openfront.io");
    expect(r.deploymentName).toBe("blue");
    expect(r.siteHost).toBe("openfront.io");
  });

  it("prefers the machine-scoped entry when both shapes are present", () => {
    const both = JSON.stringify({
      a: { host: "blue.server.openfront.dev", color: "blue", numWorkers: 2 },
      f: {
        host: "blue.staging.server.openfront.dev",
        color: "blue",
        numWorkers: 2,
      },
    });
    const r = resolve({
      env: "staging",
      machine: "staging",
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      clusterJson: both,
    });
    expect(r.gameHost).toBe("blue.staging.server.openfront.dev");
    expect(r.deploymentName).toBe("staging-blue");
  });

  it("refuses a prod host the map does not name, naming both shapes tried", () => {
    const out = failure({
      env: "prod",
      machine: "nbg2",
      subdomain: "beta",
      domain: "openfront.io",
      clusterJson: PROD,
    });
    expect(out).toContain("beta.nbg2.openfront.io");
    expect(out).toContain("beta.openfront.io");
  });

  it("refuses to roll a colour onto the other colour's machine-scoped host", () => {
    const out = failure({
      env: "staging",
      machine: "staging2",
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      clusterJson: DEV_FLEET,
      expectedColor: "green",
    });
    expect(out).toContain("not with color 'green'");
  });
});
