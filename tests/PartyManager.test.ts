import { Logger } from "winston";
import { PartyManager } from "../src/server/PartyManager";

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as any;

describe("PartyManager", () => {
  let partyManager: PartyManager;

  beforeEach(() => {
    partyManager = new PartyManager(mockLogger);
    jest.clearAllMocks();
  });

  describe("createParty", () => {
    test("should create a new party with a unique code", () => {
      const party = partyManager.createParty("player1", "Alice");

      expect(party).toBeDefined();
      expect(party.code).toHaveLength(6);
      expect(party.leaderPersistentID).toBe("player1");
      expect(party.members.size).toBe(1);
      expect(party.members.get("player1")?.username).toBe("Alice");
      expect(party.isQueueing).toBe(false);
      expect(party.queueStartedAt).toBeNull();
    });

    test("should leave existing party when creating a new one", () => {
      const party1 = partyManager.createParty("player1", "Alice");
      const party2 = partyManager.createParty("player1", "Alice");

      expect(party1.code).not.toBe(party2.code);
      expect(partyManager.getParty(party1.code)).toBeNull();
      expect(partyManager.getParty(party2.code)).toBeDefined();
    });
  });

  describe("joinParty", () => {
    test("should allow a player to join an existing party", () => {
      const party = partyManager.createParty("player1", "Alice");
      const result = partyManager.joinParty(party.code, "player2", "Bob");

      expect(result.success).toBe(true);
      expect(result.party?.members.size).toBe(2);
      expect(result.party?.members.get("player2")?.username).toBe("Bob");
    });

    test("should return error when joining non-existent party", () => {
      const result = partyManager.joinParty("INVALID", "player1", "Alice");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Party not found");
    });

    test("should return error when party is full", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");
      partyManager.joinParty(party.code, "player3", "Charlie");
      partyManager.joinParty(party.code, "player4", "David");

      const result = partyManager.joinParty(party.code, "player5", "Eve");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Party is full");
    });

    test("should leave existing party when joining a new one", () => {
      const party1 = partyManager.createParty("player1", "Alice");
      const party2 = partyManager.createParty("player2", "Bob");

      partyManager.joinParty(party1.code, "player3", "Charlie");
      partyManager.joinParty(party2.code, "player3", "Charlie");

      expect(partyManager.getParty(party1.code)?.members.size).toBe(1);
      expect(partyManager.getParty(party2.code)?.members.size).toBe(2);
    });
  });

  describe("leaveParty", () => {
    test("should allow a player to leave a party", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      const result = partyManager.leaveParty("player2");

      expect(result).toBe(true);
      expect(partyManager.getParty(party.code)?.members.size).toBe(1);
    });

    test("should disband party when leader leaves", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      partyManager.leaveParty("player1");

      expect(partyManager.getParty(party.code)).toBeNull();
    });

    test("should disband party when last member leaves", () => {
      const party = partyManager.createParty("player1", "Alice");

      partyManager.leaveParty("player1");

      expect(partyManager.getParty(party.code)).toBeNull();
    });

    test("should return false when player is not in a party", () => {
      const result = partyManager.leaveParty("player1");

      expect(result).toBe(false);
    });
  });

  describe("getParty", () => {
    test("should retrieve a party by code", () => {
      const party = partyManager.createParty("player1", "Alice");
      const retrieved = partyManager.getParty(party.code);

      expect(retrieved).toBeDefined();
      expect(retrieved?.code).toBe(party.code);
    });

    test("should return null for non-existent party", () => {
      const retrieved = partyManager.getParty("INVALID");

      expect(retrieved).toBeNull();
    });
  });

  describe("getPartyByMember", () => {
    test("should retrieve a party by member ID", () => {
      const party = partyManager.createParty("player1", "Alice");
      const retrieved = partyManager.getPartyByMember("player1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.code).toBe(party.code);
    });

    test("should return null when player is not in a party", () => {
      const retrieved = partyManager.getPartyByMember("player1");

      expect(retrieved).toBeNull();
    });
  });

  describe("getPartyMembers", () => {
    test("should return all members of a party", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      const members = partyManager.getPartyMembers(party.code);

      expect(members).toHaveLength(2);
      expect(members.find((m) => m.persistentID === "player1")).toBeDefined();
      expect(members.find((m) => m.persistentID === "player2")).toBeDefined();
    });

    test("should return empty array for non-existent party", () => {
      const members = partyManager.getPartyMembers("INVALID");

      expect(members).toEqual([]);
    });
  });

  describe("isPartyLeader", () => {
    test("should return true for party leader", () => {
      partyManager.createParty("player1", "Alice");

      expect(partyManager.isPartyLeader("player1")).toBe(true);
    });

    test("should return false for non-leader member", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      expect(partyManager.isPartyLeader("player2")).toBe(false);
    });

    test("should return false for player not in a party", () => {
      expect(partyManager.isPartyLeader("player1")).toBe(false);
    });
  });

  describe("getPartySize", () => {
    test("should return the correct party size", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      expect(partyManager.getPartySize(party.code)).toBe(2);
    });

    test("should return 0 for non-existent party", () => {
      expect(partyManager.getPartySize("INVALID")).toBe(0);
    });
  });

  describe("getAllPartyMemberIDs", () => {
    test("should return all member IDs in a party", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      const memberIDs = partyManager.getAllPartyMemberIDs("player1");

      expect(memberIDs).toHaveLength(2);
      expect(memberIDs).toContain("player1");
      expect(memberIDs).toContain("player2");
    });

    test("should return only the player ID when not in a party", () => {
      const memberIDs = partyManager.getAllPartyMemberIDs("player1");

      expect(memberIDs).toEqual(["player1"]);
    });
  });

  describe("updateActivity", () => {
    test("should update party activity timestamp", () => {
      const party = partyManager.createParty("player1", "Alice");
      const initialActivity = party.lastActivity;

      // Wait a bit to ensure timestamp changes
      jest.advanceTimersByTime(1000);
      partyManager.updateActivity("player1");

      const updatedParty = partyManager.getParty(party.code);
      expect(updatedParty?.lastActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe("queueing", () => {
    test("should allow party leader to start queueing", () => {
      const party = partyManager.createParty("player1", "Alice");

      const success = partyManager.startQueueing("player1");

      expect(success).toBe(true);
      const updatedParty = partyManager.getParty(party.code);
      expect(updatedParty?.isQueueing).toBe(true);
      expect(updatedParty?.queueStartedAt).toBeDefined();
      expect(updatedParty?.queueStartedAt).toBeGreaterThan(0);
    });

    test("should not allow non-leader to start queueing", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.joinParty(party.code, "player2", "Bob");

      const success = partyManager.startQueueing("player2");

      expect(success).toBe(false);
      const updatedParty = partyManager.getParty(party.code);
      expect(updatedParty?.isQueueing).toBe(false);
    });

    test("should allow stopping queueing", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.startQueueing("player1");

      const success = partyManager.stopQueueing("player1");

      expect(success).toBe(true);
      const updatedParty = partyManager.getParty(party.code);
      expect(updatedParty?.isQueueing).toBe(false);
      expect(updatedParty?.queueStartedAt).toBeNull();
    });

    test("should check if party is queueing", () => {
      const party = partyManager.createParty("player1", "Alice");

      expect(partyManager.isQueueing(party.code)).toBe(false);

      partyManager.startQueueing("player1");
      expect(partyManager.isQueueing(party.code)).toBe(true);

      partyManager.stopQueueing("player1");
      expect(partyManager.isQueueing(party.code)).toBe(false);
    });

    test("should return false when starting queue for non-existent party", () => {
      const success = partyManager.startQueueing("nonexistent");
      expect(success).toBe(false);
    });

    test("should return false when stopping queue for non-existent party", () => {
      const success = partyManager.stopQueueing("nonexistent");
      expect(success).toBe(false);
    });

    test("should update activity when starting queueing", () => {
      const party = partyManager.createParty("player1", "Alice");
      const initialActivity = party.lastActivity;

      jest.advanceTimersByTime(1000);
      partyManager.startQueueing("player1");

      const updatedParty = partyManager.getParty(party.code);
      expect(updatedParty?.lastActivity).toBeGreaterThan(initialActivity);
    });

    test("should update activity when stopping queueing", () => {
      const party = partyManager.createParty("player1", "Alice");
      partyManager.startQueueing("player1");

      jest.advanceTimersByTime(1000);
      const beforeStop = party.lastActivity;

      partyManager.stopQueueing("player1");

      const updatedParty = partyManager.getParty(party.code);
      expect(updatedParty?.lastActivity).toBeGreaterThan(beforeStop);
    });
  });
});
