// Renders the app shell exactly as the running server would - same env, same
// asset manifest, same EJS template - and writes it to stdout. update.sh runs
// this inside the freshly built image at deploy time and uploads the result to
// the CDN as index-<short-commit>.html, so games archived from this build stay
// replayable after the deployment itself is gone (#4934).
import path from "path";
import { fileURLToPath } from "url";
import { renderHtmlContent } from "./RenderHtml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

renderHtmlContent(path.join(__dirname, "../../static/index.html")).then(
  (html) => process.stdout.write(html),
  (error: unknown) => {
    console.error("Failed to render static index:", error);
    process.exit(1);
  },
);
