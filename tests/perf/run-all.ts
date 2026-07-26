import { execSync } from "child_process";
import { globSync } from "fs";
import path from "path";

// "perf": "npx tsx tests/perf/*.ts" doesn't work on Windows
const files = globSync("tests/perf/*.ts");
for (const file of files.filter((f) => !f.includes("run-all"))) {
  console.log(`\nRunning ${path.basename(file)}...`);
  execSync(`tsx "${path.normalize(file)}"`, { stdio: "inherit" });
}
