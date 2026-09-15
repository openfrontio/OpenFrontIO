import { describe, expect, it } from "vitest";
import { PoolConfig } from "../../src/core/Schemas";
import { poolIndexFor, poolTargetFor } from "../../src/server/PoolRouting";

const SIBLINGS = ["aaaa1111", "bbbb2222", "cccc3333", "dddd4444"];

// Every member of a pool holds this same object; they differ only in which id
// each one answers to.
const POOL: PoolConfig = { id: "pool-1", siblings: SIBLINGS };

describe("poolIndexFor", () => {
  it("stays inside the pool for any key", () => {
    for (let i = 0; i < 200; i++) {
      const index = poolIndexFor(`key-${i}`, 4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
  });

  it("gives the same key the same answer every time", () => {
    expect(poolIndexFor("player-abc", 7)).toBe(poolIndexFor("player-abc", 7));
  });

  it("puts everyone in the only member of a pool of one", () => {
    for (const key of ["a", "player-abc", ""]) {
      expect(poolIndexFor(key, 1)).toBe(0);
    }
  });

  it("spreads keys across every member", () => {
    const hits = new Set<number>();
    for (let i = 0; i < 200; i++) {
      hits.add(poolIndexFor(`player-${i}`, 4));
    }
    expect([...hits].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("poolTargetFor", () => {
  it("agrees with poolIndexFor about where a key belongs", () => {
    const key = "player-abc";
    const index = poolIndexFor(`pool-1:${key}`, SIBLINGS.length);
    // Asked from every member in turn, the answer is that member's id —
    // except from the one it belongs to, which says "stay".
    SIBLINGS.forEach((selfId, i) => {
      const target = poolTargetFor(POOL, key, selfId);
      expect(target).toBe(i === index ? null : SIBLINGS[index]);
    });
  });

  it("returns null — stay here — exactly once per key", () => {
    for (let i = 0; i < 50; i++) {
      const stays = SIBLINGS.map((selfId) =>
        poolTargetFor(POOL, `player-${i}`, selfId),
      ).filter((target) => target === null);
      expect(stays).toHaveLength(1);
    }
  });

  it("sends a key to the same member however it arrives", () => {
    // This is what makes a rejoin land back where the player already was: the
    // assignment is read off the key, not off which member was asked.
    const key = "player-abc";
    const answers = SIBLINGS.map(
      (selfId) => poolTargetFor(POOL, key, selfId) ?? selfId,
    );
    expect(new Set(answers).size).toBe(1);
  });

  it("decorrelates pools of the same size through the pool id", () => {
    // Without the id in the key, every pool of size 4 would send the same
    // people to slot 0.
    const other: PoolConfig = { id: "pool-2", siblings: SIBLINGS };
    const moved = Array.from({ length: 50 }, (_, i) => `player-${i}`).filter(
      (key) =>
        poolTargetFor(POOL, key, SIBLINGS[0]) !==
        poolTargetFor(other, key, SIBLINGS[0]),
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it("keeps everyone put in a pool of one", () => {
    const solo: PoolConfig = { id: "pool-1", siblings: ["aaaa1111"] };
    expect(poolTargetFor(solo, "player-abc", "aaaa1111")).toBeNull();
  });

  it("keeps everyone put when the pool has no members", () => {
    const empty: PoolConfig = { id: "pool-1", siblings: [] };
    expect(poolTargetFor(empty, "player-abc", "aaaa1111")).toBeNull();
  });

  it("stays put when the pool lists this lobby twice", () => {
    // The answer is compared against this lobby's own id, so a duplicated
    // entry cannot send a player to the lobby they are already talking to.
    const dup: PoolConfig = {
      id: "pool-1",
      siblings: ["aaaa1111", "aaaa1111"],
    };
    for (let i = 0; i < 20; i++) {
      expect(poolTargetFor(dup, `player-${i}`, "aaaa1111")).toBeNull();
    }
  });

  it("sends everyone away from a lobby that is not in its own pool", () => {
    // The one misconfiguration left, and it is self-announcing: a member that
    // does not list itself keeps nobody.
    for (let i = 0; i < 20; i++) {
      expect(poolTargetFor(POOL, `player-${i}`, "eeee5555")).not.toBeNull();
    }
  });
});
