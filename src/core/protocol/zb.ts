import { z } from "zod";
import { AllPlayers } from "../game/Game";
import {
  type BinaryFieldHelper,
  type BinaryNumericWireType,
  binaryField,
  binaryNumber,
  binaryOmit,
  jsonOnlyIntent,
  playerRef as playerRefHelper,
} from "./BinaryWire";

const GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/;

// Helper-bearing zb constructors return lightweight builders, not Zod schemas.
// Call .schema() at the end of the chain to materialize the real Zod schema and
// attach the binary helper metadata exactly once on the final schema instance.
interface FieldSchemaBuilder<T extends z.ZodTypeAny> {
  optional(): FieldSchemaBuilder<z.ZodOptional<T>>;
  nullable(): FieldSchemaBuilder<z.ZodNullable<T>>;
  schema(): T;
}

interface NumberSchemaBuilder<T extends z.ZodTypeAny> {
  optional(): NumberSchemaBuilder<z.ZodOptional<T>>;
  nullable(): NumberSchemaBuilder<z.ZodNullable<T>>;
  max(
    this: NumberSchemaBuilder<z.ZodNumber>,
    value: number,
  ): NumberSchemaBuilder<z.ZodNumber>;
  nonnegative(
    this: NumberSchemaBuilder<z.ZodNumber>,
  ): NumberSchemaBuilder<z.ZodNumber>;
  schema(): T;
}

function createFieldBuilder<T extends z.ZodTypeAny>(
  schema: T,
  helper: BinaryFieldHelper,
): FieldSchemaBuilder<T> {
  return {
    optional() {
      return createFieldBuilder(schema.optional(), helper);
    },
    nullable() {
      return createFieldBuilder(schema.nullable(), helper);
    },
    schema() {
      return binaryField(schema, helper);
    },
  };
}

function createNumberBuilder<T extends z.ZodTypeAny>(
  schema: T,
  wireType: BinaryNumericWireType,
): NumberSchemaBuilder<T> {
  return {
    optional() {
      return createNumberBuilder(schema.optional(), wireType);
    },
    nullable() {
      return createNumberBuilder(schema.nullable(), wireType);
    },
    max(value) {
      return createNumberBuilder(
        (schema as unknown as z.ZodNumber).max(value),
        wireType,
      );
    },
    nonnegative() {
      return createNumberBuilder(
        (schema as unknown as z.ZodNumber).nonnegative(),
        wireType,
      );
    },
    schema() {
      return binaryNumber(schema, wireType);
    },
  };
}

export const zb = {
  array: z.array,
  binaryOmit,
  boolean: z.boolean,
  discriminatedUnion: z.discriminatedUnion,
  enum: z.enum,
  f64() {
    return createNumberBuilder(z.number(), "f64");
  },
  i32() {
    return createNumberBuilder(
      z.number().int().min(-0x80000000).max(0x7fffffff),
      "i32",
    );
  },
  jsonOnlyIntent,
  jwt: z.jwt,
  lazy: z.lazy,
  literal: z.literal,
  number: z.number,
  object: z.object,
  playerRef() {
    return createFieldBuilder(
      z.string().regex(GAME_ID_REGEX),
      playerRefHelper({ inlineFallback: true }),
    );
  },
  record: z.record,
  string: z.string,
  tuple: z.tuple,
  u16() {
    return createNumberBuilder(z.number().int().min(0).max(0xffff), "u16");
  },
  u32() {
    return createNumberBuilder(z.number().int().min(0).max(0xffffffff), "u32");
  },
  union: z.union,
  uuid: z.uuid,
  broadcastPlayerRef() {
    return createFieldBuilder(
      z.union([z.string().regex(GAME_ID_REGEX), z.literal(AllPlayers)]),
      playerRefHelper({ allowAllPlayers: true, inlineFallback: true }),
    );
  },
} as const;
