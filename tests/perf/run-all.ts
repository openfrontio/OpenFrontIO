import { globSync } from "glob";
import { execSync } from "child_process";

const files = globSync("tests/perf/*.ts").filter(f => !f.includes("run-all"));
for (const file of files) {
  console.log(`\nRunning ${file}...`);
  execSync(`tsx ${file}`, { stdio: "inherit" });
}