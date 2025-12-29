import { VassalOfferExecution } from "../src/core/execution/VassalOfferExecution";
import { VassalOfferReplyExecution } from "../src/core/execution/VassalOfferReplyExecution";
import { PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

describe("Vassal offer reply flow", () => {
  it("creates update and accepts on reply", async () => {
    const game = await setup(
      "plains",
      { enableVassals: true, infiniteTroops: true },
      [playerInfo("req", PlayerType.Human), playerInfo("tar", PlayerType.Human)],
    );
    const req = game.player("req");
    const tar = game.player("tar");
    req.conquer(game.ref(0, 0));
    tar.conquer(game.ref(0, 1));
    while (game.inSpawnPhase()) game.executeNextTick();

    game.addExecution(new VassalOfferExecution(req, tar.id()));
    game.executeNextTick();

    const reply = new VassalOfferReplyExecution(req.id(), tar.id(), true);
    reply.init(game as any);
    reply.tick();

    expect(game.vassalages().length).toBe(1);
    expect(tar.overlord()).toBe(req);
  });

  it("reject reply does not vassalize", async () => {
    const game = await setup(
      "plains",
      { enableVassals: true, infiniteTroops: true },
      [playerInfo("req", PlayerType.Human), playerInfo("tar", PlayerType.Human)],
    );
    const req = game.player("req");
    const tar = game.player("tar");
    req.conquer(game.ref(0, 0));
    tar.conquer(game.ref(0, 1));
    while (game.inSpawnPhase()) game.executeNextTick();

    const reply = new VassalOfferReplyExecution(req.id(), tar.id(), false);
    reply.init(game as any);
    reply.tick();

    expect(game.vassalages().length).toBe(0);
    expect(tar.overlord()).toBeNull();
  });
});
