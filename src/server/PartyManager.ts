import { customAlphabet } from "nanoid";
import { Logger } from "winston";

// Generate 6-character party codes using alphanumeric characters (excluding confusing ones)
const generatePartyCode = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);

export interface PartyMember {
  persistentID: string;
  username: string;
  joinedAt: number;
}

export interface Party {
  code: string;
  leaderPersistentID: string;
  members: Map<string, PartyMember>;
  createdAt: number;
  lastActivity: number;
}

export class PartyManager {
  private parties: Map<string, Party> = new Map();
  private memberToParty: Map<string, string> = new Map();
  private readonly PARTY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_PARTY_SIZE = 4;

  constructor(private log: Logger) {
    // Clean up inactive parties every 5 minutes
    setInterval(() => this.cleanupInactiveParties(), 5 * 60 * 1000);
  }

  createParty(leaderPersistentID: string, username: string): Party {
    // Leave existing party if in one
    this.leaveParty(leaderPersistentID);

    const code = generatePartyCode();
    const party: Party = {
      code,
      leaderPersistentID,
      members: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    party.members.set(leaderPersistentID, {
      persistentID: leaderPersistentID,
      username,
      joinedAt: Date.now(),
    });

    this.parties.set(code, party);
    this.memberToParty.set(leaderPersistentID, code);

    this.log.info(`Party created: ${code} by ${username}`);
    return party;
  }

  joinParty(
    code: string,
    persistentID: string,
    username: string,
  ): { success: boolean; error?: string; party?: Party } {
    const normalizedCode = code.toUpperCase().trim();
    const party = this.parties.get(normalizedCode);

    if (!party) {
      return { success: false, error: "Party not found" };
    }

    if (party.members.size >= this.MAX_PARTY_SIZE) {
      return { success: false, error: "Party is full" };
    }

    // Leave existing party if in one
    this.leaveParty(persistentID);

    party.members.set(persistentID, {
      persistentID,
      username,
      joinedAt: Date.now(),
    });
    party.lastActivity = Date.now();
    this.memberToParty.set(persistentID, normalizedCode);

    this.log.info(`${username} joined party ${normalizedCode}`);
    return { success: true, party };
  }

  leaveParty(persistentID: string): boolean {
    const partyCode = this.memberToParty.get(persistentID);
    if (!partyCode) {
      return false;
    }

    const party = this.parties.get(partyCode);
    if (!party) {
      this.memberToParty.delete(persistentID);
      return false;
    }

    party.members.delete(persistentID);
    this.memberToParty.delete(persistentID);
    party.lastActivity = Date.now();

    this.log.info(`Player ${persistentID} left party ${partyCode}`);

    // If party is empty or leader left, disband the party
    if (party.members.size === 0 || persistentID === party.leaderPersistentID) {
      this.disbandParty(partyCode);
    } else if (party.members.size > 0) {
      // Assign new leader if current leader left
      const newLeader = Array.from(party.members.values())[0];
      party.leaderPersistentID = newLeader.persistentID;
      this.log.info(`New party leader for ${partyCode}: ${newLeader.username}`);
    }

    return true;
  }

  getParty(code: string): Party | null {
    return this.parties.get(code.toUpperCase().trim()) ?? null;
  }

  getPartyByMember(persistentID: string): Party | null {
    const partyCode = this.memberToParty.get(persistentID);
    if (!partyCode) {
      return null;
    }
    return this.parties.get(partyCode) ?? null;
  }

  getPartyMembers(code: string): PartyMember[] {
    const party = this.getParty(code);
    if (!party) {
      return [];
    }
    return Array.from(party.members.values());
  }

  private disbandParty(code: string): void {
    const party = this.parties.get(code);
    if (!party) {
      return;
    }

    // Remove all member mappings
    for (const persistentID of party.members.keys()) {
      this.memberToParty.delete(persistentID);
    }

    this.parties.delete(code);
    this.log.info(`Party ${code} disbanded`);
  }

  private cleanupInactiveParties(): void {
    const now = Date.now();
    const partyCodes = Array.from(this.parties.keys());

    for (const code of partyCodes) {
      const party = this.parties.get(code);
      if (party && now - party.lastActivity > this.PARTY_TIMEOUT_MS) {
        this.log.info(`Cleaning up inactive party ${code}`);
        this.disbandParty(code);
      }
    }
  }

  updateActivity(persistentID: string): void {
    const party = this.getPartyByMember(persistentID);
    if (party) {
      party.lastActivity = Date.now();
    }
  }

  isPartyLeader(persistentID: string): boolean {
    const party = this.getPartyByMember(persistentID);
    return party?.leaderPersistentID === persistentID;
  }

  getPartySize(code: string): number {
    const party = this.getParty(code);
    return party?.members.size ?? 0;
  }

  getAllPartyMemberIDs(persistentID: string): string[] {
    const party = this.getPartyByMember(persistentID);
    if (!party) {
      return [persistentID];
    }
    return Array.from(party.members.keys());
  }
}
