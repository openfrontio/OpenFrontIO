import {
  AttackIntentSchema,
  BoatAttackIntentSchema,
  BuildUnitIntentSchema,
  CancelBoatIntentSchema,
  ClientHashSchema,
  ClientRejoinMessageSchema,
  DeleteUnitIntentSchema,
  DonateGoldIntentSchema,
  DonateTroopIntentSchema,
  MoveWarshipIntentSchema,
  SpawnIntentSchema,
  UpgradeStructureIntentSchema,
} from "../../src/core/Schemas";

describe("IntentSchemaHardening", () => {
  describe("SpawnIntentSchema", () => {
    it("accepts a valid tile integer", () => {
      expect(
        SpawnIntentSchema.safeParse({ type: "spawn", tile: 42 }).success,
      ).toBe(true);
    });

    it("rejects fractional tile numbers", () => {
      expect(
        SpawnIntentSchema.safeParse({ type: "spawn", tile: 42.5 }).success,
      ).toBe(false);
    });

    it("rejects negative tile numbers", () => {
      expect(
        SpawnIntentSchema.safeParse({ type: "spawn", tile: -1 }).success,
      ).toBe(false);
    });

    it("rejects unsafe floats/infinity", () => {
      expect(
        SpawnIntentSchema.safeParse({ type: "spawn", tile: 1e308 }).success,
      ).toBe(false);
    });
  });

  describe("AttackIntentSchema", () => {
    it("accepts a valid positive troops count", () => {
      expect(
        AttackIntentSchema.safeParse({
          type: "attack",
          targetID: "abc12345",
          troops: 100,
        }).success,
      ).toBe(true);
    });

    it("accepts null troops", () => {
      expect(
        AttackIntentSchema.safeParse({
          type: "attack",
          targetID: "abc12345",
          troops: null,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional troops", () => {
      expect(
        AttackIntentSchema.safeParse({
          type: "attack",
          targetID: "abc12345",
          troops: 10.5,
        }).success,
      ).toBe(false);
    });

    it("rejects negative troops", () => {
      expect(
        AttackIntentSchema.safeParse({
          type: "attack",
          targetID: "abc12345",
          troops: -5,
        }).success,
      ).toBe(false);
    });

    it("rejects unsafe float troops", () => {
      expect(
        AttackIntentSchema.safeParse({
          type: "attack",
          targetID: "abc12345",
          troops: 1e308,
        }).success,
      ).toBe(false);
    });
  });

  describe("BoatAttackIntentSchema", () => {
    it("accepts valid integer troops and dst", () => {
      expect(
        BoatAttackIntentSchema.safeParse({ type: "boat", troops: 50, dst: 100 })
          .success,
      ).toBe(true);
    });

    it("rejects fractional troops or dst", () => {
      expect(
        BoatAttackIntentSchema.safeParse({
          type: "boat",
          troops: 50.1,
          dst: 100,
        }).success,
      ).toBe(false);
      expect(
        BoatAttackIntentSchema.safeParse({
          type: "boat",
          troops: 50,
          dst: 100.5,
        }).success,
      ).toBe(false);
    });

    it("rejects negative troops or dst", () => {
      expect(
        BoatAttackIntentSchema.safeParse({
          type: "boat",
          troops: -10,
          dst: 100,
        }).success,
      ).toBe(false);
      expect(
        BoatAttackIntentSchema.safeParse({ type: "boat", troops: 50, dst: -1 })
          .success,
      ).toBe(false);
    });
  });

  describe("DonateGoldIntentSchema", () => {
    it("accepts valid gold amount", () => {
      expect(
        DonateGoldIntentSchema.safeParse({
          type: "donate_gold",
          recipient: "abc12345",
          gold: 1000,
        }).success,
      ).toBe(true);
      expect(
        DonateGoldIntentSchema.safeParse({
          type: "donate_gold",
          recipient: "abc12345",
          gold: null,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative gold", () => {
      expect(
        DonateGoldIntentSchema.safeParse({
          type: "donate_gold",
          recipient: "abc12345",
          gold: 100.5,
        }).success,
      ).toBe(false);
      expect(
        DonateGoldIntentSchema.safeParse({
          type: "donate_gold",
          recipient: "abc12345",
          gold: -100,
        }).success,
      ).toBe(false);
    });
  });

  describe("DonateTroopIntentSchema", () => {
    it("accepts valid troops amount", () => {
      expect(
        DonateTroopIntentSchema.safeParse({
          type: "donate_troops",
          recipient: "abc12345",
          troops: 100,
        }).success,
      ).toBe(true);
      expect(
        DonateTroopIntentSchema.safeParse({
          type: "donate_troops",
          recipient: "abc12345",
          troops: null,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative troops", () => {
      expect(
        DonateTroopIntentSchema.safeParse({
          type: "donate_troops",
          recipient: "abc12345",
          troops: 10.2,
        }).success,
      ).toBe(false);
      expect(
        DonateTroopIntentSchema.safeParse({
          type: "donate_troops",
          recipient: "abc12345",
          troops: -1,
        }).success,
      ).toBe(false);
    });
  });

  describe("BuildUnitIntentSchema", () => {
    it("accepts valid build unit intent", () => {
      expect(
        BuildUnitIntentSchema.safeParse({
          type: "build_unit",
          unit: "City",
          tile: 200,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative tile", () => {
      expect(
        BuildUnitIntentSchema.safeParse({
          type: "build_unit",
          unit: "City",
          tile: 200.7,
        }).success,
      ).toBe(false);
      expect(
        BuildUnitIntentSchema.safeParse({
          type: "build_unit",
          unit: "City",
          tile: -200,
        }).success,
      ).toBe(false);
    });
  });

  describe("UpgradeStructureIntentSchema", () => {
    it("accepts valid unitId", () => {
      expect(
        UpgradeStructureIntentSchema.safeParse({
          type: "upgrade_structure",
          unit: "City",
          unitId: 5,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative unitId", () => {
      expect(
        UpgradeStructureIntentSchema.safeParse({
          type: "upgrade_structure",
          unit: "City",
          unitId: 5.5,
        }).success,
      ).toBe(false);
      expect(
        UpgradeStructureIntentSchema.safeParse({
          type: "upgrade_structure",
          unit: "City",
          unitId: -5,
        }).success,
      ).toBe(false);
    });
  });

  describe("CancelBoatIntentSchema", () => {
    it("accepts valid unitID", () => {
      expect(
        CancelBoatIntentSchema.safeParse({ type: "cancel_boat", unitID: 15 })
          .success,
      ).toBe(true);
    });

    it("rejects fractional or negative unitID", () => {
      expect(
        CancelBoatIntentSchema.safeParse({ type: "cancel_boat", unitID: 15.2 })
          .success,
      ).toBe(false);
      expect(
        CancelBoatIntentSchema.safeParse({ type: "cancel_boat", unitID: -1 })
          .success,
      ).toBe(false);
    });
  });

  describe("MoveWarshipIntentSchema", () => {
    it("accepts valid unitIds array and tile", () => {
      expect(
        MoveWarshipIntentSchema.safeParse({
          type: "move_warship",
          unitIds: [1, 2, 3],
          tile: 450,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative elements in unitIds or tile", () => {
      expect(
        MoveWarshipIntentSchema.safeParse({
          type: "move_warship",
          unitIds: [1, 2.5, 3],
          tile: 450,
        }).success,
      ).toBe(false);
      expect(
        MoveWarshipIntentSchema.safeParse({
          type: "move_warship",
          unitIds: [1, -2, 3],
          tile: 450,
        }).success,
      ).toBe(false);
      expect(
        MoveWarshipIntentSchema.safeParse({
          type: "move_warship",
          unitIds: [1, 2, 3],
          tile: 450.1,
        }).success,
      ).toBe(false);
      expect(
        MoveWarshipIntentSchema.safeParse({
          type: "move_warship",
          unitIds: [1, 2, 3],
          tile: -450,
        }).success,
      ).toBe(false);
    });
  });

  describe("DeleteUnitIntentSchema", () => {
    it("accepts valid unitId", () => {
      expect(
        DeleteUnitIntentSchema.safeParse({ type: "delete_unit", unitId: 99 })
          .success,
      ).toBe(true);
    });

    it("rejects fractional or negative unitId", () => {
      expect(
        DeleteUnitIntentSchema.safeParse({ type: "delete_unit", unitId: 99.9 })
          .success,
      ).toBe(false);
      expect(
        DeleteUnitIntentSchema.safeParse({ type: "delete_unit", unitId: -99 })
          .success,
      ).toBe(false);
    });
  });

  describe("ClientRejoinMessageSchema", () => {
    it("accepts valid rejoin params", () => {
      expect(
        ClientRejoinMessageSchema.safeParse({
          type: "rejoin",
          gameID: "abc12345",
          lastTurn: 150,
          token: "00000000-0000-0000-0000-000000000000",
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative lastTurn", () => {
      expect(
        ClientRejoinMessageSchema.safeParse({
          type: "rejoin",
          gameID: "abc12345",
          lastTurn: 150.5,
          token: "00000000-0000-0000-0000-000000000000",
        }).success,
      ).toBe(false);

      expect(
        ClientRejoinMessageSchema.safeParse({
          type: "rejoin",
          gameID: "abc12345",
          lastTurn: -1,
          token: "00000000-0000-0000-0000-000000000000",
        }).success,
      ).toBe(false);
    });
  });

  describe("ClientHashSchema", () => {
    it("accepts valid hash and turnNumber", () => {
      expect(
        ClientHashSchema.safeParse({
          type: "hash",
          hash: 123456789,
          turnNumber: 50,
        }).success,
      ).toBe(true);
      expect(
        ClientHashSchema.safeParse({
          type: "hash",
          hash: -123456789,
          turnNumber: 50,
        }).success,
      ).toBe(true);
    });

    it("rejects fractional or negative turnNumber", () => {
      expect(
        ClientHashSchema.safeParse({
          type: "hash",
          hash: 123456789,
          turnNumber: 50.5,
        }).success,
      ).toBe(false);
      expect(
        ClientHashSchema.safeParse({
          type: "hash",
          hash: 123456789,
          turnNumber: -1,
        }).success,
      ).toBe(false);
    });

    it("rejects fractional hash", () => {
      expect(
        ClientHashSchema.safeParse({
          type: "hash",
          hash: 123456.789,
          turnNumber: 50,
        }).success,
      ).toBe(false);
    });
  });
});
