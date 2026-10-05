import { z } from "zod";
import {
  readVersioned,
  SnapshotError,
  snapshotType,
} from "../../../src/core/snapshot/SnapshotType";

// A record type as it would look after two layout changes.
const Widget = snapshotType({
  name: "Widget",
  version: 3,
  schema: z.object({
    size: z.number(),
    color: z.string(),
    tags: z.array(z.string()),
  }),
  migrations: {
    // v1 stored `width`; v2 renamed it.
    1: (d: { width: number }) => ({ size: d.width }),
    // v3 added color and tags; old widgets were all red and untagged.
    2: (d: { size: number }) => ({ ...d, color: "red", tags: [] }),
  },
});

describe("snapshot record versioning", () => {
  test("migrates old records step by step to the current version", () => {
    expect(readVersioned(Widget, { v: 1, d: { width: 4 } })).toEqual({
      size: 4,
      color: "red",
      tags: [],
    });
    expect(readVersioned(Widget, { v: 2, d: { size: 5 } })).toEqual({
      size: 5,
      color: "red",
      tags: [],
    });
  });

  test("reads current records as is", () => {
    const d = { size: 1, color: "blue", tags: ["a"] };
    expect(readVersioned(Widget, { v: 3, d })).toEqual(d);
  });

  test("rejects records from a newer build", () => {
    expect(() => readVersioned(Widget, { v: 4, d: {} })).toThrow(SnapshotError);
  });

  test("rejects migrated data that does not fit the schema", () => {
    expect(() => readVersioned(Widget, { v: 3, d: { size: "x" } })).toThrow(
      /invalid data/,
    );
  });

  test("a type cannot skip a migration", () => {
    expect(() =>
      snapshotType({
        name: "Broken",
        version: 3,
        schema: z.object({}),
        migrations: { 1: (d) => d },
      }),
    ).toThrow(/no migration from version 2/);
  });
});
