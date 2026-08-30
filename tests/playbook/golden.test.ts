// Golden test: the bot on `plains` against two real nations (NationExecution, Medium) for 600 ticks with a fixed
// seed. The simulation is deterministic, so the bot's log plus its tiles / troops / gold at ticks 100, 300 and
// 600 hash to one constant. A pure refactor of the bot must leave GOLDEN unchanged; a behaviour change updates it
// in the same PR and says why (docs/PlaybookBotPlan.md, ground rule 3).
//
// Regenerate:   GOLDEN=1 npx vitest tests/playbook/golden.test.ts --run
// The run prints the new hash and the snapshot behind it to stderr and passes; paste the hash into GOLDEN below.
import { createHash } from "crypto";
import { describe, expect, test } from "vitest";
import { PlayerType } from "../../src/core/game/Game";
import { playbookSetup } from "../util/PlaybookSetup";

const GOLDEN =
  "65b44be062ae25c07fbe10c0bbda7d4118cfd1f07e8291cf38bbf8265d4fa36e";
const SNAPSHOT_TICKS = [100, 300, 600];

describe("golden", () => {
  test("bot log and state on plains vs two nations, 600 ticks", async () => {
    const h = await playbookSetup({
      spawn: [50, 50],
      rivals: [
        { name: "North", type: PlayerType.Nation, at: [22, 22], ai: true },
        { name: "South", type: PlayerType.Nation, at: [78, 78], ai: true },
      ],
    });
    for (const r of h.rivals) expect(r.numTilesOwned()).toBeGreaterThan(0);
    const snaps: string[] = [];
    for (const t of SNAPSHOT_TICKS) {
      h.step(t - h.game.ticks());
      snaps.push(
        `t${t} tiles=${h.me.numTilesOwned()} troops=${Math.round(h.me.troops())} gold=${h.me.gold()}`,
      );
    }
    const material = [...h.log, ...snaps].join("\n");
    const hash = createHash("sha256").update(material).digest("hex");
    if (process.env.GOLDEN === "1") {
      process.stderr.write(`\n${material}\n\nGOLDEN = "${hash}"\n`);
      return;
    }
    expect(h.log.length).toBeGreaterThan(0);
    expect(hash).toBe(GOLDEN);
  });
});
