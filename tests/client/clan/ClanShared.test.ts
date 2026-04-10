import { describe, expect, it } from "vitest";
import type { ClanJoinRequest, ClanMember } from "../../../src/client/ClanApi";
import {
  filterMembersBySearch,
  filterRequestsBySearch,
} from "../../../src/client/components/clan/ClanShared";

const members: ClanMember[] = [
  { publicId: "Alice123", role: "leader", joinedAt: "2024-01-01T00:00:00Z" },
  { publicId: "Bob456", role: "officer", joinedAt: "2024-02-01T00:00:00Z" },
  { publicId: "Charlie789", role: "member", joinedAt: "2024-03-01T00:00:00Z" },
];

const requests: ClanJoinRequest[] = [
  { publicId: "Dave111", createdAt: "2024-04-01T00:00:00Z" },
  { publicId: "Eve222", createdAt: "2024-05-01T00:00:00Z" },
];

describe("filterMembersBySearch", () => {
  it("returns all members when search is empty", () => {
    expect(filterMembersBySearch(members, "")).toEqual(members);
  });

  it("matches by publicId (case-insensitive)", () => {
    const result = filterMembersBySearch(members, "alice");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Alice123");
  });

  it("matches by role", () => {
    const result = filterMembersBySearch(members, "officer");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Bob456");
  });

  it("matches partial publicId", () => {
    const result = filterMembersBySearch(members, "456");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Bob456");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterMembersBySearch(members, "zzz")).toEqual([]);
  });

  it("matches 'member' role without matching 'leader' or 'officer'", () => {
    const result = filterMembersBySearch(members, "member");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Charlie789");
  });
});

describe("filterRequestsBySearch", () => {
  it("returns all requests when search is empty", () => {
    expect(filterRequestsBySearch(requests, "")).toEqual(requests);
  });

  it("matches by publicId (case-insensitive)", () => {
    const result = filterRequestsBySearch(requests, "dave");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Dave111");
  });

  it("matches partial publicId", () => {
    const result = filterRequestsBySearch(requests, "222");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Eve222");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterRequestsBySearch(requests, "zzz")).toEqual([]);
  });
});
