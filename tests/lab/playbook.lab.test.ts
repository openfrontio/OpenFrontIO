// vitest entry for the playbook lab; the harness itself is tests/lab/playbook.lab.ts (also run bare by
// `node --import tsx tests/lab/playbook.lab.ts`). Always scope the filter: `npx vitest --dir tests tests/lab/playbook.lab.test.ts --run` —
// a bare path filter also matches copies of this file in .claude/worktrees/ and plays one game per copy.
import { runLab } from "./playbook.lab";

describe("playbook lab", () => {
  test("baseline on World vs Hard nations", async () => {
    await runLab();
  }, 1800000);
});
