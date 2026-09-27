import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../update.sh");

const BEGIN = "# --- BEGIN traefik host rule (tested) ---";
const END = "# --- END traefik host rule (tested) ---";

// Same trick as UpdateRestartPolicy.test.ts: update.sh as a whole talks to
// docker and cannot run here, but the Traefik host rule is pure -- three
// strings in, one string out -- so lift exactly that block out of the shipped
// file and run it. Reading the real script rather than restating its logic is
// the point: a copy of the condition in this file would keep passing after
// someone edited update.sh, which is the only failure this test exists to
// catch. A wrong rule here is a deployment nothing can reach.
function extractRuleBlock(): string {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the traefik host rule markers in ${SCRIPT}. If the ` +
        `block moved or was renamed, update the markers here and there ` +
        `together.`,
    );
  }
  return source.slice(start + BEGIN.length, end);
}

// gameDomain undefined models the variable being absent from the env file
// entirely; "" models GitHub delivering an unset repository variable, which
// is what deploy.sh writes through on every prod deploy. gameHost is the
// name deploy.sh resolved from the cluster map; undefined models an env file
// written by hand, which the rule derives from the other three.
function hostRuleFor(
  subdomain: string,
  domain: string,
  gameDomain?: string,
  gameHost?: string,
): string {
  const assignment =
    (gameDomain === undefined ? "" : `GAME_DOMAIN='${gameDomain}'\n`) +
    (gameHost === undefined ? "" : `GAME_HOST='${gameHost}'\n`);
  const script =
    `SUBDOMAIN='${subdomain}'\nDOMAIN='${domain}'\n${assignment}` +
    `${extractRuleBlock()}\nprintf '%s' "$TRAEFIK_HOST_RULE"\n`;
  return execFileSync("bash", ["-c", script], { encoding: "utf8" });
}

describe("update.sh traefik host rule", () => {
  // The whole of OPE-451 is dormant until GAME_DOMAIN is set, and this rule is
  // the one place a regression would be invisible in code review and total in
  // production: every deployment on the domain would stop matching.
  it("emits a single Host() when GAME_DOMAIN is absent", () => {
    expect(hostRuleFor("main", "openfront.dev")).toBe(
      "Host(`main.openfront.dev`)",
    );
  });

  it("treats an empty GAME_DOMAIN exactly like an absent one", () => {
    expect(hostRuleFor("blue", "openfront.io", "")).toBe(
      "Host(`blue.openfront.io`)",
    );
  });

  // Both names during the transition: the game host is where cluster entries
  // point sockets and /api, and the page host keeps working until the static
  // Worker is actually routed there.
  it("matches the page host and the game host when GAME_DOMAIN is set", () => {
    expect(hostRuleFor("main", "openfront.dev", "server.openfront.dev")).toBe(
      "Host(`main.openfront.dev`) || Host(`main.server.openfront.dev`)",
    );
  });

  // deploy.sh writes the resolved host through; for a standalone deployment
  // it is exactly what the rule would derive, so the rule must not change.
  it("accepts the standalone game host deploy.sh resolved", () => {
    expect(
      hostRuleFor(
        "main",
        "openfront.dev",
        "server.openfront.dev",
        "main.server.openfront.dev",
      ),
    ).toBe("Host(`main.openfront.dev`) || Host(`main.server.openfront.dev`)");
  });

  // A machine-scoped host has no page host of its own -- its page is the
  // apex -- and the bare page name would be claimed by every machine's blue
  // at once, so it gets the one name.
  it("matches only the game host when it is machine-scoped", () => {
    expect(
      hostRuleFor(
        "blue",
        "openfront.dev",
        "server.openfront.dev",
        "blue.staging2.server.openfront.dev",
      ),
    ).toBe("Host(`blue.staging2.server.openfront.dev`)");
  });

  // Traefik's matcher syntax: the names must be backticked, or the rule is a
  // parse error and the router never comes up.
  it("backticks every host name", () => {
    const rule = hostRuleFor("main", "openfront.dev", "server.openfront.dev");
    expect(rule.match(/`/g)).toHaveLength(4);
    expect(rule).not.toContain('"');
  });
});
