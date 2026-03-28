import { z } from "zod";

export type BinaryNumericWireType = "u16" | "u32" | "i32" | "f64";

export interface PlayerRefWireHelper extends Record<string, unknown> {
  readonly kind: "playerRef";
  readonly allowAllPlayers?: boolean;
  readonly inlineFallback?: boolean;
}

export interface NumericWireHelper extends Record<string, unknown> {
  readonly kind: "number";
  readonly wireType: BinaryNumericWireType;
}

export interface ClientIndexWireHelper extends Record<string, unknown> {
  readonly kind: "clientIndex";
}

export type BinaryFieldHelper =
  | PlayerRefWireHelper
  | NumericWireHelper
  | ClientIndexWireHelper;

type BinaryPresenceMarker = Record<never, never>;
const BINARY_PRESENCE_MARKER: BinaryPresenceMarker = {};

export const binaryFieldRegistry = z.registry<BinaryFieldHelper>();
export const binaryOmitRegistry = z.registry<BinaryPresenceMarker>();
export const binaryIntentRegistry = z.registry<BinaryPresenceMarker>();
export const binaryGameplayMessageRegistry = z.registry<BinaryPresenceMarker>();

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

export function clientIndexRef(): ClientIndexWireHelper {
  return {
    kind: "clientIndex",
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
  (cloned as any).register(binaryOmitRegistry, BINARY_PRESENCE_MARKER);
  return cloned;
}

export function jsonOnlyIntent<T extends z.ZodTypeAny>(schema: T): T {
  const cloned = cloneSchema(schema);
  // Intents are binary by default when they participate in AllIntentSchema.
  // This marker is the schema-level opt-out used by the generator.
  (cloned as any).register(binaryIntentRegistry, BINARY_PRESENCE_MARKER);
  return cloned;
}

export function binaryGameplayMessage<T extends z.ZodTypeAny>(schema: T): T {
  const cloned = cloneSchema(schema);
  (cloned as any).register(
    binaryGameplayMessageRegistry,
    BINARY_PRESENCE_MARKER,
  );
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

export function isBinaryGameplayMessageSchema(schema: z.ZodTypeAny): boolean {
  return binaryGameplayMessageRegistry.has(schema);
}
