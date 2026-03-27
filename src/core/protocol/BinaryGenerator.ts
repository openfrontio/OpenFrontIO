import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AllIntentSchema } from "../Schemas";
import type {
  BinaryFieldDefinition,
  BinaryIntentDefinition,
  BinaryMessageDefinition,
} from "./BinaryRuntime";
import {
  getBinaryFieldHelper,
  getBinaryGameplayMessageSchemas,
  getBinaryMessageMeta,
  isJsonOnlyIntentSchema,
} from "./BinaryWire";

interface GeneratedBinaryModel {
  readonly intentDefinitions: readonly BinaryIntentDefinition[];
  readonly messageDefinitions: readonly BinaryMessageDefinition[];
}

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

  if (helper?.kind === "omit") {
    const innerDefinition = analyzeFieldSchema(fieldName, current);
    return {
      ...innerDefinition,
      name: fieldName,
      omit: true,
      optional: false,
      nullable: false,
      presenceBit: undefined,
      valueBit: undefined,
    };
  }

  if (helper?.kind === "playerRef") {
    return {
      ...definitionBase,
      wireType: "playerRef",
      optional,
      nullable,
      allowAllPlayers: helper.allowAllPlayers,
      inlineFallback: helper.inlineFallback,
    };
  }

  if (helper?.kind === "number") {
    return {
      ...definitionBase,
      wireType: helper.wireType,
      optional,
      nullable,
    };
  }

  if (current instanceof z.ZodBoolean) {
    return {
      ...definitionBase,
      wireType: "bool",
      optional,
      nullable,
    };
  }

  if (current instanceof z.ZodString) {
    return {
      ...definitionBase,
      wireType: "string",
      optional,
      nullable,
    };
  }

  if (current instanceof z.ZodNumber) {
    return {
      ...definitionBase,
      wireType: "f64",
      optional,
      nullable,
    };
  }

  if (current instanceof z.ZodEnum) {
    const enumValues = [...(current as any).options] as (string | number)[];
    return {
      ...definitionBase,
      wireType: "enum",
      optional,
      nullable,
      enumValues,
      enumWireType: pickEnumWireType(enumValues.length),
    };
  }

  if (current instanceof z.ZodUnion) {
    const literalValues = getLiteralUnionValues(current);
    return {
      ...definitionBase,
      wireType: "enum",
      optional,
      nullable,
      enumValues: literalValues,
      enumWireType: pickEnumWireType(literalValues.length),
    };
  }

  throw new Error(
    `Unsupported binary field ${fieldName} with schema ${current.constructor.name}`,
  );
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
  return getBinaryGameplayMessageSchemas().map((schema, index) => {
    const meta = getBinaryMessageMeta(schema);
    if (!meta) {
      throw new Error("Binary message schema missing metadata");
    }
    const type = getDiscriminantLiteral(schema);
    if (seenTypes.has(type)) {
      throw new Error(`Duplicate binary message type ${type}`);
    }
    seenTypes.add(type);
    const fieldAnalysis =
      meta.envelope === "auto"
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
      direction: meta.direction,
      envelope: meta.envelope,
      fields: fieldAnalysis.fields,
      allowedFlags: fieldAnalysis.allowedFlags,
    };
  });
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
  ClientHashMessage,
  ClientIntentMessage,
  ClientMessage,
  ClientPingMessage,
  Intent,
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
): message is ClientIntentMessage | ClientHashMessage | ClientPingMessage {
  return (
    (message.type === "intent" && hasBinaryIntentOpcode(message.intent.type)) ||
    message.type === "hash" ||
    message.type === "ping"
  );
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
