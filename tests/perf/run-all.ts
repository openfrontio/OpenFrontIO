import { execSync } from "child_process";
import { globSync } from "glob";

// "perf": "npx tsx tests/perf/*.ts" doesn't work on Windows
const files = globSync("tests/perf/*.ts").filter((f) => !f.includes("run-all"));
for (const file of files) {
  console.log(`\nRunning ${file}...`);
  execSync(`tsx "${file}"`, { stdio: "inherit" });
}
