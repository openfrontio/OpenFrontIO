// Renders the app shell exactly as the running server would - same env, same
// asset manifest, same EJS template - and writes it to stdout. update.sh runs
// this inside the freshly built image at deploy time and uploads the result to
// the CDN as index-<short-commit>.html, so games archived from this build stay
// replayable after the deployment itself is gone (#4934).
//
// With --environment-only it renders the same template WITHOUT the per-server
// locals (cluster, instanceLetter, instanceId, serverHost, siteHost). That
// page describes a build and an environment, not a server, so one copy can be
// uploaded per version as sites/<site>/v/<short>/index.html and served to
// every player on that version by the static Worker; the client asks the API
// for the server list instead (docs/MultiServer.md, "Server list v2").
//
// The default is deliberately unchanged: the legacy index-<short>.html replay
// shell still needs the server values, because today's client throws without a
// worker-count source (fixed by OPE-431, not before).
import path from "path";
import { fileURLToPath } from "url";
import { renderHtmlContent } from "./RenderHtml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENVIRONMENT_ONLY = "--environment-only";

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== ENVIRONMENT_ONLY);
if (unknown.length > 0) {
  console.error(
    `Unknown argument(s): ${unknown.join(" ")}. Usage: RenderStaticIndex.ts [${ENVIRONMENT_ONLY}]`,
  );
  process.exit(2);
}
const perServer = !args.includes(ENVIRONMENT_ONLY);

renderHtmlContent(path.join(__dirname, "../../static/index.html"), {
  perServer,
}).then(
  (html) => process.stdout.write(html),
  (error: unknown) => {
    console.error("Failed to render static index:", error);
    process.exit(1);
  },
);
