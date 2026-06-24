import { TransportShipExecution } from "src/core/execution/TransportShipExecution";
import { Game } from "../../..//src/core/game/Game";
import { ClientID, GameID, Turn } from "../../../src/core/Schemas";
import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { DeleteUnitExecution } from "../../../src/core/execution/DeleteUnitExecution";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import { AllianceExtensionExecution } from "../../../src/core/execution/alliance/AllianceExtensionExecution";
import { setup } from "../../util/Setup";

describe("Executor", () => {
  let game: Game;
  let executor: Executor;
  const gameID: GameID = "test_game";
  const clientID: ClientID = "test_client";
  const mockPlayer: any = 7;

  beforeEach(() => {
    executor = new Executor(game, gameID, clientID);
    beforeEach(async () => {
      game = await setup("plains", {});
    });
  });

  test("createExecs merges attack-ratio-based intents from same client ID", () => {
    // Mock the mg.playerByClientID method to not trigger early exit from the createExecs() function
    (executor as any).mg = {
      playerByClientID: (id: number) => mockPlayer,
    };

    const turn: Turn = {
      turnNumber: 1,
      intents: [
        {
          type: "attack",
          clientID: "client1",
          troopRatio: 0.6,
          troopCount: 100,
          targetID: "target1",
        },
        {
          type: "delete_unit",
          clientID: "client3",
          unitId: 1001,
        },
        {
          type: "allianceExtension",
          clientID: "client3",
          recipient: "alliance1",
        },
        {
          type: "attack",
          clientID: "client1",
          troopRatio: 0.6,
          troopCount: 100,
          targetID: "target2",
        },
        {
          type: "attack",
          clientID: "client2",
          troopRatio: 0.9,
          troopCount: 200,
          targetID: "target2",
        },
        {
          type: "attack",
          clientID: "client3",
          troopRatio: 0.5,
          troopCount: 1000,
          targetID: "target1",
        },
        {
          type: "boat",
          clientID: "client3",
          troopRatio: 0.1,
          troopCount: 1000,
          dst: 42,
        },
        {
          type: "attack",
          clientID: "client3",
          troopRatio: 0.5,
          troopCount: 1000,
          targetID: "target3",
        },
      ],
    };

    const executions = executor.createExecs(turn);
    expect(executions).toHaveLength(8);
    expect(executions[0]).toBeInstanceOf(AttackExecution);
    expect(executions[1]).toBeInstanceOf(DeleteUnitExecution);
    expect(executions[2]).toBeInstanceOf(AllianceExtensionExecution);
    expect(executions[3]).toBeInstanceOf(AttackExecution);
    expect(executions[4]).toBeInstanceOf(AttackExecution);
    expect(executions[5]).toBeInstanceOf(AttackExecution);
    expect(executions[6]).toBeInstanceOf(TransportShipExecution);
    expect(executions[7]).toBeInstanceOf(AttackExecution);

    // Mock the computeRatio method to previous, buggy, version.
    (executor as any).computeRatio = (a: number, b: number) => 1;
    const executionsBuggy = executor.createExecs(turn);
    expect(executionsBuggy).toHaveLength(8);

    // We check that the non attack-ratio-based intents are the same.
    expect(executionsBuggy[1]).toStrictEqual(executions[1]);
    expect(executionsBuggy[2]).toStrictEqual(executions[2]);
    expect(executionsBuggy[4]).toStrictEqual(executions[4]);

    // Total troops sent when buggy ratio is used is 0.6*100 + 0.6*100 = 120.
    expect(
      (executionsBuggy[0] as any).startTroops +
        (executionsBuggy[3] as any).startTroops,
    ).toBe(0.6 * 100 + 0.6 * 100);

    // The total should be equal to sequenced 60% attacks, meaning the first sends 60% of 100,
    // and the second sends 60% of the remaining 40, which is 24. Total = 84.
    // BUT the attacks are considered equals, ensuring that the total troops sent is 0.6*100 + 0.6*(100 - 0.6*100) = 84.
    expect(
      (executions[0] as any).startTroops + (executions[3] as any).startTroops,
    ).toBe(0.6 * 100 + 0.6 * (100 - 0.6 * 100));

    expect(
      (executionsBuggy[5] as any).startTroops +
        (executionsBuggy[6] as any).troops +
        (executionsBuggy[7] as any).startTroops,
    ).toBe(0.5 * 1000 + 0.1 * 1000 + 0.5 * 1000);
    expect(
      (executions[5] as any).startTroops +
        (executions[6] as any).troops +
        (executions[7] as any).startTroops,
      // We remove one because of rounding
    ).toBe(0.5 * 1000 + 0.5 * 500 + 0.1 * 250 - 1);
  });
});
