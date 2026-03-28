import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AllIntentSchema,
  BinaryClientGameplayMessageRouting,
  BinaryClientGameplayMessageSchema,
  BinaryServerGameplayMessageRouting,
  BinaryServerGameplayMessageSchema,
} from "../Schemas";
import type {
  BinaryFieldDefinition,
  BinaryIntentDefinition,
  BinaryMessageDefinition,
} from "./BinaryRuntime";
import {
  getBinaryFieldHelper,
  isBinaryOmittedSchema,
  isJsonOnlyIntentSchema,
} from "./BinaryWire";

interface GeneratedBinaryModel {
  readonly intentDefinitions: readonly BinaryIntentDefinition[];
  readonly messageDefinitions: readonly BinaryMessageDefinition[];
}

interface BinaryGameplayMessageRegistration {
  readonly schema: z.ZodTypeAny;
  readonly type: string;
  readonly direction: BinaryMessageDefinition["direction"];
  readonly envelope: BinaryMessageDefinition["envelope"];
}

type BinaryGameplayMessageRouting = Readonly<
  Record<string, BinaryMessageDefinition["envelope"]>
>;

function getDiscriminantLiteral(schema: z.ZodTypeAny): string {
  const shape = getObjectShape(schema);
  const typeField = shape.type;
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

function pascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\s-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function analyzeFieldSchema(
  fieldName: string,
  schema: z.ZodTypeAny,
): BinaryFieldDefinition {
  let current = schema;
  let optional = false;
  let nullable = false;
  const omit = isBinaryOmittedSchema(current);
  let helper = getBinaryFieldHelper(current);

  while (true) {
    if (current instanceof z.ZodDefault) {
      current = (current as any)._def.innerType;
      helper ??= getBinaryFieldHelper(current);
      continue;
    }
    if (current instanceof z.ZodOptional) {
      optional = true;
      current = (current as any)._def.innerType;
      helper ??= getBinaryFieldHelper(current);
      continue;
    }
    if (current instanceof z.ZodNullable) {
      nullable = true;
      current = (current as any)._def.innerType;
      helper ??= getBinaryFieldHelper(current);
      continue;
    }
    break;
  }

  if (optional && nullable) {
    throw new Error(
      `Field ${fieldName} cannot be both optional and nullable on binary path`,
    );
  }

  const definitionBase: BinaryFieldDefinition = {
    name: fieldName,
    wireType: "string",
  };
  let definition: BinaryFieldDefinition;

  if (helper?.kind === "playerRef") {
    definition = {
      ...definitionBase,
      wireType: "playerRef",
      optional,
      nullable,
      ...(helper.allowAllPlayers !== undefined
        ? { allowAllPlayers: helper.allowAllPlayers }
        : {}),
      ...(helper.inlineFallback !== undefined
        ? { inlineFallback: helper.inlineFallback }
        : {}),
    };
  } else if (helper?.kind === "number") {
    definition = {
      ...definitionBase,
      wireType: helper.wireType,
      optional,
      nullable,
    };
  } else if (current instanceof z.ZodBoolean) {
    definition = {
      ...definitionBase,
      wireType: "bool",
      optional,
      nullable,
    };
  } else if (current instanceof z.ZodString) {
    definition = {
      ...definitionBase,
      wireType: "string",
      optional,
      nullable,
    };
  } else if (current instanceof z.ZodNumber) {
    definition = {
      ...definitionBase,
      wireType: "f64",
      optional,
      nullable,
    };
  } else if (current instanceof z.ZodEnum) {
    const enumValues = [...(current as any).options] as (string | number)[];
    definition = {
      ...definitionBase,
      wireType: "enum",
      optional,
      nullable,
      enumValues,
      enumWireType: pickEnumWireType(enumValues.length),
    };
  } else if (current instanceof z.ZodUnion) {
    const literalValues = getLiteralUnionValues(current);
    definition = {
      ...definitionBase,
      wireType: "enum",
      optional,
      nullable,
      enumValues: literalValues,
      enumWireType: pickEnumWireType(literalValues.length),
    };
  } else {
    throw new Error(
      `Unsupported binary field ${fieldName} with schema ${current.constructor.name}`,
    );
  }

  if (!omit) {
    return definition;
  }

  return {
    ...definition,
    omit: true,
    optional: false,
    nullable: false,
    presenceBit: undefined,
    valueBit: undefined,
  };
}

function getLiteralUnionValues(schema: z.ZodUnion<any>): (string | number)[] {
  const options = (schema as any)._def?.options as z.ZodTypeAny[] | undefined;
  if (!options || !Array.isArray(options) || options.length === 0) {
    throw new Error("Expected non-empty literal union");
  }
  return options.map((option) => {
    if (!(option instanceof z.ZodLiteral)) {
      throw new Error("Only literal unions are supported on binary path");
    }
    const literalValue = getLiteralValue(option);
    if (typeof literalValue !== "string" && typeof literalValue !== "number") {
      throw new Error("Unsupported literal union value");
    }
    return literalValue;
  });
}

function pickEnumWireType(
  valueCount: number,
): BinaryFieldDefinition["enumWireType"] {
  if (valueCount <= 0xff) {
    return "u8";
  }
  if (valueCount <= 0xffff) {
    return "u16";
  }
  return "u32";
}

function assignPresenceBits(fields: readonly BinaryFieldDefinition[]): {
  readonly fields: readonly BinaryFieldDefinition[];
  readonly allowedFlags: number;
} {
  let nextBit = 0;
  let allowedFlags = 0;
  const withBits = fields.map((field) => {
    if (field.omit) {
      return field;
    }
    if (field.optional && field.wireType === "bool") {
      const updated = {
        ...field,
        presenceBit: nextBit,
        valueBit: nextBit + 1,
      };
      allowedFlags |= 1 << nextBit;
      allowedFlags |= 1 << (nextBit + 1);
      nextBit += 2;
      return updated;
    }
    if (field.optional || field.nullable) {
      const updated = {
        ...field,
        presenceBit: nextBit,
      };
      allowedFlags |= 1 << nextBit;
      nextBit += 1;
      return updated;
    }
    return field;
  });
  if (nextBit > 16) {
    throw new Error(
      `More than 16 presence bits are not supported yet on binary path`,
    );
  }
  return {
    fields: withBits,
    allowedFlags,
  };
}

function buildIntentDefinitions(): BinaryIntentDefinition[] {
  const seenTypes = new Set<string>();
  const definitions: BinaryIntentDefinition[] = [];

  for (const option of getDiscriminatedUnionOptions(AllIntentSchema)) {
    const type = getDiscriminantLiteral(option);
    if (seenTypes.has(type)) {
      throw new Error(`Duplicate intent type ${type}`);
    }
    seenTypes.add(type);

    if (isJsonOnlyIntentSchema(option)) {
      continue;
    }

    // Every non-jsonOnly variant in AllIntentSchema is part of the binary gameplay protocol.
    const shape = getObjectShape(option);
    const rawFields = Object.entries(shape)
      .filter(([name]) => name !== "type")
      .map(([name, fieldSchema]) => analyzeFieldSchema(name, fieldSchema));
    const { fields, allowedFlags } = assignPresenceBits(rawFields);
    definitions.push({
      type,
      opcode: definitions.length + 1,
      fields,
      allowedFlags,
    });
  }

  return definitions;
}

function buildMessageDefinitions(): BinaryMessageDefinition[] {
  const seenTypes = new Set<string>();
  const registrations = collectBinaryGameplayMessageRegistrations();

  return registrations.map((registration, index) => {
    const { schema, type, direction, envelope } = registration;
    if (seenTypes.has(type)) {
      throw new Error(`Duplicate binary message type ${type}`);
    }
    seenTypes.add(type);
    const fieldAnalysis =
      envelope === "auto"
        ? assignPresenceBits(
            Object.entries(getObjectShape(schema))
              .filter(([name]) => name !== "type")
              .map(([name, fieldSchema]) =>
                analyzeFieldSchema(name, fieldSchema),
              ),
          )
        : { fields: [], allowedFlags: 0 };
    return {
      type,
      messageType: index + 1,
      direction,
      envelope,
      fields: fieldAnalysis.fields,
      allowedFlags: fieldAnalysis.allowedFlags,
    };
  });
}

function collectBinaryGameplayMessageRegistrations(): BinaryGameplayMessageRegistration[] {
  return [
    ...collectBinaryGameplayMessageRegistrationsForDirection(
      "server",
      BinaryServerGameplayMessageSchema,
      BinaryServerGameplayMessageRouting,
    ),
    ...collectBinaryGameplayMessageRegistrationsForDirection(
      "client",
      BinaryClientGameplayMessageSchema,
      BinaryClientGameplayMessageRouting,
    ),
  ];
}

function collectBinaryGameplayMessageRegistrationsForDirection(
  direction: BinaryMessageDefinition["direction"],
  schema: z.ZodTypeAny,
  routing: BinaryGameplayMessageRouting,
): BinaryGameplayMessageRegistration[] {
  const schemas = getDiscriminatedUnionOptions(schema);
  const schemaTypes = schemas.map(getDiscriminantLiteral);

  validateBinaryGameplayMessageRouting(direction, schemaTypes, routing);

  return schemas.map((messageSchema) => {
    const type = getDiscriminantLiteral(messageSchema);
    return {
      schema: messageSchema,
      type,
      direction,
      envelope: routing[type]!,
    };
  });
}

function validateBinaryGameplayMessageRouting(
  direction: BinaryMessageDefinition["direction"],
  schemaTypes: readonly string[],
  routing: BinaryGameplayMessageRouting,
) {
  const routingTypes = Object.keys(routing);
  for (const type of schemaTypes) {
    if (!(type in routing)) {
      throw new Error(
        `Missing ${direction} binary gameplay routing entry for ${type}`,
      );
    }
    const envelope = routing[type];
    if (
      envelope !== "auto" &&
      envelope !== "intent" &&
      envelope !== "packedTurn"
    ) {
      throw new Error(
        `Unsupported ${direction} binary gameplay envelope ${String(envelope)} for ${type}`,
      );
    }
  }

  for (const type of routingTypes) {
    if (!schemaTypes.includes(type)) {
      throw new Error(
        `Unexpected ${direction} binary gameplay routing entry for ${type}`,
      );
    }
  }
}

function renderStringLiteralUnion(values: readonly string[]): string {
  if (values.length === 0) {
    return "never";
  }
  return values.map((value) => JSON.stringify(value)).join(" | ");
}

export function collectGeneratedBinaryModel(): GeneratedBinaryModel {
  return {
    intentDefinitions: buildIntentDefinitions(),
    messageDefinitions: buildMessageDefinitions(),
  };
}

function renderConstObject(
  exportName: string,
  items: readonly { readonly key: string; readonly value: number }[],
): string {
  return `export const ${exportName} = {\n${items
    .map((item) => `  ${item.key}: ${item.value},`)
    .join("\n")}\n} as const;\n`;
}

function renderDefinitions(
  exportName: string,
  definitions: readonly object[],
): string {
  return `export const ${exportName} = ${JSON.stringify(
    definitions,
    null,
    2,
  )} as const;\n`;
}

export function generateBinaryGameplaySource(): string {
  const model = collectGeneratedBinaryModel();
  const clientMessageDefinitions = model.messageDefinitions.filter(
    (definition) => definition.direction === "client",
  );
  const serverMessageDefinitions = model.messageDefinitions.filter(
    (definition) => definition.direction === "server",
  );
  const clientMessageTypes = clientMessageDefinitions.map(
    (definition) => definition.type,
  );
  const serverMessageTypes = serverMessageDefinitions.map(
    (definition) => definition.type,
  );
  const messageConstants = model.messageDefinitions.map((definition) => ({
    key: pascalCase(definition.type),
    value: definition.messageType,
  }));
  const intentConstants = model.intentDefinitions.map((definition) => ({
    key: pascalCase(definition.type),
    value: definition.opcode,
  }));

  return `/* This file is auto-generated by scripts/gen-binary-gameplay.ts. Do not edit manually. */
import type {
  ClientMessage,
  Intent,
  ServerMessage,
} from "../../Schemas";
import type {
  BinaryIntentDefinition,
  BinaryMessageDefinition,
} from "../../protocol/BinaryRuntime";

${renderConstObject("BinaryMessageType", messageConstants)}
export type BinaryMessageType =
  (typeof BinaryMessageType)[keyof typeof BinaryMessageType];

${renderConstObject("BinaryIntentType", intentConstants)}
export type BinaryIntentType =
  (typeof BinaryIntentType)[keyof typeof BinaryIntentType];

${renderDefinitions("BINARY_MESSAGE_DEFINITIONS", model.messageDefinitions)}
${renderDefinitions("BINARY_INTENT_DEFINITIONS", model.intentDefinitions)}

export const BINARY_MESSAGE_DEFINITION_BY_TYPE = new Map(
  (BINARY_MESSAGE_DEFINITIONS as readonly BinaryMessageDefinition[]).map(
    (definition) => [definition.type, definition],
  ),
);

export const BINARY_MESSAGE_DEFINITION_BY_MESSAGE_TYPE = new Map(
  (BINARY_MESSAGE_DEFINITIONS as readonly BinaryMessageDefinition[]).map(
    (definition) => [definition.messageType, definition],
  ),
);

export type BinaryClientGameplayMessageType = ${renderStringLiteralUnion(clientMessageTypes)};

export type BinaryServerGameplayMessageType = ${renderStringLiteralUnion(serverMessageTypes)};

export type BinaryClientGameplayMessage = Extract<
  ClientMessage,
  { type: BinaryClientGameplayMessageType }
>;

export type BinaryServerGameplayMessage = Extract<
  ServerMessage,
  { type: BinaryServerGameplayMessageType }
>;

export const BINARY_INTENT_DEFINITION_BY_TYPE = new Map(
  (BINARY_INTENT_DEFINITIONS as readonly BinaryIntentDefinition[]).map(
    (definition) => [definition.type, definition],
  ),
);

export const BINARY_INTENT_DEFINITION_BY_OPCODE = new Map(
  (BINARY_INTENT_DEFINITIONS as readonly BinaryIntentDefinition[]).map(
    (definition) => [definition.opcode, definition],
  ),
);

export function hasBinaryIntentOpcode(intentType: Intent["type"]): boolean {
  return BINARY_INTENT_DEFINITION_BY_TYPE.has(intentType);
}

export function intentTypeToOpcode(intentType: Intent["type"]): BinaryIntentType {
  const definition = BINARY_INTENT_DEFINITION_BY_TYPE.get(intentType);
  if (!definition) {
    throw new Error(\`Unsupported binary intent type: \${intentType}\`);
  }
  return definition.opcode as BinaryIntentType;
}

export function opcodeToIntentType(opcode: number): Intent["type"] {
  const definition = BINARY_INTENT_DEFINITION_BY_OPCODE.get(opcode);
  if (!definition) {
    throw new Error(\`Unknown binary intent opcode: \${opcode}\`);
  }
  return definition.type as Intent["type"];
}

export function isBinaryGameplayClientMessage(
  message: ClientMessage,
): message is BinaryClientGameplayMessage {
  switch (message.type) {
${clientMessageDefinitions
  .map((definition) => {
    if (definition.envelope === "intent") {
      return `    case ${JSON.stringify(definition.type)}:\n      return hasBinaryIntentOpcode(message.intent.type);`;
    }
    return `    case ${JSON.stringify(definition.type)}:\n      return true;`;
  })
  .join("\n")}
    default:
      return false;
  }
}
`;
}

export async function writeGeneratedBinaryGameplayFile(outputPath: string) {
  const source = generateBinaryGameplaySource();
  await mkdir(path.dirname(outputPath), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(outputPath, "utf8");
  } catch {
    existing = "";
  }
  if (existing === source) {
    return false;
  }
  await writeFile(outputPath, source, "utf8");
  return true;
}
