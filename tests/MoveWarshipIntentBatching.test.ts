import {
  batchMoveWarshipUnitIds,
  ClientIntentMessage,
  ClientMessageSchema,
  MAX_INTENT_SIZE,
} from "../src/core/Schemas";
import { replacer } from "../src/core/Util";

const TILE = 250_000;

function frame(unitIds: number[], tile: number): string {
  return JSON.stringify(
    {
      type: "intent",
      intent: { type: "move_warship", unitIds, tile },
    } satisfies ClientIntentMessage,
    replacer,
  );
}

describe("batchMoveWarshipUnitIds", () => {
  test("sends a small fleet as a single intent", () => {
    const unitIds = [10000, 10003, 10006];
    expect(batchMoveWarshipUnitIds(unitIds, TILE)).toEqual([unitIds]);
  });

  test("returns no batches for an empty selection", () => {
    expect(batchMoveWarshipUnitIds([], TILE)).toEqual([]);
  });

  test.each([1, 400, 4000])(
    "keeps every batch under the server cap (%i warships)",
    (count) => {
      const unitIds = Array.from({ length: count }, (_, i) => 900_000 + i * 3);
      const batches = batchMoveWarshipUnitIds(unitIds, TILE);

      for (const batch of batches) {
        expect(batch.length).toBeGreaterThan(0);
        expect(
          Buffer.byteLength(frame(batch, TILE), "utf8"),
        ).toBeLessThanOrEqual(MAX_INTENT_SIZE);
      }
      expect(batches.flat()).toEqual(unitIds);
    },
  );

  test("every batch is a valid client intent message", () => {
    const unitIds = Array.from({ length: 450 }, (_, i) => 10_000 + i * 3);

    for (const batch of batchMoveWarshipUnitIds(unitIds, TILE)) {
      expect(
        ClientMessageSchema.safeParse(JSON.parse(frame(batch, TILE))).success,
      ).toBe(true);
    }
  });
});
