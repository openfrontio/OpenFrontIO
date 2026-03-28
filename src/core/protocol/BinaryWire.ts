import { z } from "zod";

export type BinaryNumericWireType = "u16" | "u32" | "i32" | "f64";

export interface PlayerRefWireHelper extends Record<string, unknown> {
  readonly kind: "playerRef";
  readonly nullable?: boolean;
  readonly allowAllPlayers?: boolean;
  readonly inlineFallback?: boolean;
}

export interface NumericWireHelper extends Record<string, unknown> {
  readonly kind: "number";
  readonly wireType: BinaryNumericWireType;
}

export interface BinaryOmitMeta extends Record<string, unknown> {
  readonly kind: "omit";
}

export type BinaryFieldHelper = PlayerRefWireHelper | NumericWireHelper;

export interface BinaryIntentMeta extends Record<string, unknown> {
  readonly kind: "intent";
  readonly jsonOnly: true;
}

export const binaryFieldRegistry = z.registry<BinaryFieldHelper>();
export const binaryOmitRegistry = z.registry<BinaryOmitMeta>();
export const binaryIntentRegistry = z.registry<BinaryIntentMeta>();

function cloneSchema<T extends z.ZodTypeAny>(schema: T): T {
  return schema.meta(schema.meta() ?? {}) as T;
}

export function playerRef(
  options: Omit<PlayerRefWireHelper, "kind"> = {},
): PlayerRefWireHelper {
  return {
    kind: "playerRef",
    ...options,
  };
}

export function binaryField<T extends z.ZodTypeAny>(
  schema: T,
  helper: BinaryFieldHelper,
): T {
  const cloned = cloneSchema(schema);
  (cloned as any).register(binaryFieldRegistry, helper);
  return cloned;
}

export function binaryNumber<T extends z.ZodTypeAny>(
  schema: T,
  wireType: BinaryNumericWireType,
): T {
  return binaryField(schema, {
    kind: "number",
    wireType,
  });
}

export function binaryOmit<T extends z.ZodTypeAny>(schema: T): T {
  const cloned = cloneSchema(schema);
  const existingFieldHelper = getBinaryFieldHelper(schema);
  if (existingFieldHelper !== undefined) {
    (cloned as any).register(binaryFieldRegistry, existingFieldHelper);
  }
  (cloned as any).register(binaryOmitRegistry, {
    kind: "omit",
  });
  return cloned;
}

export function jsonOnlyIntent<T extends z.ZodTypeAny>(schema: T): T {
  const cloned = cloneSchema(schema);
  // Intents are binary by default when they participate in AllIntentSchema.
  // This marker is the schema-level opt-out used by the generator.
  (cloned as any).register(binaryIntentRegistry, {
    kind: "intent",
    jsonOnly: true,
  });
  return cloned;
}

export function getBinaryFieldHelper(
  schema: z.ZodTypeAny,
): BinaryFieldHelper | undefined {
  return binaryFieldRegistry.get(schema);
}

export function isBinaryOmittedSchema(schema: z.ZodTypeAny): boolean {
  return binaryOmitRegistry.has(schema);
}

export function isJsonOnlyIntentSchema(schema: z.ZodTypeAny): boolean {
  return binaryIntentRegistry.has(schema);
}
