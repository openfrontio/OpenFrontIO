import { createLogger, transports } from "winston";
import { GameManager } from "../../../src/server/GameManager";
import { RankedCoordinator } from "../../../src/server/ranked/RankedCoordinator";
import { RankedMode, RankedRegion } from "../../../src/server/ranked/types";

const logger = createLogger({
  level: "error",
  transports: [new transports.Console({ silent: true })],
});

describe("RankedCoordinator", () => {
  it("requires accept before creating a game", async () => {
    const createdGames: Array<{ id: string }> = [];
    const fakeGameManager = {
      createGame: jest.fn((id: string) => {
        createdGames.push({ id });
        return {} as unknown as ReturnType<GameManager["createGame"]>;
      }),
    } as unknown as GameManager;

    const coordinator = new RankedCoordinator(fakeGameManager, logger, null);
    await coordinator.initialize();

    const first = await coordinator.join({
      playerId: "PLAYER_1",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });
    const second = await coordinator.join({
      playerId: "PLAYER_2",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });

    expect(createdGames).toHaveLength(0);

    const firstTicket = coordinator.get(first.ticketId);
    const secondTicket = coordinator.get(second.ticketId);

    expect(firstTicket?.match?.state).toBe("awaiting_accept");
    expect(firstTicket?.acceptToken).toBeDefined();
    expect(secondTicket?.acceptToken).toBeDefined();

    const matchId = secondTicket?.match?.matchId;
    if (
      !firstTicket ||
      !secondTicket ||
      !matchId ||
      !firstTicket.acceptToken ||
      !secondTicket.acceptToken
    ) {
      throw new Error("match setup failed");
    }

    await coordinator.accept(
      matchId,
      firstTicket.ticketId,
      firstTicket.acceptToken,
    );
    expect(createdGames).toHaveLength(0);

    const updatedSecond = await coordinator.accept(
      matchId,
      secondTicket.ticketId,
      secondTicket.acceptToken,
    );
    expect(updatedSecond?.match?.state).toBe("ready");

    expect(createdGames).toHaveLength(1);
    expect(fakeGameManager.createGame).toHaveBeenCalledTimes(1);
    const createdGameId = createdGames[0].id;

    const finalFirst = coordinator.get(firstTicket.ticketId);
    const finalSecond = coordinator.get(secondTicket.ticketId);

    expect(finalFirst?.match?.gameId).toBe(createdGameId);
    expect(finalSecond?.match?.gameId).toBe(createdGameId);
  });

  it("requeues tickets when a match is declined", async () => {
    const fakeGameManager = {
      createGame: jest.fn(),
    } as unknown as GameManager;

    const coordinator = new RankedCoordinator(fakeGameManager, logger, null);
    await coordinator.initialize();

    const first = await coordinator.join({
      playerId: "DECLINE_1",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });
    const second = await coordinator.join({
      playerId: "DECLINE_2",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });

    const match = coordinator.get(second.ticketId)?.match;
    if (!match) {
      throw new Error("match not created");
    }

    await coordinator.decline(match.matchId, first.ticketId);

    const requeuedFirst = coordinator.get(first.ticketId);
    const requeuedSecond = coordinator.get(second.ticketId);

    expect(requeuedFirst?.match?.state).toBe("awaiting_accept");
    expect(requeuedSecond?.match?.state).toBe("awaiting_accept");
    expect(fakeGameManager.createGame).not.toHaveBeenCalled();
  });
});
