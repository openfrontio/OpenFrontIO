import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AllIntentSchema,
  ClientMessageSchema,
  ServerMessageSchema,
} from "../Schemas";
import type {
  BinaryIntentDefinition,
  BinaryMessageDefinition,
  BinaryObjectFieldDefinition,
  BinaryObjectValueDefinition,
  BinaryValueDefinition,
} from "./BinaryRuntime";
import {
  binaryGameplayMessageRegistry,
  getBinaryFieldHelper,
  getBinaryGameplayMessageMeta,
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
}

interface BinaryCompileState {
  readonly cache: Map<z.ZodTypeAny, BinaryValueDefinition>;
}

interface UnwrappedFieldSchema {
  readonly schema: z.ZodTypeAny;
  readonly helper: ReturnType<typeof getBinaryFieldHelper>;
  readonly omit: boolean;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly defaultValue?: unknown;
}

function createCompileState(): BinaryCompileState {
  return { cache: new Map() };
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

function getArrayElementSchema(schema: z.ZodArray<any>): z.ZodTypeAny {
  const element =
    (schema as any).element ??
    (schema as any)._def?.element ??
    (schema as any)._def?.type;
  if (!element || typeof element !== "object") {
    throw new Error("Unable to inspect array element schema");
  }
  return element as z.ZodTypeAny;
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

function resolveDefaultValue(schema: z.ZodDefault<any>): unknown {
  const getter = (schema as any)._def?.defaultValue;
  return typeof getter === "function" ? getter() : getter;
}

function unwrapFieldSchema(schema: z.ZodTypeAny): UnwrappedFieldSchema {
  let current = schema;
  let helper = getBinaryFieldHelper(current);
  let omit = isBinaryOmittedSchema(current);
  let optional = false;
  let nullable = false;
  let defaultValue: unknown = undefined;

  while (true) {
    if (current instanceof z.ZodDefault) {
      defaultValue = resolveDefaultValue(current);
      current = (current as any)._def.innerType;
      helper ??= getBinaryFieldHelper(current);
      omit ||= isBinaryOmittedSchema(current);
      continue;
    }
    if (current instanceof z.ZodOptional) {
      optional = true;
      current = (current as any)._def.innerType;
      helper ??= getBinaryFieldHelper(current);
      omit ||= isBinaryOmittedSchema(current);
      continue;
    }
    if (current instanceof z.ZodNullable) {
      nullable = true;
      current = (current as any)._def.innerType;
      helper ??= getBinaryFieldHelper(current);
      omit ||= isBinaryOmittedSchema(current);
      continue;
    }
    break;
  }

  if (defaultValue !== undefined) {
    optional = false;
  }

  return {
    schema: current,
    helper,
    omit,
    optional,
    nullable,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

function getLiteralUnionValues(schema: z.ZodUnion<any>): (string | number)[] {
  const options = (schema as any)._def?.options as z.ZodTypeAny[] | undefined;
  if (!options || !Array.isArray(options) || options.length === 0) {
    throw new Error("Expected non-empty literal union");
  }
  return options.map((option) => {
    if (!(option instanceof z.ZodLiteral)) {
      throw new Error(
        `Only literal unions are supported on binary path, received ${option.constructor.name}`,
      );
    }
    const literalValue = getLiteralValue(option);
    if (typeof literalValue !== "string" && typeof literalValue !== "number") {
      throw new Error("Unsupported literal union value");
    }
    return literalValue;
  });
}

function isObjectDiscriminantUnion(schema: z.ZodUnion<any>): boolean {
  const options = (schema as any)._def?.options as z.ZodTypeAny[] | undefined;
  if (!options || options.length === 0) {
    return false;
  }
  return options.every((option) => {
    if (!(option instanceof z.ZodObject)) {
      return false;
    }
    try {
      return typeof getDiscriminantLiteral(option) === "string";
    } catch {
      return false;
    }
  });
}

function pickOrdinalWireType(valueCount: number): "u8" | "u16" | "u32" {
  if (valueCount <= 0xff) {
    return "u8";
  }
  if (valueCount <= 0xffff) {
    return "u16";
  }
  return "u32";
}

function stripAssignedBits(
  field: BinaryObjectFieldDefinition,
): BinaryObjectFieldDefinition {
  return { ...field, presenceBit: undefined, valueBit: undefined };
}

function assignPresenceBits(fields: readonly BinaryObjectFieldDefinition[]) {
  let nextBit = 0;
  let allowedFlags = 0;
  const withBits = fields.map((field) => {
    if (
      field.optional &&
      field.value.kind === "scalar" &&
      field.value.wireType === "bool"
    ) {
      const updated = { ...field, presenceBit: nextBit, valueBit: nextBit + 1 };
      allowedFlags |= 1 << nextBit;
      allowedFlags |= 1 << (nextBit + 1);
      nextBit += 2;
      return updated;
    }
    if (field.optional || field.nullable) {
      const updated = { ...field, presenceBit: nextBit };
      allowedFlags |= 1 << nextBit;
      nextBit += 1;
      return updated;
    }
    return field;
  });
  if (nextBit > 16) {
    throw new Error(
      "More than 16 presence bits are not supported yet on binary path",
    );
  }
  return { fields: withBits, allowedFlags };
}

function mergeObjectDefinitions(
  left: BinaryObjectValueDefinition,
  right: BinaryObjectValueDefinition,
): BinaryObjectValueDefinition {
  const mergedByName = new Map<string, BinaryObjectFieldDefinition>();
  for (const field of left.fields.map(stripAssignedBits)) {
    mergedByName.set(field.name, field);
  }
  for (const field of right.fields.map(stripAssignedBits)) {
    // Right-side fields override left-side fields. This matches the current
    // stamped-intent behavior where the stamped sender clientID wins over any
    // same-named field carried by the base intent payload.
    mergedByName.set(field.name, field);
  }
  const mergedFields = [...mergedByName.values()];
  const { fields, allowedFlags } = assignPresenceBits(mergedFields);
  return { kind: "object", fields, allowedFlags };
}

function compileObjectFields(
  entries: readonly [string, z.ZodTypeAny][],
  state: BinaryCompileState,
): BinaryObjectValueDefinition {
  const rawFields: BinaryObjectFieldDefinition[] = [];
  for (const [fieldName, fieldSchema] of entries) {
    const unwrapped = unwrapFieldSchema(fieldSchema);
    if (unwrapped.omit) {
      continue;
    }
    if (unwrapped.optional && unwrapped.nullable) {
      throw new Error(
        `Field ${fieldName} cannot be both optional and nullable on binary path`,
      );
    }
    rawFields.push({
      name: fieldName,
      value: compileValueSchema(unwrapped.schema, state),
      optional: unwrapped.optional || undefined,
      nullable: unwrapped.nullable || undefined,
      ...(unwrapped.defaultValue !== undefined
        ? { defaultValue: unwrapped.defaultValue }
        : {}),
    });
  }
  const { fields, allowedFlags } = assignPresenceBits(rawFields);
  return { kind: "object", fields, allowedFlags };
}

function compileObjectSchema(
  schema: z.ZodObject<any>,
  state: BinaryCompileState,
  omitFieldName?: string,
): BinaryObjectValueDefinition {
  const entries = Object.entries(getObjectShape(schema)).filter(
    ([name]) => name !== omitFieldName,
  );
  return compileObjectFields(entries, state);
}

function compileDiscriminatedUnionSchema(
  schema: z.ZodTypeAny,
  state: BinaryCompileState,
) {
  const options = getDiscriminatedUnionOptions(schema).filter(
    (option) => !isJsonOnlyIntentSchema(option),
  );
  const seenTypes = new Set<string>();
  const variants = options.map((option, index) => {
    const type = getDiscriminantLiteral(option);
    if (seenTypes.has(type)) {
      throw new Error(`Duplicate discriminated union variant ${type}`);
    }
    seenTypes.add(type);
    return {
      type,
      tag: index + 1,
      value: compileObjectSchema(option as z.ZodObject<any>, state, "type"),
    };
  });
  return {
    kind: "discriminatedUnion" as const,
    discriminant: "type",
    tagWireType: pickOrdinalWireType(variants.length),
    variants,
  };
}

function compileIntersectionSchema(
  schema: z.ZodIntersection<any, any>,
  state: BinaryCompileState,
): BinaryValueDefinition {
  const leftSchema = (schema as any)._def.left as z.ZodTypeAny;
  const rightSchema = (schema as any)._def.right as z.ZodTypeAny;
  const leftValue = compileValueSchema(leftSchema, state);
  const rightValue = compileValueSchema(rightSchema, state);

  if (leftValue.kind === "object" && rightValue.kind === "object") {
    return mergeObjectDefinitions(leftValue, rightValue);
  }
  if (leftValue.kind === "discriminatedUnion" && rightValue.kind === "object") {
    return {
      ...leftValue,
      variants: leftValue.variants.map((variant) => ({
        ...variant,
        value: mergeObjectDefinitions(
          variant.value as BinaryObjectValueDefinition,
          rightValue,
        ),
      })),
    };
  }
  if (leftValue.kind === "object" && rightValue.kind === "discriminatedUnion") {
    return {
      ...rightValue,
      variants: rightValue.variants.map((variant) => ({
        ...variant,
        value: mergeObjectDefinitions(
          leftValue,
          variant.value as BinaryObjectValueDefinition,
        ),
      })),
    };
  }
  throw new Error(
    `Unsupported binary intersection between ${leftSchema.constructor.name} and ${rightSchema.constructor.name}`,
  );
}

function compileLeafSchema(
  schema: z.ZodTypeAny,
  helper: ReturnType<typeof getBinaryFieldHelper>,
  state: BinaryCompileState,
): BinaryValueDefinition {
  if (helper?.kind === "playerRef") {
    return {
      kind: "projectedScalar",
      wireType: "playerRef",
      ...(helper.allowAllPlayers !== undefined
        ? { allowAllPlayers: helper.allowAllPlayers }
        : {}),
      ...(helper.inlineFallback !== undefined
        ? { inlineFallback: helper.inlineFallback }
        : {}),
    };
  }
  if (helper?.kind === "clientIndex") {
    return { kind: "projectedScalar", wireType: "clientIndex" };
  }
  if (helper?.kind === "number") {
    return { kind: "scalar", wireType: helper.wireType };
  }
  if (schema instanceof z.ZodBoolean) {
    return { kind: "scalar", wireType: "bool" };
  }
  if (schema instanceof z.ZodString) {
    return { kind: "scalar", wireType: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { kind: "scalar", wireType: "f64" };
  }
  if (schema instanceof z.ZodEnum) {
    const enumValues = [...(schema as any).options] as (string | number)[];
    return {
      kind: "scalar",
      wireType: "enum",
      enumValues,
      enumWireType: pickOrdinalWireType(enumValues.length),
    };
  }
  if (schema instanceof z.ZodLiteral) {
    const literalValue = getLiteralValue(schema);
    if (typeof literalValue !== "string" && typeof literalValue !== "number") {
      throw new Error(
        `Unsupported binary literal ${String(literalValue)} on binary path`,
      );
    }
    return {
      kind: "scalar",
      wireType: "enum",
      enumValues: [literalValue],
      enumWireType: "u8",
    };
  }
  if (
    (schema as any)._def?.typeName === "ZodDiscriminatedUnion" ||
    (schema as any).discriminator !== undefined
  ) {
    return compileDiscriminatedUnionSchema(schema, state);
  }
  if (schema instanceof z.ZodUnion) {
    if (isObjectDiscriminantUnion(schema)) {
      return compileDiscriminatedUnionSchema(schema, state);
    }
    const literalValues = getLiteralUnionValues(schema);
    return {
      kind: "scalar",
      wireType: "enum",
      enumValues: literalValues,
      enumWireType: pickOrdinalWireType(literalValues.length),
    };
  }
  if (schema instanceof z.ZodObject) {
    return compileObjectSchema(schema, state);
  }
  if (schema instanceof z.ZodArray) {
    return {
      kind: "array",
      lengthWireType: "u16",
      element: compileValueSchema(getArrayElementSchema(schema), state),
    };
  }
  if (schema instanceof z.ZodIntersection) {
    return compileIntersectionSchema(schema, state);
  }
  throw new Error(
    `Unsupported binary schema ${schema.constructor.name} on binary path`,
  );
}

function compileValueSchema(
  schema: z.ZodTypeAny,
  state: BinaryCompileState,
): BinaryValueDefinition {
  const cached = state.cache.get(schema);
  if (cached) {
    return cached;
  }

  let current = schema;
  let helper = getBinaryFieldHelper(current);
  while (
    current instanceof z.ZodDefault ||
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable
  ) {
    current = (current as any)._def.innerType;
    helper ??= getBinaryFieldHelper(current);
  }

  const compiled = compileLeafSchema(current, helper, state);
  state.cache.set(schema, compiled);
  if (schema !== current) {
    state.cache.set(current, compiled);
  }
  return compiled;
}

function buildIntentDefinitions(state: BinaryCompileState) {
  const compiled = compileValueSchema(AllIntentSchema, state);
  if (compiled.kind !== "discriminatedUnion") {
    throw new Error("AllIntentSchema must compile to a discriminated union");
  }
  return compiled.variants.map((variant) => ({
    type: variant.type,
    opcode: variant.tag,
    payload: variant.value,
  }));
}

function buildMessageDefinitions(state: BinaryCompileState) {
  const seenTypes = new Set<string>();
  const registrations = collectBinaryGameplayMessageRegistrations();
  return registrations.map((registration, index) => {
    const { schema, type, direction } = registration;
    if (seenTypes.has(type)) {
      throw new Error(`Duplicate binary message type ${type}`);
    }
    seenTypes.add(type);
    if (!(schema instanceof z.ZodObject)) {
      throw new Error(
        `Expected binary top-level message ${type} to be a ZodObject`,
      );
    }
    return {
      type,
      messageType: index + 1,
      direction,
      payload: compileObjectSchema(schema, state, "type"),
    };
  });
}

function collectBinaryGameplayMessageRegistrations(): BinaryGameplayMessageRegistration[] {
  const seenSchemas = new Set<z.ZodTypeAny>();
  const registrations = [
    ...collectBinaryGameplayMessageRegistrationsForDirection(
      "server",
      ServerMessageSchema,
      seenSchemas,
    ),
    ...collectBinaryGameplayMessageRegistrationsForDirection(
      "client",
      ClientMessageSchema,
      seenSchemas,
    ),
  ];
  validateNoOrphanBinaryGameplayMessageMetadata(seenSchemas);
  return registrations;
}

function collectBinaryGameplayMessageRegistrationsForDirection(
  direction: BinaryMessageDefinition["direction"],
  schema: z.ZodTypeAny,
  seenSchemas: Set<z.ZodTypeAny>,
): BinaryGameplayMessageRegistration[] {
  const schemas = getDiscriminatedUnionOptions(schema);
  return schemas.flatMap((messageSchema) => {
    if (!getBinaryGameplayMessageMeta(messageSchema)) {
      return [];
    }
    seenSchemas.add(messageSchema);
    return [
      {
        schema: messageSchema,
        type: getDiscriminantLiteral(messageSchema),
        direction,
      },
    ];
  });
}

function validateNoOrphanBinaryGameplayMessageMetadata(
  seenSchemas: ReadonlySet<z.ZodTypeAny>,
) {
  for (const rawSchema of binaryGameplayMessageRegistry._map.keys()) {
    const schema = rawSchema as z.ZodTypeAny;
    if (!seenSchemas.has(schema)) {
      const type = safeSchemaDiscriminant(schema);
      throw new Error(
        type
          ? `Binary gameplay message metadata is registered on unreachable schema ${type}`
          : "Binary gameplay message metadata is registered on a schema that is not reachable from ClientMessageSchema or ServerMessageSchema",
      );
    }
  }
}

function safeSchemaDiscriminant(schema: z.ZodTypeAny): string | undefined {
  try {
    return getDiscriminantLiteral(schema);
  } catch {
    return undefined;
  }
}

function renderStringLiteralUnion(values: readonly string[]): string {
  if (values.length === 0) {
    return "never";
  }
  return values.map((value) => JSON.stringify(value)).join(" | ");
}

export function collectGeneratedBinaryModel(): GeneratedBinaryModel {
  const state = createCompileState();
  return {
    intentDefinitions: buildIntentDefinitions(state),
    messageDefinitions: buildMessageDefinitions(state),
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
  const binaryIntentTypes = model.intentDefinitions.map(
    (definition) => definition.type,
  );

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
export type BinaryIntentGameplayType = ${renderStringLiteralUnion(binaryIntentTypes)};

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
