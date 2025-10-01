import { createLogger, transports } from "winston";
import { RankedQueueService } from "../../../src/server/ranked/RankedQueueService";
import {
  RankedMode,
  RankedQueueTicket,
  RankedRegion,
} from "../../../src/server/ranked/types";

const loggerStub = createLogger({
  level: "error",
  transports: [new transports.Console({ silent: true })],
});

describe("RankedQueueService", () => {
  it("pairs two queued players into a match", () => {
    const matches: RankedQueueTicket[][] = [];
    const service = new RankedQueueService(loggerStub, (tickets) => {
      matches.push(tickets);
    });

    const first = service.join({
      playerId: "PLAYER_ONE",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });
    const second = service.join({
      playerId: "PLAYER_TWO",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });

    expect(matches).toHaveLength(1);
    const matchTicketIds = matches[0].map((ticket) => ticket.ticketId).sort();
    expect(matchTicketIds).toEqual([first.ticketId, second.ticketId].sort());

    const lookup = service.get(first.ticketId);
    expect(lookup?.state).toBe("matched");
    expect(lookup?.match?.tickets).toContain(first.ticketId);
  });

  it("removes a ticket when leaving the queue", () => {
    const service = new RankedQueueService(loggerStub, () => {
      throw new Error("match handler should not be called");
    });

    const ticket = service.join({
      playerId: "PLAYER_THREE",
      mode: RankedMode.Duel,
      region: RankedRegion.Global,
    });

    expect(service.leave(ticket.ticketId)).toBe(true);
    expect(service.get(ticket.ticketId)).toBeUndefined();
  });
});
