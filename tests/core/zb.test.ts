import { describe, expect, it } from "vitest";
import { UpdateGameConfigIntentSchema } from "../../src/core/Schemas";
import {
  getBinaryFieldHelper,
  isJsonOnlyIntentSchema,
} from "../../src/core/protocol/BinaryWire";
import { zb } from "../../src/core/protocol/zb";

describe("zb", () => {
  it("preserves playerRef metadata through nullability", () => {
    expect(getBinaryFieldHelper(zb.playerRef().nullable())).toEqual({
      kind: "playerRef",
      inlineFallback: true,
    });
  });

  it("preserves numeric metadata through optional chaining", () => {
    expect(getBinaryFieldHelper(zb.u32().optional())).toEqual({
      kind: "number",
      wireType: "u32",
    });
  });

  it("preserves integer metadata through max refinements", () => {
    expect(getBinaryFieldHelper(zb.u16().max(5))).toEqual({
      kind: "number",
      wireType: "u16",
    });
  });

  it("produces explicit f64 metadata through refinements and nullability", () => {
    expect(getBinaryFieldHelper(zb.f64().nonnegative().nullable())).toEqual({
      kind: "number",
      wireType: "f64",
    });
  });

  it("marks omitted fields without changing semantic parsing", () => {
    const schema = zb.i32().nullable().optional().binaryOmit();

    expect(getBinaryFieldHelper(schema)).toEqual(
      expect.objectContaining({
        kind: "omit",
      }),
    );
    expect(schema.parse(123)).toBe(123);
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("registers jsonOnly intents from terminal decorators", () => {
    expect(isJsonOnlyIntentSchema(UpdateGameConfigIntentSchema)).toBe(true);
  });
});
