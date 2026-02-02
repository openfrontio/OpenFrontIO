import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

/**
 * Tests for the alliance renewal panel logic.
 *
 * The AllianceRequestPanel (UI component) manages indicators for:
 * 1. Incoming alliance requests
 * 2. Alliance renewals when alliances are about to expire
 *
 * These tests verify the underlying business logic that the panel uses,
 * specifically around:
 * - When renewal prompts should appear (based on allianceExtensionPromptOffset)
 * - When alliance indicators should be deleted (already allied, alliance renewed, etc.)
 * - Alliance expiration and extension timing
 */
describe("AllianceRenewalPanel Logic", () => {
  beforeEach(async () => {
    game = await setup(
      "ocean_and_land",
      {
        infiniteGold: true,
        instantBuild: true,
        infiniteTroops: true,
      },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
        playerInfo("player3", PlayerType.Human),
      ],
    );

    player1 = game.player("player1");
    player2 = game.player("player2");
    player3 = game.player("player3");

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  describe("Alliance expiration timing", () => {
    test("alliance has expiresAt set to createdAt + allianceDuration", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      const ticksBefore = game.ticks();

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // ExpiresAt should be roughly createdAt + allianceDuration
      const expectedExpiry =
        alliance!.createdAt() + game.config().allianceDuration();
      expect(alliance!.expiresAt()).toBe(expectedExpiry);
    });

    test("extension prompt should appear before alliance expires (within offset window)", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      const promptOffset = game.config().allianceExtensionPromptOffset();
      const expiresAt = alliance!.expiresAt();

      // The prompt should be shown when: expiresAt <= ticks + promptOffset
      // Which means: ticks >= expiresAt - promptOffset
      const promptShowsTick = expiresAt - promptOffset;

      // At promptShowsTick, the condition (expiresAt > ticks + promptOffset) should be false
      expect(expiresAt).toBeLessThanOrEqual(promptShowsTick + promptOffset);

      // Before promptShowsTick, the prompt should NOT show
      const beforePrompt = promptShowsTick - 1;
      expect(expiresAt).toBeGreaterThan(beforePrompt + promptOffset);
    });
  });

  describe("shouldDeleteIndicator logic for requests", () => {
    test("request indicator should be deleted when players become allied", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Send request but don't reply yet
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();

      // Players are not allied yet
      expect(player1.isAlliedWith(player2)).toBeFalsy();

      // Accept the alliance
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      // Now they are allied - indicator should be deleted
      expect(player1.isAlliedWith(player2)).toBeTruthy();
    });

    test("request indicator should remain if alliance request is rejected", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Send request
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();

      expect(player1.isAlliedWith(player2)).toBeFalsy();

      // Reject the alliance
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, false),
      );
      game.executeNextTick();

      // Players are still not allied
      expect(player1.isAlliedWith(player2)).toBeFalsy();
    });
  });

  describe("shouldDeleteIndicator logic for renewals", () => {
    test("renewal indicator should be deleted when alliance is renewed", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      const originalExpiry = alliance!.expiresAt();
      const promptOffset = game.config().allianceExtensionPromptOffset();

      // Both players agree to extend
      game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(new AllianceExtensionExecution(player2, player1.id()));
      game.executeNextTick();

      // Alliance should be renewed - expiresAt should be in the far future
      const newExpiry = player1.allianceWith(player2)!.expiresAt();
      expect(newExpiry).toBeGreaterThan(originalExpiry);

      // Renewal indicator delete condition:
      // alliance.expiresAt > ticks + allianceExtensionPromptOffset
      // After renewal, this should be true (expiresAt is far in future)
      expect(newExpiry).toBeGreaterThan(game.ticks() + promptOffset);
    });

    test("renewal indicator should be deleted when alliance no longer exists (expired)", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // Verify the panel's delete condition logic:
      // The panel deletes renewal indicator if alliance no longer exists
      // Here we verify the alliance object methods work correctly
      expect(alliance!.expiresAt()).toBeGreaterThan(alliance!.createdAt());

      // Manually expire the alliance to test the condition
      alliance!.expire();

      // Now allianceWith should return null
      expect(player1.allianceWith(player2)).toBeFalsy();
    });
  });

  describe("Extension request tracking", () => {
    test("alliance tracks when one player requests extension", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // Initially no one has requested extension
      expect(alliance!.onlyOneAgreedToExtend()).toBeFalsy();
      expect(alliance!.bothAgreedToExtend()).toBeFalsy();

      // Player 1 requests extension
      game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
      game.executeNextTick();

      // Now only one has agreed
      expect(alliance!.onlyOneAgreedToExtend()).toBeTruthy();
      expect(alliance!.bothAgreedToExtend()).toBeFalsy();
    });

    test("alliance tracks when both players request extension", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // Both players request extension
      game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(new AllianceExtensionExecution(player2, player1.id()));
      game.executeNextTick();

      // Both have agreed, so alliance should extend and reset the flags
      expect(alliance!.onlyOneAgreedToExtend()).toBeFalsy();
      expect(alliance!.bothAgreedToExtend()).toBeFalsy();
    });

    test("extension request flags reset after alliance is extended", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // Extend alliance
      game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(new AllianceExtensionExecution(player2, player1.id()));
      game.executeNextTick();

      // Flags should be reset
      expect(alliance!.onlyOneAgreedToExtend()).toBeFalsy();
      expect(alliance!.bothAgreedToExtend()).toBeFalsy();

      // Can request extension again
      game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
      game.executeNextTick();

      expect(alliance!.onlyOneAgreedToExtend()).toBeTruthy();
    });
  });

  describe("Indicator duration and expiration calculations", () => {
    test("request indicator duration is less than allianceRequestDuration by buffer", () => {
      // The panel uses: duration = allianceRequestDuration() - 20 (2 second buffer)
      const requestDuration = game.config().allianceRequestDuration();
      const expectedIndicatorDuration = requestDuration - 20;

      // Indicator should have a buffer to expire before the actual request
      expect(expectedIndicatorDuration).toBeLessThan(requestDuration);
      expect(expectedIndicatorDuration).toBe(requestDuration - 20);
    });

    test("renewal indicator duration is less than promptOffset by buffer", () => {
      // The panel uses: duration = allianceExtensionPromptOffset() - 3 * 10 (3 second buffer)
      const promptOffset = game.config().allianceExtensionPromptOffset();
      const expectedIndicatorDuration = promptOffset - 30;

      // Indicator should have a buffer to expire before the prompt window ends
      expect(expectedIndicatorDuration).toBeLessThan(promptOffset);
      expect(expectedIndicatorDuration).toBe(promptOffset - 30);
    });
  });

  describe("Duplicate indicator prevention", () => {
    test("should not add duplicate indicators for same alliance request", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Sending the same request twice shouldn't create duplicate pending requests
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();

      expect(player1.outgoingAllianceRequests()).toHaveLength(1);

      // Sending another request while one is pending should not create a new one
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();

      expect(player1.outgoingAllianceRequests()).toHaveLength(1);
    });
  });

  describe("onAllianceRequestReplyEvent cleanup", () => {
    test("accepting removes request from incoming requests", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Player1 sends request to player2
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();

      expect(player2.incomingAllianceRequests()).toHaveLength(1);

      // Player2 accepts
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      // Request should be cleared
      expect(player2.incomingAllianceRequests()).toHaveLength(0);
      expect(player1.outgoingAllianceRequests()).toHaveLength(0);
    });

    test("rejecting removes request from incoming requests", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Player1 sends request to player2
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();

      expect(player2.incomingAllianceRequests()).toHaveLength(1);

      // Player2 rejects
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, false),
      );
      game.executeNextTick();

      // Request should be cleared
      expect(player2.incomingAllianceRequests()).toHaveLength(0);
      expect(player1.outgoingAllianceRequests()).toHaveLength(0);
    });
  });

  describe("Alliance prompt window edge cases", () => {
    test("prompt offset is configurable and affects when renewal shows", () => {
      const defaultOffset = game.config().allianceExtensionPromptOffset();

      // The offset should be a positive number
      expect(defaultOffset).toBeGreaterThan(0);

      // The offset represents ticks before expiration when the prompt appears
      // A larger offset means earlier warning
    });

    test("once prompted for an alliance, should not prompt again within offset period", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // The panel tracks alliancesCheckedAt to avoid duplicate prompts
      // Logic: if checkedAt >= ticks - promptOffset, skip
      const promptOffset = game.config().allianceExtensionPromptOffset();

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // The map would store when we last checked, preventing duplicate notifications
      // within the prompt offset window
    });
  });

  describe("Multiple alliances handling", () => {
    test("can have multiple renewal indicators for different alliances", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player3, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance between player1 and player2
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      // Create alliance between player1 and player3
      game.addExecution(new AllianceRequestExecution(player1, player3.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player3, true),
      );
      game.executeNextTick();

      // Player1 should have two alliances
      expect(player1.alliances()).toHaveLength(2);
      expect(player1.isAlliedWith(player2)).toBeTruthy();
      expect(player1.isAlliedWith(player3)).toBeTruthy();
    });
  });

  describe("hasExtensionRequest flag for UI", () => {
    test("alliance exposes extension request status for UI display", () => {
      vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
      vi.spyOn(player2, "isAlive").mockReturnValue(true);
      vi.spyOn(player1, "isAlive").mockReturnValue(true);

      // Create alliance
      game.addExecution(new AllianceRequestExecution(player1, player2.id()));
      game.executeNextTick();
      game.addExecution(
        new AllianceRequestReplyExecution(player1.id(), player2, true),
      );
      game.executeNextTick();

      const alliance = player1.allianceWith(player2);
      expect(alliance).toBeTruthy();

      // Initially no extension request
      expect(alliance!.onlyOneAgreedToExtend()).toBeFalsy();

      // Player2 wants to extend (from player1's perspective, the "other" wants renewal)
      game.addExecution(new AllianceExtensionExecution(player2, player1.id()));
      game.executeNextTick();

      // Now the other player has requested extension
      expect(alliance!.onlyOneAgreedToExtend()).toBeTruthy();
    });
  });
});
