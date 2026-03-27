import { z } from "zod";

export type BinaryNumericWireType = "u16" | "u32" | "i32";

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

export interface OmitWireHelper extends Record<string, unknown> {
  readonly kind: "omit";
}

export type BinaryFieldHelper =
  | PlayerRefWireHelper
  | NumericWireHelper
  | OmitWireHelper;

export interface BinaryIntentMeta extends Record<string, unknown> {
  readonly kind: "intent";
  readonly jsonOnly: true;
}

export type BinaryMessageDirection = "client" | "server";
export type BinaryMessageEnvelope = "auto" | "intent" | "packedTurn";

export interface BinaryMessageMeta extends Record<string, unknown> {
  readonly kind: "message";
  readonly direction: BinaryMessageDirection;
  readonly envelope: BinaryMessageEnvelope;
  readonly order: number;
}

export const binaryFieldRegistry = z.registry<BinaryFieldHelper>();
export const binaryIntentRegistry = z.registry<BinaryIntentMeta>();
export const binaryMessageRegistry = z.registry<BinaryMessageMeta>();

const orderedBinaryMessages: z.ZodTypeAny[] = [];
let messageRegistrationOrder = 0;

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
  return binaryField(schema, {
    kind: "omit",
  });
}

export function jsonOnlyIntent<T extends z.ZodTypeAny>(schema: T): T {
  const cloned = cloneSchema(schema);
  (cloned as any).register(binaryIntentRegistry, {
    kind: "intent",
    jsonOnly: true,
  });
  return cloned;
}

function registerBinaryMessage<T extends z.ZodTypeAny>(
  schema: T,
  direction: BinaryMessageDirection,
  envelope: BinaryMessageEnvelope,
): T {
  const cloned = cloneSchema(schema);
  (cloned as any).register(binaryMessageRegistry, {
    kind: "message",
    direction,
    envelope,
    order: messageRegistrationOrder++,
  });
  orderedBinaryMessages.push(cloned);
  return cloned;
}

export function binaryClientGameplayMessage<T extends z.ZodTypeAny>(
  schema: T,
): T {
  return registerBinaryMessage(schema, "client", "auto");
}

export function binaryServerGameplayMessage<T extends z.ZodTypeAny>(
  schema: T,
): T {
  return registerBinaryMessage(schema, "server", "auto");
}

export function binaryIntentEnvelope<T extends z.ZodTypeAny>(schema: T): T {
  return registerBinaryMessage(schema, "client", "intent");
}

export function packedTurnMessage<T extends z.ZodTypeAny>(schema: T): T {
  return registerBinaryMessage(schema, "server", "packedTurn");
}

export function getBinaryFieldHelper(
  schema: z.ZodTypeAny,
): BinaryFieldHelper | undefined {
  return binaryFieldRegistry.get(schema);
}

export function getBinaryMessageMeta(
  schema: z.ZodTypeAny,
): BinaryMessageMeta | undefined {
  return binaryMessageRegistry.get(schema);
}

export function getBinaryGameplayMessageSchemas(): readonly z.ZodTypeAny[] {
  return orderedBinaryMessages;
}

export function isJsonOnlyIntentSchema(schema: z.ZodTypeAny): boolean {
  return binaryIntentRegistry.has(schema);
}
