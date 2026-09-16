import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../generate-nginx-upstream.sh");

// Run the script with the given cluster env (undefined = unset) and return
// the generated config text.
function generate(env: {
  clusterJson?: string;
  subdomain?: string;
  domain?: string;
  gameDomain?: string;
  gameHost?: string;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nginx-upstream-"));
  const out = path.join(dir, "00-workers.conf");
  const childEnv = { ...process.env };
  delete childEnv.CLUSTER_JSON;
  delete childEnv.SUBDOMAIN;
  delete childEnv.DOMAIN;
  delete childEnv.GAME_DOMAIN;
  delete childEnv.GAME_HOST;
  if (env.clusterJson !== undefined) childEnv.CLUSTER_JSON = env.clusterJson;
  if (env.subdomain !== undefined) childEnv.SUBDOMAIN = env.subdomain;
  if (env.domain !== undefined) childEnv.DOMAIN = env.domain;
  if (env.gameDomain !== undefined) childEnv.GAME_DOMAIN = env.gameDomain;
  if (env.gameHost !== undefined) childEnv.GAME_HOST = env.gameHost;
  try {
    execFileSync("sh", [SCRIPT, out], { env: childEnv, stdio: "pipe" });
    return fs.readFileSync(out, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", color: "blue", numWorkers: 3 },
  b: { host: "green.openfront.io", color: "green", numWorkers: 1 },
});

describe("generate-nginx-upstream.sh", () => {
  it("generates the upstream + worker port map from the own cluster entry", () => {
    expect(
      generate({
        clusterJson: CLUSTER,
        subdomain: "blue",
        domain: "openfront.io",
      }),
    ).toBe(
      `upstream openfront_workers {
    random;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

map $worker $worker_port {
    default 3001;
    0 3001;
    1 3002;
    2 3003;
}
`,
    );
  });

  it("matches by bare DOMAIN when SUBDOMAIN is empty", () => {
    const conf = generate({
      clusterJson: JSON.stringify({
        a: { host: "openfront.example", color: "blue", numWorkers: 2 },
      }),
      domain: "openfront.example",
    });
    expect(conf).toContain("server 127.0.0.1:3002;");
    expect(conf).not.toContain("server 127.0.0.1:3003;");
  });

  it("defaults to a single worker when CLUSTER_JSON is unset", () => {
    expect(generate({})).toBe(
      `upstream openfront_workers {
    random;
    server 127.0.0.1:3001;
}

map $worker $worker_port {
    default 3001;
    0 3001;
}
`,
    );
  });

  // The self-match must agree with ServerEnv.publicHost: with GAME_DOMAIN set
  // this container's entry is keyed by the GAME host, <subdomain>.<GAME_DOMAIN>
  // (docs/MultiServer.md, "Two hostnames per deployment"). #5397 changed the
  // node side and deploy.sh but not this script, so the first dev deploy with
  // the variable set found no entry, wrote no workers conf, and nginx refused
  // to start on the missing upstream -- "connection refused" for the whole
  // container. The map below deliberately carries the page host under another
  // letter so a match on the wrong name is a wrong worker count, not a pass.
  const DEV = JSON.stringify({
    a: { host: "main.server.openfront.dev", color: "blue", numWorkers: 3 },
    b: { host: "main.openfront.dev", color: "blue", numWorkers: 1 },
  });

  it("matches by the game host when GAME_DOMAIN is set", () => {
    const conf = generate({
      clusterJson: DEV,
      subdomain: "main",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
    });
    expect(conf).toContain("server 127.0.0.1:3003;");
  });

  it("matches by the page host when GAME_DOMAIN is empty", () => {
    // deploy.sh writes GAME_DOMAIN= into every env file, set or not.
    const conf = generate({
      clusterJson: DEV,
      subdomain: "main",
      domain: "openfront.dev",
      gameDomain: "",
    });
    expect(conf).toContain("server 127.0.0.1:3001;");
    expect(conf).not.toContain("server 127.0.0.1:3002;");
  });

  // A machine-scoped entry (blue.staging2.server.openfront.dev) is not
  // derivable from SUBDOMAIN and GAME_DOMAIN: deploy.sh resolved it from the
  // map and wrote it through as GAME_HOST, and this self-match must take
  // that over its own derivation, exactly as ServerEnv.publicHost does. The
  // derived name sits in the map under another letter so a wrong match is a
  // wrong worker count, not a pass.
  it("matches by GAME_HOST when deploy.sh resolved one", () => {
    const conf = generate({
      clusterJson: JSON.stringify({
        a: { host: "blue.server.openfront.dev", color: "blue", numWorkers: 1 },
        f: {
          host: "blue.staging2.server.openfront.dev",
          color: "blue",
          numWorkers: 2,
        },
      }),
      subdomain: "blue",
      domain: "openfront.dev",
      gameDomain: "server.openfront.dev",
      gameHost: "blue.staging2.server.openfront.dev",
    });
    expect(conf).toContain("server 127.0.0.1:3002;");
    expect(conf).not.toContain("server 127.0.0.1:3003;");
  });

  it("fails loudly when the host has no cluster entry", () => {
    expect(() =>
      generate({
        clusterJson: CLUSTER,
        subdomain: "red",
        domain: "openfront.io",
      }),
    ).toThrow(/no entry in CLUSTER_JSON/);
  });
});
