import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { EmbargoAllExecution } from "@openfront/engine/execution/EmbargoAllExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let me: Player;
let ally: Player;
let enemy: Player;

function human(name: string): PlayerInfo {
  return new PlayerInfo(name, PlayerType.Human, null, name);
}

describe("EmbargoAllExecution", () => {
  beforeEach(async () => {
    game = await setup("plains");
    me = game.addPlayer(human("me"));
    ally = game.addPlayer(human("ally"));
    enemy = game.addPlayer(human("enemy"));
    me.conquer(game.ref(5, 5));
    ally.conquer(game.ref(40, 5));
    enemy.conquer(game.ref(5, 40));
    me.createAllianceRequest(ally)!.accept();
    executeTicks(game, game.config().embargoAllCooldown());
  });

  test("stopping trade with enemies leaves allies alone", () => {
    new EmbargoAllExecution(me, "start").init(game, game.ticks());

    expect(me.hasEmbargoAgainst(enemy)).toBe(true);
    expect(me.hasEmbargoAgainst(ally)).toBe(false);
    expect(me.canTrade(ally)).toBe(true);
  });

  test("starting trade with enemies keeps a manual embargo on an ally", () => {
    me.addEmbargo(ally, false);
    me.addEmbargo(enemy, false);

    new EmbargoAllExecution(me, "stop").init(game, game.ticks());

    expect(me.hasEmbargoAgainst(enemy)).toBe(false);
    expect(me.hasEmbargoAgainst(ally)).toBe(true);
  });

  test("cannot embargo all when every other player is an ally", () => {
    expect(me.canEmbargoAll()).toBe(true);
    me.createAllianceRequest(enemy)!.accept();
    expect(me.canEmbargoAll()).toBe(false);
  });
});
