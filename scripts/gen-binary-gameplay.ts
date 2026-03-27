import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeGeneratedBinaryGameplayFile } from "../src/core/protocol/BinaryGenerator";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(
  currentDir,
  "../src/core/__generated__/binary/generated.ts",
);

const changed = await writeGeneratedBinaryGameplayFile(outputPath);
console.log(
  changed
    ? `Generated binary gameplay manifest at ${outputPath}`
    : `Binary gameplay manifest already up to date at ${outputPath}`,
);
