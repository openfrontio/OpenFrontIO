// Builds the desktop (Steam) release descriptor at DEPLOY time and writes it to
// stdout, so update.sh can upload it alongside the version's page as
// sites/<site>/v/<short>/desktop/release.json (and version.json with
// --version-pointer).
//
// Today the game server builds this per request from its own static/ directory
// (src/server/Master.ts, /desktop/*.json). Uploading it per version is what
// lets the static Worker answer /desktop/*.json for a site without any game
// server being reachable, and what makes a rollback a pointer flip rather than
// a redeploy. Same buildDescriptor, same inputs, same env vars as the server —
// this is the identical descriptor, computed one deploy earlier.
//
// Run inside the freshly built image with the live container's env file, the
// same way RenderStaticIndex.ts is:
//
//   npx tsx src/server/RenderDesktopDescriptor.ts
//   npx tsx src/server/RenderDesktopDescriptor.ts --version-pointer
//
// clientVersion is GIT_COMMIT (the full sha baked into the image) rather than
// static/commit.txt, so it is the value the server would report for itself.
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSION_POINTER = "--version-pointer";

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== VERSION_POINTER);
if (unknown.length > 0) {
  console.error(
    `Unknown argument(s): ${unknown.join(" ")}. Usage: RenderDesktopDescriptor.ts [${VERSION_POINTER}]`,
  );
  process.exit(2);
}
const pointerOnly = args.includes(VERSION_POINTER);

// stdout is this program's DATA channel: whatever lands there is uploaded
// verbatim as release.json. Several things on the import path below write to
// it as if it were a log — dotenv's "injected env" banner and Logger.ts's OTEL
// line at module evaluation, and winston's Console transport (which defaults to
// stdout for every level) if buildDescriptor warns about an empty cdnBase. Any
// one of them prefixes the JSON with prose and publishes a descriptor no Steam
// client can parse.
//
// So: send everything that thinks it is logging to stderr, and keep the real
// stdout for the payload. This has to happen before DesktopRelease is loaded,
// which is why that import is dynamic — a static one would be hoisted above
// these statements, and prettier-plugin-organize-imports would reorder it
// anyway.
const writeOut = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(
  process.stderr,
) as typeof process.stdout.write;

const [{ GameEnv }, { buildDescriptor }, { ServerEnv }] = await Promise.all([
  import("../core/configuration/Config"),
  import("./DesktopRelease"),
  import("./ServerEnv"),
]);

try {
  const descriptor = await buildDescriptor(
    path.join(__dirname, "../../static"),
    {
      clientVersion: ServerEnv.gitCommit(),
      cdnBase: ServerEnv.cdnBase(),
      // Same rule as Master.ts's descriptorOpts: production must have a CDN, or
      // the descriptor would send every Steam client to the app server for
      // ~570MB of assets. Failing here fails the DEPLOY, which is the point.
      requireCdnBase: ServerEnv.env() === GameEnv.Prod,
    },
  );
  const out = pointerOnly
    ? {
        clientVersion: descriptor.clientVersion,
        coreVersion: descriptor.coreVersion,
      }
    : descriptor;
  writeOut(JSON.stringify(out));
} catch (error) {
  console.error("Failed to build desktop release descriptor:", error);
  process.exit(1);
}
