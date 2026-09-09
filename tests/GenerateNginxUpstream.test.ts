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
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nginx-upstream-"));
  const out = path.join(dir, "00-workers.conf");
  const childEnv = { ...process.env };
  delete childEnv.CLUSTER_JSON;
  delete childEnv.SUBDOMAIN;
  delete childEnv.DOMAIN;
  if (env.clusterJson !== undefined) childEnv.CLUSTER_JSON = env.clusterJson;
  if (env.subdomain !== undefined) childEnv.SUBDOMAIN = env.subdomain;
  if (env.domain !== undefined) childEnv.DOMAIN = env.domain;
  try {
    execFileSync("sh", [SCRIPT, out], { env: childEnv, stdio: "pipe" });
    return fs.readFileSync(out, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", colour: "blue", numWorkers: 3 },
  b: { host: "green.openfront.io", colour: "green", numWorkers: 1 },
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
        a: { host: "openfront.example", colour: "blue", numWorkers: 2 },
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
