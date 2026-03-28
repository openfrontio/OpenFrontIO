import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BINARY_INTENT_DEFINITIONS,
  BINARY_MESSAGE_DEFINITIONS,
  hasBinaryIntentOpcode,
} from "../../src/core/__generated__/binary/generated";
import { collectGeneratedBinaryModel } from "../../src/core/protocol/BinaryGenerator";
import {
  getBinaryGameplayMessageSchemas,
  isJsonOnlyIntentSchema,
} from "../../src/core/protocol/BinaryWire";
import { AllIntentSchema } from "../../src/core/Schemas";

function getLiteralValue(
  schema: z.ZodLiteral<any>,
): string | number | undefined {
  const directValues = (schema as any).values;
  if (Array.isArray(directValues)) {
    return directValues[0];
  }
  const defValues = (schema as any)._def?.values;
  if (Array.isArray(defValues)) {
    return defValues[0];
  }
  if (defValues instanceof Set) {
    return [...defValues][0];
  }
  return (schema as any)._def?.value;
}

function getObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(
      `Expected object schema, received ${schema.constructor.name}`,
    );
  }
  const shape = (schema as any).shape;
  if (!shape || typeof shape !== "object") {
    throw new Error(
      `Unable to read object shape from ${schema.constructor.name}`,
    );
  }
  return shape;
}

function getDiscriminantLiteral(schema: z.ZodTypeAny): string {
  const typeField = getObjectShape(schema).type;
  if (!(typeField instanceof z.ZodLiteral)) {
    throw new Error(
      `Expected literal type field on ${schema.constructor.name}`,
    );
  }
  const literalValue = getLiteralValue(typeField);
  if (typeof literalValue !== "string") {
    throw new Error("Expected string literal discriminant");
  }
  return literalValue;
}

function getDiscriminatedUnionOptions(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  const options = (schema as any).options ?? (schema as any)._def?.options;
  if (Array.isArray(options)) {
    return options;
  }
  if (options instanceof Map) {
    return [...options.values()];
  }
  throw new Error("Unable to inspect discriminated union options");
}

describe("BinaryGenerator", () => {
  it("derives intent opcodes from AllIntentSchema order while excluding json-only intents", () => {
    const expectedTypes = getDiscriminatedUnionOptions(AllIntentSchema)
      .filter((schema) => !isJsonOnlyIntentSchema(schema))
      .map(getDiscriminantLiteral);

    expect(
      BINARY_INTENT_DEFINITIONS.map((definition) => definition.type),
    ).toEqual(expectedTypes);
    expect(
      BINARY_INTENT_DEFINITIONS.map((definition) => definition.opcode),
    ).toEqual(expectedTypes.map((_, index) => index + 1));
    expect(hasBinaryIntentOpcode("update_game_config")).toBe(false);
  });

  it("derives gameplay message ids from schema registration order", () => {
    const expectedTypes = getBinaryGameplayMessageSchemas().map(
      getDiscriminantLiteral,
    );

    expect(
      BINARY_MESSAGE_DEFINITIONS.map((definition) => definition.type),
    ).toEqual(expectedTypes);
    expect(
      BINARY_MESSAGE_DEFINITIONS.map((definition) => definition.messageType),
    ).toEqual(expectedTypes.map((_, index) => index + 1));
  });

  it("keeps the generated manifest in sync with the live generator model", () => {
    const model = collectGeneratedBinaryModel();

    expect(model.intentDefinitions).toEqual(BINARY_INTENT_DEFINITIONS);
    expect(model.messageDefinitions).toEqual(BINARY_MESSAGE_DEFINITIONS);
  });

  it("encodes allianceExtension recipients as player refs", () => {
    const definition = BINARY_INTENT_DEFINITIONS.find(
      (candidate) => candidate.type === "allianceExtension",
    );

    expect(definition).toBeDefined();
    expect(definition?.fields).toEqual([
      expect.objectContaining({
        name: "recipient",
        wireType: "playerRef",
        inlineFallback: true,
      }),
    ]);
  });
});
