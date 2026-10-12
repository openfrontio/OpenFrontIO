import {
  LEVEL_BADGE_MAX_LEVEL,
  LEVEL_BADGE_MAX_PRESTIGE,
  LevelBadge,
  packLevelBadge,
  unpackLevelBadge,
} from "@openfront/shared/LevelBadgeWire";
import { ClientInfoSchema } from "@openfront/shared/WireSchemas";
import { zb } from "@openfront/zbin";
import { describe, expect, it } from "vitest";

// The roster carries a badge as one packed integer: level in bits 0-6,
// prestige in bits 7-10, legend in bit 11.

// Bytes a packed badge adds to a roster entry (its presence bit is in the
// header byte the entry has anyway).
const Entry = zb.object(ClientInfoSchema.shape);
const BASE = { clientID: "aB3dEf7h", username: "alpha", clanTag: null };
const varintBytes = (levelBadge: number) =>
  Entry.serialize({ ...BASE, levelBadge }).byteLength -
  Entry.serialize(BASE).byteLength;

describe("packLevelBadge / unpackLevelBadge", () => {
  it.each<[LevelBadge, number]>([
    [{ level: 1, prestige: 0, legend: false }, 1],
    [{ level: 100, prestige: 0, legend: false }, 100],
    [{ level: 1, prestige: 1, legend: false }, 129],
    [{ level: 37, prestige: 2, legend: false }, 37 + 2 * 128],
    [{ level: 100, prestige: 10, legend: false }, 100 + 10 * 128],
    [{ level: 100, prestige: 10, legend: true }, 100 + 10 * 128 + 2048],
  ])("packs %o as %i and back", (badge, packed) => {
    expect(packLevelBadge(badge)).toBe(packed);
    expect(unpackLevelBadge(packed)).toEqual(badge);
  });

  it("round-trips every level and prestige, with and without legend", () => {
    for (let prestige = 0; prestige <= LEVEL_BADGE_MAX_PRESTIGE; prestige++) {
      for (let level = 1; level <= LEVEL_BADGE_MAX_LEVEL; level++) {
        for (const legend of [false, true]) {
          const badge = { level, prestige, legend };
          expect(unpackLevelBadge(packLevelBadge(badge))).toEqual(badge);
        }
      }
    }
  });

  it("is one varint byte at prestige 0 and two at most", () => {
    expect(
      varintBytes(packLevelBadge({ level: 1, prestige: 0, legend: false })!),
    ).toBe(1);
    expect(
      varintBytes(packLevelBadge({ level: 100, prestige: 0, legend: false })!),
    ).toBe(1);
    expect(
      varintBytes(packLevelBadge({ level: 1, prestige: 1, legend: false })!),
    ).toBe(2);
    expect(
      varintBytes(packLevelBadge({ level: 100, prestige: 10, legend: true })!),
    ).toBe(2);
  });

  it("packs nothing it cannot represent", () => {
    for (const bad of [
      { level: 0, prestige: 0, legend: false },
      { level: 101, prestige: 0, legend: false },
      { level: 128, prestige: 0, legend: false },
      { level: -1, prestige: 0, legend: false },
      { level: 12.5, prestige: 0, legend: false },
      { level: Number.NaN, prestige: 0, legend: false },
      { level: 1, prestige: -1, legend: false },
      { level: 1, prestige: 11, legend: false },
      { level: 1, prestige: 16, legend: false },
      { level: 1, prestige: 1.5, legend: false },
      { level: 1, prestige: 0, legend: "yes" as unknown as boolean },
    ]) {
      expect(packLevelBadge(bad)).toBeUndefined();
    }
    expect(packLevelBadge(undefined)).toBeUndefined();
  });

  it("decodes values no server sends as no badge, without throwing", () => {
    for (const bad of [
      0, // level 0
      101, // level 101
      127, // level 127
      128, // prestige 1, level 0
      11 * 128 + 5, // prestige 11
      15 * 128 + 5, // prestige 15
      2048, // legend alone, level 0
      4096 + 5, // a reserved bit
      2 ** 40, // far out of range
      -1,
      1.5,
      Number.NaN,
    ]) {
      expect(unpackLevelBadge(bad)).toBeUndefined();
    }
    expect(unpackLevelBadge(undefined)).toBeUndefined();
  });
});
