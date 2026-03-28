import { z } from "zod";
import { AllPlayers } from "../game/Game";
import {
  binaryClientGameplayMessage,
  binaryField,
  binaryFieldRegistry,
  binaryIntentEnvelope,
  binaryIntentRegistry,
  binaryMessageRegistry,
  binaryNumber,
  binaryOmit,
  binaryServerGameplayMessage,
  getBinaryFieldHelper,
  getBinaryMessageMeta,
  isJsonOnlyIntentSchema,
  jsonOnlyIntent,
  packedTurnMessage,
  playerRef as playerRefHelper,
} from "./BinaryWire";

const GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/;
const ZB_PATCHED = Symbol.for("openfront.protocol.zb.patched");
const ZB_WRAPPED = Symbol.for("openfront.protocol.zb.wrapped");

declare module "zod" {
  interface ZodType<
    out Output = unknown,
    out Input = unknown,
    out _Internals extends z.core.$ZodTypeInternals<
      Output,
      Input
    > = z.core.$ZodTypeInternals<Output, Input>,
  > {
    readonly _zbInternalsHint?: _Internals | undefined;
    binaryOmit(): this;
    jsonOnlyIntent(): this;
    clientGameplayMessage(): this;
    serverGameplayMessage(): this;
    intentEnvelope(): this;
    packedTurnMessage(): this;
  }
}

function copyBinaryMetadata(source: z.ZodTypeAny, target: z.ZodTypeAny) {
  const fieldHelper = getBinaryFieldHelper(source);
  if (fieldHelper !== undefined) {
    (target as any).register(binaryFieldRegistry, fieldHelper);
  }

  const messageMeta = getBinaryMessageMeta(source);
  if (messageMeta !== undefined) {
    (target as any).register(binaryMessageRegistry, messageMeta);
  }

  if (isJsonOnlyIntentSchema(source)) {
    (target as any).register(binaryIntentRegistry, {
      kind: "intent",
      jsonOnly: true,
    });
  }
}

function decorateBinaryAwareSchema<T extends z.ZodTypeAny>(schema: T): T {
  const instance = schema as z.ZodTypeAny & Record<PropertyKey, unknown>;
  if ((instance as any)[ZB_WRAPPED]) {
    return schema;
  }

  for (const methodName of [
    "optional",
    "nullable",
    "default",
    "refine",
    "gt",
    "gte",
    "min",
    "lt",
    "lte",
    "max",
    "positive",
    "negative",
    "nonpositive",
    "nonnegative",
    "multipleOf",
    "step",
    "finite",
    "safe",
    "int",
  ]) {
    const original = instance[methodName];
    if (typeof original !== "function" || (original as any)[ZB_WRAPPED]) {
      continue;
    }

    const wrapped = function (this: z.ZodTypeAny, ...args: unknown[]) {
      const result = (original as (...methodArgs: unknown[]) => unknown).apply(
        this,
        args,
      );
      if (result instanceof z.ZodType) {
        copyBinaryMetadata(this, result);
        return decorateBinaryAwareSchema(result);
      }
      return result;
    };

    Object.defineProperty(wrapped, ZB_WRAPPED, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    instance[methodName] = wrapped;
  }

  Object.defineProperty(instance, ZB_WRAPPED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return schema;
}

function wrapMethodWithBinaryMetadata(
  proto: Record<PropertyKey, unknown>,
  methodName: PropertyKey,
) {
  const original = proto[methodName];
  if (typeof original !== "function" || (original as any)[ZB_WRAPPED]) {
    return;
  }

  const wrapped = function (this: z.ZodTypeAny, ...args: unknown[]) {
    const result = (original as (...methodArgs: unknown[]) => unknown).apply(
      this,
      args,
    );
    if (result instanceof z.ZodType) {
      copyBinaryMetadata(this, result);
    }
    return result;
  };

  Object.defineProperty(wrapped, ZB_WRAPPED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  proto[methodName] = wrapped;
}

function installZbPrototypeMethods() {
  const proto = z.ZodType.prototype as any;
  if (proto[ZB_PATCHED]) {
    return;
  }

  const originalClone = proto.clone as (...args: unknown[]) => z.ZodTypeAny;
  proto.clone = function (...args: unknown[]) {
    const cloned = originalClone.apply(this, args);
    copyBinaryMetadata(this as z.ZodTypeAny, cloned);
    return cloned;
  };
  wrapMethodWithBinaryMetadata(proto, "optional");
  wrapMethodWithBinaryMetadata(proto, "nullable");
  wrapMethodWithBinaryMetadata(proto, "default");
  wrapMethodWithBinaryMetadata(proto, "refine");

  const numberProto = z.ZodNumber.prototype as Record<PropertyKey, unknown>;
  for (const methodName of [
    "gt",
    "gte",
    "min",
    "lt",
    "lte",
    "max",
    "positive",
    "negative",
    "nonpositive",
    "nonnegative",
    "multipleOf",
    "step",
    "finite",
    "safe",
    "int",
  ]) {
    wrapMethodWithBinaryMetadata(numberProto, methodName);
  }

  proto.binaryOmit = function () {
    return binaryOmit(this as z.ZodTypeAny);
  };
  proto.jsonOnlyIntent = function () {
    return jsonOnlyIntent(this as z.ZodTypeAny);
  };
  proto.clientGameplayMessage = function () {
    return binaryClientGameplayMessage(this as z.ZodTypeAny);
  };
  proto.serverGameplayMessage = function () {
    return binaryServerGameplayMessage(this as z.ZodTypeAny);
  };
  proto.intentEnvelope = function () {
    return binaryIntentEnvelope(this as z.ZodTypeAny);
  };
  proto.packedTurnMessage = function () {
    return packedTurnMessage(this as z.ZodTypeAny);
  };

  Object.defineProperty(proto, ZB_PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installZbPrototypeMethods();

export const zb = {
  array: z.array,
  boolean: z.boolean,
  discriminatedUnion: z.discriminatedUnion,
  enum: z.enum,
  jwt: z.jwt,
  lazy: z.lazy,
  literal: z.literal,
  number: z.number,
  object: z.object,
  record: z.record,
  string: z.string,
  tuple: z.tuple,
  union: z.union,
  uuid: z.uuid,
  u16() {
    return decorateBinaryAwareSchema(
      binaryNumber(z.number().int().min(0).max(0xffff), "u16"),
    );
  },
  u32() {
    return decorateBinaryAwareSchema(
      binaryNumber(z.number().int().min(0).max(0xffffffff), "u32"),
    );
  },
  i32() {
    return decorateBinaryAwareSchema(
      binaryNumber(z.number().int().min(-0x80000000).max(0x7fffffff), "i32"),
    );
  },
  f64() {
    return decorateBinaryAwareSchema(binaryNumber(z.number(), "f64"));
  },
  playerRef() {
    return decorateBinaryAwareSchema(
      binaryField(
        z.string().regex(GAME_ID_REGEX),
        playerRefHelper({ inlineFallback: true }),
      ),
    );
  },
  broadcastPlayerRef() {
    return decorateBinaryAwareSchema(
      binaryField(
        z.union([z.string().regex(GAME_ID_REGEX), z.literal(AllPlayers)]),
        playerRefHelper({ allowAllPlayers: true, inlineFallback: true }),
      ),
    );
  },
} as const;
