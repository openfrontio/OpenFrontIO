import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ClanTagSchema,
  ClientInfo,
  ClientInfoSchema,
  ClientJoinMessageSchema,
  ServerMessage,
  UsernameSchema,
} from "../../src/core/Schemas";
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";
import { zb } from "../../zbin";

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
  it.each([
    { level: 1, prestige: 0, legend: false },
    { level: 37, prestige: 2, legend: false },
    { level: 100, prestige: 10, legend: true },
  ])("round-trips a badge %o", (levelBadge) => {
    for (const base of [PLAIN, FULL]) {
      const entry = { ...base, levelBadge };
      expect(NewClientInfo.parseBytes(NewClientInfo.serialize(entry))).toEqual(
        entry,
      );
    }
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
    // The server sanitises API values before stamping (levelBadgeFromProgress)
    // because of this: an invalid badge throws out of the whole broadcast.
    expect(() =>
      NewClientInfo.serialize({
        ...PLAIN,
        levelBadge: { level: 1.5, prestige: 0, legend: false },
      }),
    ).toThrow();
  });

  it("carries badges through a full lobby_info frame", () => {
    const msg: ServerMessage = {
      type: "lobby_info",
      myClientID: "aB3dEf7h",
      lobby: {
        gameID: "gM3xQ1zR",
        serverTime: 1_700_000_000_000,
        clients: [
          { ...PLAIN, levelBadge: { level: 12, prestige: 1, legend: false } },
          FULL,
          {
            clientID: "Zz8wVu5t",
            username: "charlie",
            clanTag: null,
            levelBadge: { level: 100, prestige: 10, legend: true },
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
