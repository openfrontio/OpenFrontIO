import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../generate-nginx-upstream.sh");

// Run the script with the given NUM_WORKERS (undefined = unset) and return the
// generated config text.
function generate(numWorkers?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nginx-upstream-"));
  const out = path.join(dir, "00-workers.conf");
  const env = { ...process.env };
  if (numWorkers === undefined) {
    delete env.NUM_WORKERS;
  } else {
    env.NUM_WORKERS = numWorkers;
  }
  try {
    execFileSync("sh", [SCRIPT, out], { env });
    return fs.readFileSync(out, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("generate-nginx-upstream.sh", () => {
  it("generates the upstream + worker port map for NUM_WORKERS=3", () => {
    expect(generate("3")).toBe(
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

  it("defaults to a single worker when NUM_WORKERS is unset", () => {
    expect(generate(undefined)).toBe(
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
});
