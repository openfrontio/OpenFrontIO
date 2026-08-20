// A realistic message-protocol exercise, self-contained (no game imports):
// a many-variant discriminated union of "intents", stamped with a
// dictionary-mapped sender id, wrapped in a turn message — the shape zbin is
// designed for. Verifies cross-peer context sync, JSON-path equivalence,
// escape-path ids, and byte budgets.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zb, ZbDecodeError } from "../../zbin";

const PlayerID = zb.mapped("playerId", { regex: /^[A-Za-z0-9]{8}$/ });

const IntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spawn"), tile: zb.uint() }),
  z.object({
    type: z.literal("attack"),
    targetID: PlayerID.nullable(),
    troops: zb.float({ min: 0 }).nullable(),
  }),
  z.object({
    type: z.literal("build"),
    unit: z.enum(["City", "Port", "Warship", "MissileSilo"]),
    tile: zb.uint(),
    amount: zb.uint({ min: 1, max: 10 }).optional(),
  }),
  z.object({ type: z.literal("ally"), recipient: PlayerID }),
  z.object({
    type: z.literal("emoji"),
    recipient: z.union([PlayerID, z.literal("AllPlayers")]),
    emoji: zb.uint({ max: 500 }),
  }),
  z.object({
    type: z.literal("move_fleet"),
    unitIds: z.array(zb.int()).nonempty(),
    tile: zb.uint(),
  }),
  z.object({ type: z.literal("pause"), paused: z.boolean().default(false) }),
  z.object({
    type: z.literal("configure"),
    config: zb.json(
      z.object({ bots: z.number(), instantBuild: z.boolean() }).partial(),
    ),
  }),
]);

const StampedIntentSchema = zb.stamped(IntentSchema, { clientID: PlayerID });
type StampedIntent = zb.infer<typeof StampedIntentSchema>;

const TurnMessageSchema = zb.object({
  type: zb.literal("turn"),
  turnNumber: zb.uint(),
  intents: StampedIntentSchema.array(),
  hash: zb.float().nullable().optional(),
});
type TurnMessage = zb.infer<typeof TurnMessageSchema>;

const ROSTER = ["aB3dEf7h", "Xk9mNp2q", "Zz8wVu5t", "Qr4sTu6v"];
const [P1, P2, P3] = ROSTER;

function makeCtx() {
  const ctx = zb.context();
  ctx.mapping("playerId", { max: 250 });
  ctx.assignAll("playerId", ROSTER);
  return ctx;
}

const SAMPLE_INTENTS: StampedIntent[] = [
  { type: "spawn", clientID: P1, tile: 123456 },
  { type: "attack", clientID: P1, targetID: P2, troops: 5123.75 },
  { type: "attack", clientID: P2, targetID: null, troops: null },
  { type: "build", clientID: P2, unit: "Port", tile: 7, amount: 3 },
  { type: "build", clientID: P3, unit: "City", tile: 88 },
  { type: "ally", clientID: P1, recipient: P3 },
  { type: "emoji", clientID: P1, recipient: "AllPlayers", emoji: 3 },
  { type: "emoji", clientID: P1, recipient: P2, emoji: 0 },
  { type: "move_fleet", clientID: P3, unitIds: [1, -2, 3], tile: 555 },
  { type: "pause", clientID: P1, paused: true },
  { type: "configure", clientID: P1, config: { bots: 5, instantBuild: true } },
];

describe("realistic protocol round-trips", () => {
  it("round-trips a turn holding every intent variant across two peers", () => {
    // Sender and receiver each build their own context from the shared roster.
    const sctx = makeCtx();
    const rctx = makeCtx();
    const msg: TurnMessage = {
      type: "turn",
      turnNumber: 999,
      intents: SAMPLE_INTENTS,
    };
    const bytes = TurnMessageSchema.serialize(msg, sctx);
    expect(TurnMessageSchema.parseBytes(bytes, rctx)).toEqual(msg);
  });

  it("matches the JSON path exactly (parse of stringify)", () => {
    const sctx = makeCtx();
    const rctx = makeCtx();
    const msg: TurnMessage = {
      type: "turn",
      turnNumber: 7,
      intents: SAMPLE_INTENTS,
    };
    const viaJson = TurnMessageSchema.parse(JSON.parse(JSON.stringify(msg)));
    const viaBin = TurnMessageSchema.parseBytes(
      TurnMessageSchema.serialize(msg, sctx),
      rctx,
    );
    expect(viaBin).toEqual(viaJson);
  });

  it("applies schema defaults identically to zod (absent pause flag)", () => {
    const sctx = makeCtx();
    const rctx = makeCtx();
    const msg = {
      type: "turn" as const,
      turnNumber: 1,
      intents: [{ type: "pause" as const, clientID: P1 }],
    };
    const out = TurnMessageSchema.parseBytes(
      TurnMessageSchema.serialize(msg, sctx),
      rctx,
    );
    expect(out.intents[0]).toEqual({
      type: "pause",
      clientID: P1,
      paused: false,
    });
  });

  it("ids outside the roster survive via the inline escape", () => {
    const sctx = makeCtx();
    const rctx = makeCtx();
    const msg: TurnMessage = {
      type: "turn",
      turnNumber: 5,
      intents: [{ type: "ally", clientID: "ADMINBOT", recipient: P1 }],
    };
    expect(
      TurnMessageSchema.parseBytes(
        TurnMessageSchema.serialize(msg, sctx),
        rctx,
      ),
    ).toEqual(msg);
  });

  it("peers with differently-seeded tables produce a loud error, not silent corruption", () => {
    const sctx = makeCtx();
    const badCtx = zb.context();
    badCtx.mapping("playerId", { max: 250 });
    // Receiver seeded with a shorter roster: sender's index 3 is unknown.
    badCtx.assignAll("playerId", ROSTER.slice(0, 2));
    const msg: TurnMessage = {
      type: "turn",
      turnNumber: 1,
      intents: [{ type: "ally", clientID: ROSTER[3], recipient: P1 }],
    };
    expect(() =>
      TurnMessageSchema.parseBytes(
        TurnMessageSchema.serialize(msg, sctx),
        badCtx,
      ),
    ).toThrow(ZbDecodeError);
  });
});

describe("byte budgets", () => {
  it("an empty turn fits in 7 bytes", () => {
    const bytes = TurnMessageSchema.serialize(
      { type: "turn", turnNumber: 12345, intents: [] },
      makeCtx(),
    );
    expect(bytes.length).toBeLessThanOrEqual(7);
  });

  it("a stamped attack intent costs ~12 bytes inside a turn", () => {
    const ctx = makeCtx();
    const empty = TurnMessageSchema.serialize(
      { type: "turn", turnNumber: 12345, intents: [] },
      ctx,
    ).length;
    const withAttack = TurnMessageSchema.serialize(
      {
        type: "turn",
        turnNumber: 12345,
        intents: [
          { type: "attack", clientID: P1, targetID: P2, troops: 512.5 },
        ],
      },
      ctx,
    ).length;
    expect(withAttack - empty).toBeLessThanOrEqual(13);
  });

  it("beats JSON by at least 5x on a realistic turn", () => {
    const msg: TurnMessage = {
      type: "turn",
      turnNumber: 12345,
      intents: [
        { type: "attack", clientID: P1, targetID: P2, troops: 5123.75 },
        { type: "build", clientID: P2, unit: "Port", tile: 998877 },
      ],
    };
    const jsonSize = JSON.stringify(msg).length;
    const binSize = TurnMessageSchema.serialize(msg, makeCtx()).length;
    expect(binSize * 5).toBeLessThan(jsonSize);
  });

  it("serialization is deterministic (same value, same bytes)", () => {
    const msg: TurnMessage = {
      type: "turn",
      turnNumber: 42,
      intents: SAMPLE_INTENTS,
    };
    const a = TurnMessageSchema.serialize(msg, makeCtx());
    const b = TurnMessageSchema.serialize(msg, makeCtx());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("robustness at the protocol level", () => {
  it("rejects truncation at every byte boundary", () => {
    const ctx = makeCtx();
    const bytes = TurnMessageSchema.serialize(
      { type: "turn", turnNumber: 999, intents: SAMPLE_INTENTS.slice(0, 4) },
      ctx,
    );
    for (let cut = 0; cut < bytes.length; cut++) {
      expect(() =>
        TurnMessageSchema.parseBytes(bytes.subarray(0, cut), makeCtx()),
      ).toThrow();
    }
  });

  it("validation still applies: out-of-range decoded values fail zod parse", () => {
    // Hand-craft a message whose emoji index exceeds the schema max by
    // serializing with a permissive twin schema, then parsing with the strict
    // one. Field layout is identical, so only validation differs.
    const LooseIntent = z.discriminatedUnion("type", [
      z.object({ type: z.literal("emoji_only"), emoji: zb.uint() }),
    ]);
    const StrictIntent = z.discriminatedUnion("type", [
      z.object({ type: z.literal("emoji_only"), emoji: zb.uint({ max: 500 }) }),
    ]);
    const loose = zb.object({ body: LooseIntent });
    const strict = zb.object({ body: StrictIntent });
    const bytes = loose.serialize({
      body: { type: "emoji_only", emoji: 9999 },
    });
    expect(() => strict.parseBytes(bytes)).toThrow(z.ZodError);
    // decodeBytes (trusted path) skips validation by design.
    expect(strict.decodeBytes(bytes)).toEqual({
      body: { type: "emoji_only", emoji: 9999 },
    });
  });
});
