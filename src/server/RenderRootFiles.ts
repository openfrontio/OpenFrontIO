// Writes the root-files index for this image's static/ to stdout, so update.sh
// can upload it as sites/<site>/v/<short>/root-files.json. See
// buildRootFilesIndex.
//
//   npx tsx src/server/RenderRootFiles.ts
import path from "path";
import { fileURLToPath } from "url";
import { buildRootFilesIndex } from "./PublicAssetManifest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.stdout.write(
  JSON.stringify(buildRootFilesIndex(path.join(__dirname, "../../static"))),
);
