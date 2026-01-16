import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameServer } from "../../src/server/GameServer";
import { GameType } from "../../src/core/game/Game";
import { GameEnv } from "../../src/core/configuration/Config";

describe("GameLifecycle", () => {
    let mockLogger: any;
    let mockConfig: any;

    beforeEach(() => {
        vi.useFakeTimers();
        mockLogger = {
            child: vi.fn().mockReturnThis(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        mockConfig = {
            turnIntervalMs: () => 100,
            gameCreationRate: () => 1000,
            env: () => GameEnv.Dev,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllTimers();
    });

    it("should not start turn interval if game has ended", async () => {
        const game = new GameServer(
            "test-game",
            mockLogger,
            Date.now(),
            mockConfig,
            { gameType: GameType.Private } as any
        );

        // Call end() first - this should set _hasEnded
        await game.end();

        // Now call start() - this should be a no-op due to our fix
        game.start();

        // Check if the interval ID is set (it shouldn't be)
        expect((game as any).endTurnIntervalID).toBeUndefined();

        // Check if _hasStarted remained false (or at least no interval was created)
        expect(game.hasStarted()).toBe(false);
    });

    it("should clear turn interval and set _hasEnded on end()", async () => {
        // We need to initialize the game such that start() can succeed
        const game = new GameServer(
            "test-game",
            mockLogger,
            Date.now(),
            mockConfig,
            {
                gameType: GameType.Private,
                gameMap: "plains",
                gameMapSize: 100,
            } as any
        );

        // Manually trigger prestart to fulfill some internal checks if necessary
        game.prestart();

        // start() should create the interval
        game.start();
        expect((game as any).endTurnIntervalID).toBeDefined();

        // end() should clear it
        await game.end();
        expect((game as any).endTurnIntervalID).toBeUndefined();
        expect((game as any)._hasEnded).toBe(true);
    });

    it("should be resilient to multiple end() calls", async () => {
        const game = new GameServer(
            "test-game",
            mockLogger,
            Date.now(),
            mockConfig,
            { gameType: GameType.Private } as any
        );

        await game.end();
        expect((game as any)._hasEnded).toBe(true);

        // Should not throw or crash
        await expect(game.end()).resolves.toBeUndefined();
        expect((game as any)._hasEnded).toBe(true);
    });
});
