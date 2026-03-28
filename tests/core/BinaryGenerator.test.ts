import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BINARY_INTENT_DEFINITIONS,
  BINARY_MESSAGE_DEFINITIONS,
  hasBinaryIntentOpcode,
} from "../../src/core/__generated__/binary/generated";
import { collectGeneratedBinaryModel } from "../../src/core/protocol/BinaryGenerator";
import {
  binaryGameplayMessageRegistry,
  getBinaryGameplayMessageMeta,
  isJsonOnlyIntentSchema,
} from "../../src/core/protocol/BinaryWire";
import {
  AllIntentSchema,
  ClientMessageSchema,
  ServerMessageSchema,
  ServerPingMessageSchema,
} from "../../src/core/Schemas";

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
  function getExpectedBinaryGameplayMessages() {
    return [
      ...getDiscriminatedUnionOptions(ServerMessageSchema)
        .filter((schema) => getBinaryGameplayMessageMeta(schema) !== undefined)
        .map((schema) => {
          return {
            type: getDiscriminantLiteral(schema),
            direction: "server" as const,
          };
        }),
      ...getDiscriminatedUnionOptions(ClientMessageSchema)
        .filter((schema) => getBinaryGameplayMessageMeta(schema) !== undefined)
        .map((schema) => {
          return {
            type: getDiscriminantLiteral(schema),
            direction: "client" as const,
          };
        }),
    ];
  }

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

  it("derives gameplay message ids from the annotated top-level gameplay variants", () => {
    const expectedTypes = getExpectedBinaryGameplayMessages().map(
      (message) => message.type,
    );
    expect(
      BINARY_MESSAGE_DEFINITIONS.map((definition) => definition.type),
    ).toEqual(expectedTypes);
    expect(
      BINARY_MESSAGE_DEFINITIONS.map((definition) => definition.messageType),
    ).toEqual(expectedTypes.map((_, index) => index + 1));
  });

  it("keeps binary gameplay message discovery in sync with the annotated top-level gameplay variants", () => {
    expect(
      BINARY_MESSAGE_DEFINITIONS.map((definition) => ({
        type: definition.type,
        direction: definition.direction,
      })),
    ).toEqual(getExpectedBinaryGameplayMessages());
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
    expect(definition?.payload).toEqual(
      expect.objectContaining({
        kind: "object",
        fields: [
          expect.objectContaining({
            name: "recipient",
            value: expect.objectContaining({
              kind: "projectedScalar",
              wireType: "playerRef",
              inlineFallback: true,
            }),
          }),
        ],
      }),
    );
  });

  it("rejects duplicate annotated binary message types across top-level unions", () => {
    binaryGameplayMessageRegistry.add(ServerPingMessageSchema, {
      kind: "message",
    });

    try {
      expect(() => collectGeneratedBinaryModel()).toThrow(
        /Duplicate binary message type ping/,
      );
    } finally {
      binaryGameplayMessageRegistry.remove(ServerPingMessageSchema);
    }
  });

  it("rejects orphan top-level binary message metadata", () => {
    const orphanSchema = z.object({
      type: z.literal("orphan"),
    });

    binaryGameplayMessageRegistry.add(orphanSchema, {
      kind: "message",
    });

    try {
      expect(() => collectGeneratedBinaryModel()).toThrow(
        /unreachable schema orphan/,
      );
    } finally {
      binaryGameplayMessageRegistry.remove(orphanSchema);
    }
  });

  it("compiles turn payloads through recursive arrays and projected client indexes", () => {
    const turnDefinition = BINARY_MESSAGE_DEFINITIONS.find(
      (definition) => definition.type === "turn",
    );

    expect(turnDefinition?.payload).toEqual(
      expect.objectContaining({
        kind: "object",
        fields: [
          expect.objectContaining({
            name: "turn",
            value: expect.objectContaining({
              kind: "object",
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "intents",
                  value: expect.objectContaining({
                    kind: "array",
                    element: expect.objectContaining({
                      kind: "discriminatedUnion",
                    }),
                  }),
                }),
              ]),
            }),
          }),
        ],
      }),
    );

    const intentsField = (turnDefinition?.payload as any).fields
      .find((field: any) => field.name === "turn")
      .value.fields.find((field: any) => field.name === "intents").value;
    const spawnVariant = intentsField.element.variants.find(
      (variant: any) => variant.type === "spawn",
    );

    expect(spawnVariant.value.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "clientID",
          value: expect.objectContaining({
            kind: "projectedScalar",
            wireType: "clientIndex",
          }),
        }),
      ]),
    );
  });
});
