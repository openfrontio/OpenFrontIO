import { ClanTagSchema, UsernameSchema } from "@openfront/engine-api/Schemas";
import {
  LevelBadge,
  packLevelBadge,
  unpackLevelBadge,
} from "@openfront/shared/LevelBadgeWire";
import {
  ClientInfo,
  ClientInfoSchema,
  ClientJoinMessageSchema,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { zb } from "@openfront/zbin";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const pack = (badge: LevelBadge): number => packLevelBadge(badge)!;

// The roster's level badge rides lobby_info as the last, optional field of
// ClientInfo. These pin the wire contract that comment in Schemas.ts promises:
// it round-trips, an entry without it is byte-identical to the pre-badge
// layout, and a frame encoded before the field existed still decodes.

const NewClientInfo = zb.object(ClientInfoSchema.shape);
// A frozen copy of ClientInfo as it was before levelBadge was appended —
// spelled out, not derived from the live shape, so a field added after the
// badge (which would spill into a second header byte) fails these tests.
const PreBadgeClientInfo = zb.object({
  clientID: z.string(),
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  friends: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
  spectator: z.boolean().optional(),
  teamIndex: zb.uint().optional(),
});

const PLAIN: ClientInfo = {
  clientID: "aB3dEf7h",
  username: "alpha",
  clanTag: null,
};
// Every other optional/nullable/boolean field set, so all seven pre-badge
// header bits are in play.
const FULL: ClientInfo = {
  clientID: "Xk9mNp2q",
  username: "bravo",
  clanTag: "XY",
  friends: ["aB3dEf7h"],
  verified: true,
  spectator: true,
  teamIndex: 3,
};

describe("ClientInfo.levelBadge on the wire", () => {
  it("stays the last field of ClientInfo", () => {
    // Its presence bit is the last of the one-byte header; a field after it
    // would move it and break pre-badge frames.
    const keys = Object.keys(ClientInfoSchema.shape);
    expect(keys[keys.length - 1]).toBe("levelBadge");
  });

  it.each<LevelBadge>([
    { level: 1, prestige: 0, legend: false },
    { level: 37, prestige: 2, legend: false },
    { level: 100, prestige: 10, legend: true },
  ])("round-trips a badge %o as one packed integer", (badge) => {
    const levelBadge = pack(badge);
    for (const base of [PLAIN, FULL]) {
      const entry = { ...base, levelBadge };
      const back = NewClientInfo.parseBytes(NewClientInfo.serialize(entry));
      expect(back).toEqual(entry);
      expect(unpackLevelBadge(back.levelBadge)).toEqual(badge);
    }
  });

  it("costs one byte per badge at prestige 0 and two at most", () => {
    const size = (levelBadge?: number) =>
      NewClientInfo.serialize({ ...PLAIN, levelBadge }).byteLength;
    const none = size();
    expect(size(pack({ level: 1, prestige: 0, legend: false })) - none).toBe(1);
    expect(size(pack({ level: 100, prestige: 0, legend: false })) - none).toBe(
      1,
    );
    expect(size(pack({ level: 1, prestige: 1, legend: false })) - none).toBe(2);
    expect(size(pack({ level: 100, prestige: 10, legend: true })) - none).toBe(
      2,
    );
  });

  it("round-trips an entry without one, leaving it absent", () => {
    for (const entry of [PLAIN, FULL]) {
      const back = NewClientInfo.parseBytes(NewClientInfo.serialize(entry));
      expect(back).toEqual(entry);
      expect(back.levelBadge).toBeUndefined();
    }
  });

  it("encodes an entry without a badge byte-identically to the pre-badge layout", () => {
    // The badge took the last free bit of the one-byte header; a second header
    // byte would change every entry, badge or not.
    for (const entry of [PLAIN, FULL]) {
      expect(NewClientInfo.serialize(entry)).toEqual(
        PreBadgeClientInfo.serialize(entry),
      );
    }
  });

  it("decodes an entry encoded before the badge existed", () => {
    for (const entry of [PLAIN, FULL]) {
      const old = PreBadgeClientInfo.serialize(entry);
      expect(NewClientInfo.parseBytes(old)).toEqual(entry);
    }
  });

  it("rejects a badge the codec cannot carry rather than mis-encoding it", () => {
    // Never reached in practice: the server only sends packLevelBadge output.
    for (const levelBadge of [1.5, -1]) {
      expect(() => NewClientInfo.serialize({ ...PLAIN, levelBadge })).toThrow();
    }
  });

  it("decodes a packed value no server sends, which the accessor then drops", () => {
    // The schema puts no range on the field, so one bad entry cannot fail
    // the whole roster's parse; unpackLevelBadge reads it as no badge.
    for (const levelBadge of [0, 101, 11 * 128 + 5, 4096 + 5, 2 ** 40]) {
      const back = NewClientInfo.parseBytes(
        NewClientInfo.serialize({ ...PLAIN, levelBadge }),
      );
      expect(back.levelBadge).toBe(levelBadge);
      expect(unpackLevelBadge(back.levelBadge)).toBeUndefined();
    }
  });

  it("carries badges through a full lobby_info frame", () => {
    const msg: ServerMessage = {
      type: "lobby_info",
      myClientID: "aB3dEf7h",
      lobby: {
        gameID: "gM3xQ1zR",
        serverTime: 1_700_000_000_000,
        clients: [
          {
            ...PLAIN,
            levelBadge: pack({ level: 12, prestige: 1, legend: false }),
          },
          FULL,
          {
            clientID: "Zz8wVu5t",
            username: "charlie",
            clanTag: null,
            levelBadge: pack({ level: 100, prestige: 10, legend: true }),
          },
        ],
      },
    };
    const back = decodeServerMessage(
      encodeServerMessage(msg, undefined),
      undefined,
    );
    expect(back).toEqual(msg);
  });
});

describe("a client cannot send itself a level", () => {
  const join = {
    type: "join" as const,
    token: "9f0f4b3a-0d2e-4a1f-8f0b-1c2d3e4f5a6b",
    gameID: "AbCd1234",
    username: "caster",
    clanTag: null,
    turnstileToken: null,
  };
  const spoofed = {
    ...join,
    levelBadge: { level: 100, prestige: 10, legend: true },
    level: 100,
    prestige: 10,
    legend: true,
  };

  it("the join schema strips level fields", () => {
    const parsed = ClientJoinMessageSchema.parse(spoofed) as Record<
      string,
      unknown
    >;
    for (const key of ["levelBadge", "level", "prestige", "legend"]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it("a join frame has no room for them: the server decodes none", () => {
    // What the server actually reads off the socket. The positional encoding
    // has no slot for a field the schema lacks, so it never leaves the client.
    const bytes = encodeClientMessage(spoofed as never, undefined);
    expect(bytes).toEqual(encodeClientMessage(join, undefined));
    const decoded = decodeClientMessage(bytes, undefined) as Record<
      string,
      unknown
    >;
    for (const key of ["levelBadge", "level", "prestige", "legend"]) {
      expect(decoded).not.toHaveProperty(key);
    }
  });
});
