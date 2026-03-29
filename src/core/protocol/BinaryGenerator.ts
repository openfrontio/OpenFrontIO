import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AllIntentSchema,
  ClientMessageSchema,
  ServerMessageSchema,
} from "../Schemas";
import {
  binaryGameplayMessageRegistry,
  getBinaryFieldHelper,
  isBinaryGameplayMessageSchema,
  isBinaryOmittedSchema,
  isJsonOnlyIntentSchema,
} from "./BinaryWire";

type BinaryDirection = "client" | "server";

type BinaryScalarWireType =
  | "bool"
  | "f64"
  | "string"
  | "u8"
  | "u16"
  | "u32"
  | "i32"
  | "enum";

type BinaryProjectedWireType = "playerRef" | "clientIndex";

interface BinaryScalarValueDefinition {
  readonly kind: "scalar";
  readonly wireType: BinaryScalarWireType;
  readonly enumValues?: readonly (string | number)[];
  readonly enumWireType?: "u8" | "u16" | "u32";
}

interface BinaryProjectedScalarDefinition {
  readonly kind: "projectedScalar";
  readonly wireType: BinaryProjectedWireType;
  readonly allowAllPlayers?: boolean;
  readonly inlineFallback?: boolean;
}

interface BinaryObjectFieldDefinition {
  readonly name: string;
  readonly value: BinaryValueDefinition;
  readonly optional?: boolean;
  readonly nullable?: boolean;
  readonly presenceBit?: number;
  readonly valueBit?: number;
  readonly defaultValue?: unknown;
}

interface BinaryObjectValueDefinition {
  readonly kind: "object";
  readonly fields: readonly BinaryObjectFieldDefinition[];
  readonly allowedFlags: number;
}

interface BinaryArrayValueDefinition {
  readonly kind: "array";
  readonly lengthWireType: "u16";
  readonly element: BinaryValueDefinition;
}

interface BinaryDiscriminatedUnionVariantDefinition {
  readonly type: string;
  readonly tag: number;
  readonly value: BinaryValueDefinition;
}

interface BinaryDiscriminatedUnionValueDefinition {
  readonly kind: "discriminatedUnion";
  readonly discriminant: string;
  readonly tagWireType: "u8" | "u16" | "u32";
  readonly variants: readonly BinaryDiscriminatedUnionVariantDefinition[];
}

type BinaryValueDefinition =
  | BinaryScalarValueDefinition
  | BinaryProjectedScalarDefinition
  | BinaryObjectValueDefinition
  | BinaryArrayValueDefinition
  | BinaryDiscriminatedUnionValueDefinition;

interface BinaryIntentDefinition {
  readonly type: string;
  readonly opcode: number;
  readonly payload: BinaryValueDefinition;
}

interface BinaryMessageDefinition {
  readonly type: string;
  readonly messageType: number;
  readonly direction: BinaryDirection;
  readonly payload: BinaryValueDefinition;
}

export interface GeneratedBinaryModel {
  readonly intentUnion: BinaryDiscriminatedUnionValueDefinition;
  readonly intentDefinitions: readonly BinaryIntentDefinition[];
  readonly messageDefinitions: readonly BinaryMessageDefinition[];
}

interface BinaryGameplayMessageRegistration {
  readonly schema: z.ZodTypeAny;
  readonly type: string;
  readonly direction: BinaryDirection;
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
): BinaryDiscriminatedUnionValueDefinition {
  const rawOptions = (schema as any).options ?? (schema as any)._def?.options;
  const options = (
    Array.isArray(rawOptions)
      ? rawOptions
      : rawOptions instanceof Map
        ? [...rawOptions.values()]
        : (() => {
            throw new Error("Unable to inspect discriminated union options");
          })()
  ).filter((option) => !isJsonOnlyIntentSchema(option));
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
    kind: "discriminatedUnion",
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
    const element =
      (schema as any).element ??
      (schema as any)._def?.element ??
      (schema as any)._def?.type;
    if (!element || typeof element !== "object") {
      throw new Error("Unable to inspect array element schema");
    }
    return {
      kind: "array",
      lengthWireType: "u16",
      element: compileValueSchema(element as z.ZodTypeAny, state),
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

function buildIntentDefinitions(
  compiled: BinaryDiscriminatedUnionValueDefinition,
): readonly BinaryIntentDefinition[] {
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
  direction: BinaryDirection,
  schema: z.ZodTypeAny,
  seenSchemas: Set<z.ZodTypeAny>,
): BinaryGameplayMessageRegistration[] {
  const rawOptions = (schema as any).options ?? (schema as any)._def?.options;
  const schemas = Array.isArray(rawOptions)
    ? rawOptions
    : rawOptions instanceof Map
      ? [...rawOptions.values()]
      : (() => {
          throw new Error("Unable to inspect discriminated union options");
        })();
  return schemas.flatMap((messageSchema) => {
    if (!isBinaryGameplayMessageSchema(messageSchema)) {
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

function renderConstObject(
  exportName: string,
  items: readonly { readonly key: string; readonly value: number }[],
): string {
  return `export const ${exportName} = {\n${items
    .map((item) => `  ${item.key}: ${item.value},`)
    .join("\n")}\n} as const;\n`;
}

function renderLiteral(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function nestedHelperName(parentName: string, suffix: string): string {
  return `${parentName}${pascalCase(suffix)}`;
}

function renderOrdinalWrite(
  wireType: "u8" | "u16" | "u32",
  valueExpression: string,
): string {
  switch (wireType) {
    case "u8":
      return `writer.writeUint8(${valueExpression});`;
    case "u16":
      return `writer.writeUint16(${valueExpression});`;
    case "u32":
      return `writer.writeUint32(${valueExpression});`;
  }
}

function renderOrdinalRead(
  wireType: "u8" | "u16" | "u32",
  targetName: string,
): string {
  switch (wireType) {
    case "u8":
      return `const ${targetName} = reader.readUint8();`;
    case "u16":
      return `const ${targetName} = reader.readUint16();`;
    case "u32":
      return `const ${targetName} = reader.readUint32();`;
  }
}

function renderScalarHelpers(
  name: string,
  definition: BinaryScalarValueDefinition,
): string {
  const encodeLines = [
    `function encode_${name}(`,
    "  writer: BinaryWriter,",
    "  value: unknown,",
    "  _context: BinaryProtocolContext,",
    "  definitionName: string,",
    ") {",
  ];
  const decodeLines = [
    `function decode_${name}(`,
    "  reader: BinaryReader,",
    "  _context: BinaryProtocolContext,",
    "  definitionName: string,",
    "): unknown {",
  ];
  switch (definition.wireType) {
    case "bool":
      encodeLines.push("  writer.writeBoolean(value as boolean);");
      decodeLines.push("  return reader.readBoolean();");
      break;
    case "f64":
      encodeLines.push("  writer.writeFloat64(value as number);");
      decodeLines.push("  return reader.readFloat64();");
      break;
    case "string":
      encodeLines.push("  writer.writeString(value as string);");
      decodeLines.push("  return reader.readString();");
      break;
    case "u8":
      encodeLines.push("  writer.writeUint8(value as number);");
      decodeLines.push("  return reader.readUint8();");
      break;
    case "u16":
      encodeLines.push("  writer.writeUint16(value as number);");
      decodeLines.push("  return reader.readUint16();");
      break;
    case "u32":
      encodeLines.push("  writer.writeUint32(value as number);");
      decodeLines.push("  return reader.readUint32();");
      break;
    case "i32":
      encodeLines.push("  writer.writeInt32(value as number);");
      decodeLines.push("  return reader.readInt32();");
      break;
    case "enum":
      encodeLines.push(
        `  const enumValues = ${JSON.stringify(definition.enumValues ?? [])} as const;`,
      );
      encodeLines.push(
        "  const enumIndex = enumValues.indexOf(value as never);",
      );
      encodeLines.push("  if (enumIndex === -1) {");
      encodeLines.push(
        "    throw new Error(`Unknown enum value ${String(value)} for ${definitionName}`);",
      );
      encodeLines.push("  }");
      encodeLines.push(
        `  ${renderOrdinalWrite(definition.enumWireType ?? "u8", "enumIndex + 1")}`,
      );
      decodeLines.push(
        `  const enumValues = ${JSON.stringify(definition.enumValues ?? [])} as const;`,
      );
      decodeLines.push(
        `  ${renderOrdinalRead(definition.enumWireType ?? "u8", "ordinal")}`,
      );
      decodeLines.push("  if (ordinal <= 0) {");
      decodeLines.push(
        "    throw new Error(`Invalid ordinal ${ordinal} for ${definitionName}`);",
      );
      decodeLines.push("  }");
      decodeLines.push("  const value = enumValues[ordinal - 1];");
      decodeLines.push("  if (value === undefined) {");
      decodeLines.push(
        "    throw new Error(`Invalid enum ordinal ${ordinal} for ${definitionName}`);",
      );
      decodeLines.push("  }");
      decodeLines.push("  return value;");
      break;
  }
  encodeLines.push("}");
  decodeLines.push("}");
  return `${encodeLines.join("\n")}\n\n${decodeLines.join("\n")}`;
}

function renderProjectedScalarHelpers(
  name: string,
  definition: BinaryProjectedScalarDefinition,
): string {
  const encodeLines = [
    `function encode_${name}(`,
    "  writer: BinaryWriter,",
    "  value: unknown,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    ") {",
  ];
  const decodeLines = [
    `function decode_${name}(`,
    "  reader: BinaryReader,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    "): unknown {",
  ];
  if (definition.wireType === "playerRef") {
    if (!definition.allowAllPlayers) {
      encodeLines.push("  if (value === AllPlayers) {");
      encodeLines.push(
        "    throw new Error(`${definitionName} cannot target AllPlayers`);",
      );
      encodeLines.push("  }");
    }
    encodeLines.push(
      `  writePlayerRef(writer, value as string | null | typeof AllPlayers, context, ${definition.inlineFallback ?? false});`,
    );
    decodeLines.push("  const playerId = readPlayerRef(reader, context);");
    if (!definition.allowAllPlayers) {
      decodeLines.push("  if (playerId === AllPlayers) {");
      decodeLines.push(
        "    throw new Error(`${definitionName} cannot target AllPlayers`);",
      );
      decodeLines.push("  }");
    }
    decodeLines.push("  return playerId;");
  } else {
    encodeLines.push(
      "  const index = context.playerIdToIndex.get(value as never);",
    );
    encodeLines.push("  if (index === undefined) {");
    encodeLines.push(
      "    throw new Error(`Unknown stamped client ID: ${String(value)}`);",
    );
    encodeLines.push("  }");
    encodeLines.push("  writer.writeUint16(index);");
    decodeLines.push("  return requireClientId(reader.readUint16(), context);");
  }
  encodeLines.push("}");
  decodeLines.push("}");
  return `${encodeLines.join("\n")}\n\n${decodeLines.join("\n")}`;
}

function renderObjectHelpers(
  name: string,
  definition: BinaryObjectValueDefinition,
): string {
  const encodeLines = [
    `function encode_${name}(`,
    "  writer: BinaryWriter,",
    "  value: unknown,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    ") {",
    "  if (!isBinaryRecord(value)) {",
    "    throw new Error(`Expected object for ${definitionName}`);",
    "  }",
    "  const source = value;",
  ];
  definition.fields.forEach((field, index) => {
    const valueName = `fieldValue${index}`;
    const access = `source[${JSON.stringify(field.name)}]`;
    encodeLines.push(
      field.defaultValue !== undefined
        ? `  const ${valueName} = ${access} === undefined ? ${renderLiteral(field.defaultValue)} : ${access};`
        : `  const ${valueName} = ${access};`,
    );
  });
  if (definition.allowedFlags !== 0) {
    encodeLines.push("  let flags = 0;");
    definition.fields.forEach((field, index) => {
      const valueName = `fieldValue${index}`;
      if (
        field.optional &&
        field.value.kind === "scalar" &&
        field.value.wireType === "bool"
      ) {
        encodeLines.push(`  if (${valueName} !== undefined) {`);
        encodeLines.push(`    flags |= 1 << ${field.presenceBit!};`);
        encodeLines.push(`    if (${valueName}) {`);
        encodeLines.push(`      flags |= 1 << ${field.valueBit!};`);
        encodeLines.push("    }");
        encodeLines.push("  }");
        return;
      }
      if (field.optional) {
        encodeLines.push(`  if (${valueName} !== undefined) {`);
        encodeLines.push(`    flags |= 1 << ${field.presenceBit!};`);
        encodeLines.push("  }");
        return;
      }
      if (field.nullable) {
        encodeLines.push(`  if (${valueName} !== null) {`);
        encodeLines.push(`    flags |= 1 << ${field.presenceBit!};`);
        encodeLines.push("  }");
      }
    });
    encodeLines.push("  writer.writeUint16(flags);");
  }
  definition.fields.forEach((field, index) => {
    const childName = nestedHelperName(name, field.name);
    const valueName = `fieldValue${index}`;
    if (
      field.optional &&
      field.value.kind === "scalar" &&
      field.value.wireType === "bool"
    ) {
      return;
    }
    if (field.optional) {
      encodeLines.push(`  if (${valueName} !== undefined) {`);
      encodeLines.push(
        `    encode_${childName}(writer, ${valueName}, context, ${JSON.stringify(field.name)});`,
      );
      encodeLines.push("  }");
      return;
    }
    if (field.nullable) {
      encodeLines.push(`  if (${valueName} !== null) {`);
      encodeLines.push(
        `    encode_${childName}(writer, ${valueName}, context, ${JSON.stringify(field.name)});`,
      );
      encodeLines.push("  }");
      return;
    }
    encodeLines.push(
      `  encode_${childName}(writer, ${valueName}, context, ${JSON.stringify(field.name)});`,
    );
  });
  encodeLines.push("}");

  const decodeLines = [
    `function decode_${name}(`,
    "  reader: BinaryReader,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    "): Record<string, unknown> {",
    `  const flags = ${definition.allowedFlags !== 0 ? "reader.readUint16()" : "0"};`,
  ];
  if (definition.allowedFlags !== 0) {
    decodeLines.push(
      `  const invalidFlags = flags & ~${definition.allowedFlags};`,
    );
    decodeLines.push("  if (invalidFlags !== 0) {");
    decodeLines.push(
      "    throw new Error(`Unsupported flags ${invalidFlags} for ${definitionName}`);",
    );
    decodeLines.push("  }");
  }
  decodeLines.push("  const output: Record<string, unknown> = {};");
  definition.fields.forEach((field) => {
    const childName = nestedHelperName(name, field.name);
    const access = `output[${JSON.stringify(field.name)}]`;
    if (
      field.optional &&
      field.value.kind === "scalar" &&
      field.value.wireType === "bool"
    ) {
      decodeLines.push(
        `  ${access} = (flags & (1 << ${field.presenceBit!})) !== 0 ? (flags & (1 << ${field.valueBit!})) !== 0 : ${renderLiteral(field.defaultValue)};`,
      );
      return;
    }
    if (field.optional) {
      decodeLines.push(
        `  ${access} = (flags & (1 << ${field.presenceBit!})) !== 0 ? decode_${childName}(reader, context, ${JSON.stringify(field.name)}) : ${renderLiteral(field.defaultValue)};`,
      );
      return;
    }
    if (field.nullable) {
      decodeLines.push(
        `  ${access} = (flags & (1 << ${field.presenceBit!})) !== 0 ? decode_${childName}(reader, context, ${JSON.stringify(field.name)}) : null;`,
      );
      return;
    }
    decodeLines.push(
      `  ${access} = decode_${childName}(reader, context, ${JSON.stringify(field.name)});`,
    );
  });
  decodeLines.push("  return output;");
  decodeLines.push("}");

  return `${encodeLines.join("\n")}\n\n${decodeLines.join("\n")}`;
}

function renderArrayHelpers(
  name: string,
  definition: BinaryArrayValueDefinition,
): string {
  const childName = nestedHelperName(name, "item");
  const encodeLines = [
    `function encode_${name}(`,
    "  writer: BinaryWriter,",
    "  value: unknown,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    ") {",
    "  if (!Array.isArray(value)) {",
    "    throw new Error(`Expected array for ${definitionName}`);",
    "  }",
    "  if (value.length > 0xffff) {",
    "    throw new RangeError(`Binary array too long: ${value.length} elements exceeds 65535 for ${definitionName}`);",
    "  }",
    "  writer.writeUint16(value.length);",
    "  value.forEach((entry, index) => {",
    `    encode_${childName}(writer, entry, context, \`\${definitionName}[\${index}]\`);`,
    "  });",
    "}",
  ];
  const decodeLines = [
    `function decode_${name}(`,
    "  reader: BinaryReader,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    "): unknown[] {",
    "  const length = reader.readUint16();",
    "  return Array.from({ length }, (_, index) =>",
    `    decode_${childName}(reader, context, \`\${definitionName}[\${index}]\`),`,
    "  );",
    "}",
  ];
  return `${encodeLines.join("\n")}\n\n${decodeLines.join("\n")}`;
}

function renderDiscriminatedUnionHelpers(
  name: string,
  definition: BinaryDiscriminatedUnionValueDefinition,
): string {
  const encodeLines = [
    `function encode_${name}(`,
    "  writer: BinaryWriter,",
    "  value: unknown,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    ") {",
    "  if (!isBinaryRecord(value)) {",
    "    throw new Error(`Expected object for ${definitionName}`);",
    "  }",
    `  const discriminantValue = value[${JSON.stringify(definition.discriminant)}];`,
    '  if (typeof discriminantValue !== "string") {',
    `    throw new Error(\`Expected string discriminant ${definition.discriminant} on \${definitionName}\`);`,
    "  }",
    "  switch (discriminantValue) {",
  ];
  const decodeLines = [
    `function decode_${name}(`,
    "  reader: BinaryReader,",
    "  context: BinaryProtocolContext,",
    "  definitionName: string,",
    "): Record<string, unknown> {",
    `  ${renderOrdinalRead(definition.tagWireType, "tag")}`,
    "  if (tag <= 0) {",
    "    throw new Error(`Invalid ordinal ${tag} for ${definitionName}`);",
    "  }",
    "  switch (tag) {",
  ];
  definition.variants.forEach((variant) => {
    const childName = nestedHelperName(name, variant.type);
    encodeLines.push(`    case ${JSON.stringify(variant.type)}:`);
    encodeLines.push(
      `      ${renderOrdinalWrite(definition.tagWireType, String(variant.tag))}`,
    );
    encodeLines.push(
      `      encode_${childName}(writer, value, context, \`\${definitionName}.${variant.type}\`);`,
    );
    encodeLines.push("      return;");

    decodeLines.push(`    case ${variant.tag}: {`);
    decodeLines.push(
      `      const decoded = decode_${childName}(reader, context, \`\${definitionName}.${variant.type}\`);`,
    );
    decodeLines.push("      if (!isBinaryRecord(decoded)) {");
    decodeLines.push(
      `        throw new Error(\`Expected object payload for \${definitionName}.${variant.type}\`);`,
    );
    decodeLines.push("      }");
    decodeLines.push(
      `      return { ${JSON.stringify(definition.discriminant)}: ${JSON.stringify(variant.type)}, ...decoded };`,
    );
    decodeLines.push("    }");
  });
  encodeLines.push("    default:");
  encodeLines.push(
    "      throw new Error(`Unsupported ${definitionName} variant ${discriminantValue} on binary path`);",
  );
  encodeLines.push("  }");
  encodeLines.push("}");
  decodeLines.push("    default:");
  decodeLines.push(
    "      throw new Error(`Unknown ${definitionName} tag: ${tag}`);",
  );
  decodeLines.push("  }");
  decodeLines.push("}");
  return `${encodeLines.join("\n")}\n\n${decodeLines.join("\n")}`;
}

function renderValueHelpers(
  name: string,
  definition: BinaryValueDefinition,
): string {
  const childBlocks =
    definition.kind === "object"
      ? definition.fields
          .map((field) =>
            renderValueHelpers(nestedHelperName(name, field.name), field.value),
          )
          .filter(Boolean)
      : definition.kind === "array"
        ? [
            renderValueHelpers(
              nestedHelperName(name, "item"),
              definition.element,
            ),
          ]
        : definition.kind === "discriminatedUnion"
          ? definition.variants
              .map((variant) =>
                renderValueHelpers(
                  nestedHelperName(name, variant.type),
                  variant.value,
                ),
              )
              .filter(Boolean)
          : [];
  const localChunks =
    definition.kind === "scalar"
      ? [renderScalarHelpers(name, definition)]
      : definition.kind === "projectedScalar"
        ? [renderProjectedScalarHelpers(name, definition)]
        : definition.kind === "object"
          ? [renderObjectHelpers(name, definition)]
          : definition.kind === "array"
            ? [renderArrayHelpers(name, definition)]
            : [renderDiscriminatedUnionHelpers(name, definition)];
  return [...childBlocks, localChunks.join("\n\n")]
    .filter(Boolean)
    .join("\n\n");
}

function renderIntentTypeHelpers(
  definitions: readonly BinaryIntentDefinition[],
): string {
  const byTypeEntries = definitions
    .map(
      (definition) =>
        `  ${JSON.stringify(definition.type)}: ${definition.opcode},`,
    )
    .join("\n");
  const byOpcodeEntries = definitions
    .map(
      (definition) =>
        `  ${definition.opcode}: ${JSON.stringify(definition.type)},`,
    )
    .join("\n");
  return [
    "const BINARY_INTENT_OPCODE_BY_TYPE = {",
    byTypeEntries,
    "} as const;",
    "",
    "const BINARY_INTENT_TYPE_BY_OPCODE = {",
    byOpcodeEntries,
    "} as const;",
    "",
    'export function hasBinaryIntentOpcode(intentType: Intent["type"]): boolean {',
    "  return Object.prototype.hasOwnProperty.call(",
    "    BINARY_INTENT_OPCODE_BY_TYPE,",
    "    intentType,",
    "  );",
    "}",
    "",
    'export function intentTypeToOpcode(intentType: Intent["type"]): BinaryIntentType {',
    '  const opcode = (BINARY_INTENT_OPCODE_BY_TYPE as Partial<Record<Intent["type"], BinaryIntentType>>)[intentType];',
    "  if (opcode === undefined) {",
    "    throw new Error(`Unsupported binary intent type: ${intentType}`);",
    "  }",
    "  return opcode;",
    "}",
    "",
    'export function opcodeToIntentType(opcode: number): Intent["type"] {',
    '  const intentType = (BINARY_INTENT_TYPE_BY_OPCODE as Partial<Record<number, Intent["type"]>>)[opcode];',
    "  if (intentType === undefined) {",
    "    throw new Error(`Unknown binary intent opcode: ${opcode}`);",
    "  }",
    "  return intentType;",
    "}",
  ].join("\n");
}

function renderGeneratedIntentExports(model: GeneratedBinaryModel): string {
  const intentHelperName = "IntentPayload";
  return [
    "export function encodeGeneratedBinaryIntent(",
    "  writer: BinaryWriter,",
    "  intent: Intent,",
    "  context: BinaryProtocolContext,",
    ") {",
    `  encode_${intentHelperName}(writer, intent, context, "binary intent type");`,
    "}",
    "",
    "export function decodeGeneratedBinaryIntent(",
    "  reader: BinaryReader,",
    "  context: BinaryProtocolContext,",
    "): Intent {",
    `  return decode_${intentHelperName}(reader, context, "binary intent type") as Intent;`,
    "}",
  ].join("\n");
}

function renderMessageHelpers(
  model: GeneratedBinaryModel,
  direction: BinaryDirection,
): string {
  const relevant = model.messageDefinitions.filter(
    (definition) => definition.direction === direction,
  );
  const opposite = model.messageDefinitions.filter(
    (definition) => definition.direction !== direction,
  );
  const typeName = pascalCase(direction);
  const messageType =
    direction === "client"
      ? "BinaryClientGameplayMessage"
      : "BinaryServerGameplayMessage";
  const encodeLines = [
    `export function encodeGeneratedBinary${typeName}GameplayMessage(`,
    `  message: ${messageType},`,
    "  context: BinaryProtocolContext,",
    "): Uint8Array {",
    "  const writer = new BinaryWriter();",
    "  const messageTypeName = message.type as string;",
    "  switch (messageTypeName) {",
  ];
  const decodeLines = [
    `export function decodeGeneratedBinary${typeName}GameplayMessage(`,
    "  data: ArrayBuffer | Uint8Array,",
    "  context: BinaryProtocolContext,",
    `): ${messageType} {`,
    "  const reader = new BinaryReader(toUint8Array(data));",
    "  const { messageType } = reader.readFrameHeader();",
    `  let decoded: ${messageType};`,
    "  switch (messageType) {",
  ];
  relevant.forEach((definition) => {
    const helperName = `${pascalCase(direction)}${pascalCase(definition.type)}Payload`;
    encodeLines.push(`    case ${JSON.stringify(definition.type)}:`);
    encodeLines.push(
      `      return writer.writeFrame(${definition.messageType}, () => encode_${helperName}(writer, message, context, ${JSON.stringify(`binary message type ${definition.type}`)}));`,
    );
    decodeLines.push(`    case ${definition.messageType}:`);
    decodeLines.push(
      `      decoded = { type: ${JSON.stringify(definition.type)}, ...(decode_${helperName}(reader, context, ${JSON.stringify(`binary message type ${definition.type}`)}) as Record<string, unknown>) } as ${messageType};`,
    );
    decodeLines.push("      break;");
  });
  opposite.forEach((definition) => {
    encodeLines.push(`    case ${JSON.stringify(definition.type)}:`);
    encodeLines.push(
      `      throw new Error(${JSON.stringify(`Unexpected ${direction} binary message type: ${definition.type}`)});`,
    );
    decodeLines.push(`    case ${definition.messageType}:`);
    decodeLines.push(
      `      throw new Error(${JSON.stringify(`Unexpected ${direction} binary message type: ${definition.type}`)});`,
    );
  });
  encodeLines.push("    default:");
  encodeLines.push(
    `      throw new Error(\`Unknown ${direction} binary message type: \${String((message as { type?: unknown }).type)}\`);`,
  );
  encodeLines.push("  }");
  encodeLines.push("}");
  decodeLines.push("    default:");
  decodeLines.push(
    `      throw new Error(\`Unknown ${direction} binary message type: \${messageType}\`);`,
  );
  decodeLines.push("  }");
  decodeLines.push("  reader.ensureFinished();");
  decodeLines.push("  return decoded;");
  decodeLines.push("}");
  return `${encodeLines.join("\n")}\n\n${decodeLines.join("\n")}`;
}

function renderClientCanEncodeFunction(model: GeneratedBinaryModel): string {
  const clientDefinitions = model.messageDefinitions.filter(
    (definition) => definition.direction === "client",
  );
  const lines = [
    "export function canEncodeGeneratedBinaryClientGameplayMessage(",
    "  message: ClientMessage,",
    "): message is BinaryClientGameplayMessage {",
    "  switch (message.type) {",
  ];
  clientDefinitions.forEach((definition) => {
    lines.push(`    case ${JSON.stringify(definition.type)}:`);
    if (definition.type === "intent") {
      lines.push("      return hasBinaryIntentOpcode(message.intent.type);");
      return;
    }
    lines.push("      return true;");
  });
  lines.push("    default:");
  lines.push("      return false;");
  lines.push("  }");
  lines.push("}");
  return lines.join("\n");
}

function renderHelperPrelude(): string {
  return [
    "function isBinaryRecord(value: unknown): value is Record<string, unknown> {",
    '  return typeof value === "object" && value !== null && !Array.isArray(value);',
    "}",
  ].join("\n");
}

export function collectGeneratedBinaryModel(): GeneratedBinaryModel {
  const state = createCompileState();
  const compiledIntentUnion = compileValueSchema(AllIntentSchema, state);
  if (compiledIntentUnion.kind !== "discriminatedUnion") {
    throw new Error("AllIntentSchema must compile to a discriminated union");
  }
  return {
    intentUnion: compiledIntentUnion,
    intentDefinitions: buildIntentDefinitions(compiledIntentUnion),
    messageDefinitions: buildMessageDefinitions(state),
  };
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
  const helperBlocks = [
    renderValueHelpers("IntentPayload", model.intentUnion),
    ...model.messageDefinitions.map((definition) =>
      renderValueHelpers(
        `${pascalCase(definition.direction)}${pascalCase(definition.type)}Payload`,
        definition.payload,
      ),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  return `/* This file is auto-generated by scripts/gen-binary-gameplay.ts. Do not edit manually. */
import type {
  ClientMessage,
  Intent,
  ServerMessage,
} from "../../Schemas";
import { AllPlayers } from "../../game/Game";
import {
  BinaryReader,
  BinaryWriter,
  requireClientId,
  readPlayerRef,
  toUint8Array,
  writePlayerRef,
  type BinaryProtocolContext,
} from "../../protocol/BinaryRuntime";

${renderConstObject("BinaryMessageType", messageConstants)}
export type BinaryMessageType =
  (typeof BinaryMessageType)[keyof typeof BinaryMessageType];

${renderConstObject("BinaryIntentType", intentConstants)}
export type BinaryIntentType =
  (typeof BinaryIntentType)[keyof typeof BinaryIntentType];

export type BinaryClientGameplayMessage = Extract<
  ClientMessage,
  { type: ${renderStringLiteralUnion(clientMessageTypes)} }
>;

export type BinaryServerGameplayMessage = Extract<
  ServerMessage,
  { type: ${renderStringLiteralUnion(serverMessageTypes)} }
>;

${renderHelperPrelude()}

${helperBlocks}

${renderIntentTypeHelpers(model.intentDefinitions)}

${renderGeneratedIntentExports(model)}

${renderClientCanEncodeFunction(model)}

${renderMessageHelpers(model, "client")}

${renderMessageHelpers(model, "server")}
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
