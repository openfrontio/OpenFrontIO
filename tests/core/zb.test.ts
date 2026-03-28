import { describe, expect, it } from "vitest";
import { UpdateGameConfigIntentSchema } from "../../src/core/Schemas";
import {
  getBinaryFieldHelper,
  getBinaryGameplayMessageMeta,
  isBinaryOmittedSchema,
  isJsonOnlyIntentSchema,
} from "../../src/core/protocol/BinaryWire";
import { zb } from "../../src/core/protocol/zb";

describe("zb", () => {
  it("preserves playerRef metadata through nullability", () => {
    expect(getBinaryFieldHelper(zb.playerRef().nullable().schema())).toEqual({
      kind: "playerRef",
      inlineFallback: true,
    });
  });

  it("preserves numeric metadata through optional chaining", () => {
    expect(getBinaryFieldHelper(zb.u32().optional().schema())).toEqual({
      kind: "number",
      wireType: "u32",
    });
  });

  it("preserves integer metadata through max refinements", () => {
    expect(getBinaryFieldHelper(zb.u16().max(5).schema())).toEqual({
      kind: "number",
      wireType: "u16",
    });
  });

  it("produces explicit f64 metadata through refinements and nullability", () => {
    expect(
      getBinaryFieldHelper(zb.f64().nonnegative().nullable().schema()),
    ).toEqual({
      kind: "number",
      wireType: "f64",
    });
  });

  it("marks omitted fields without changing semantic parsing", () => {
    const schema = zb.binaryOmit(zb.i32().nullable().optional().schema());

    expect(getBinaryFieldHelper(schema)).toEqual(
      expect.objectContaining({
        kind: "number",
        wireType: "i32",
      }),
    );
    expect(isBinaryOmittedSchema(schema)).toBe(true);
    expect(schema.parse(123)).toBe(123);
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("registers jsonOnly intent exclusions through the helper", () => {
    expect(isJsonOnlyIntentSchema(UpdateGameConfigIntentSchema)).toBe(true);
  });

  it("registers top-level binary gameplay message metadata through the helper", () => {
    const schema = zb.binaryGameplayMessage(
      zb.object({
        type: zb.literal("ping"),
      }),
    );

    expect(getBinaryGameplayMessageMeta(schema)).toEqual({
      kind: "message",
    });
  });

  it("registers clientIndex projections through the helper", () => {
    expect(getBinaryFieldHelper(zb.clientIndexRef().schema())).toEqual({
      kind: "clientIndex",
    });
  });
});
