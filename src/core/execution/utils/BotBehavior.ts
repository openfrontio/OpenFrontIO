import {
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
} from "../../game/Game";
import { AttackExecution } from "../AttackExecution";
import { EmojiExecution } from "../EmojiExecution";

export class BotBehavior {
  private enemy: Player | null = null;
  private lastEnemyUpdateTick: Tick;

  constructor(
    private game: Game,
    private player: Player,
    private attackRatio: number,
    private assistAllies: boolean,
  ) {}

  handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      const notTraitor = !req.requestor().isTraitor();
      const noMalice =
        this.player.relation(req.requestor()) >= Relation.Neutral;
      const requestorIsMuchLarger =
        req.requestor().numTilesOwned() > this.player.numTilesOwned() * 3;
      const notTooManyAlliances =
        requestorIsMuchLarger || req.requestor().alliances().length < 3;
      if (notTraitor && noMalice && notTooManyAlliances) {
        req.accept();
      } else {
        req.reject();
      }
    }
  }

  selectEnemy(): Player | null {
    // Forget old enemies
    if (this.game.ticks() - this.lastEnemyUpdateTick > 100) {
      this.enemy = null;
    }

    // Assist allies
    if (this.assistAllies) {
      const target =
        this.player
          .allies()
          .filter((ally) => this.player.relation(ally) == Relation.Friendly)
          .filter((ally) => ally.targets().length > 0)
          .map((ally) => ({ ally: ally, t: ally.targets()[0] }))[0] ?? null;

      if (
        target != null &&
        target.t != this.player &&
        !this.player.isAlliedWith(target.t)
      ) {
        this.player.updateRelation(target.ally, -20);
        this.enemy = target.t;
        this.lastEnemyUpdateTick = this.game.ticks();
        if (target.ally.type() == PlayerType.Human) {
          this.game.addExecution(
            new EmojiExecution(this.player.id(), target.ally.id(), "👍"),
          );
        }
      }
    }

    // Select the most hated player to be an enemy
    if (this.enemy == null) {
      const mostHated = this.player.allRelationsSorted()[0] ?? null;
      if (mostHated != null && mostHated.relation == Relation.Hostile) {
        this.enemy = mostHated.player;
        this.lastEnemyUpdateTick = this.game.ticks();
      }
    }

    // Sanity check, don't attack allies our teammates
    if (this.enemy && this.player.isFriendly(this.enemy)) {
      this.enemy = null;
    }
    return this.enemy;
  }

  sendAttack(target: Player | TerraNullius) {
    if (target.isPlayer() && this.player.isOnSameTeam(target)) return;
    const troops = this.player.troops() * this.attackRatio;
    if (troops < 1) return;
    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player.id(),
        target.isPlayer() ? target.id() : null,
      ),
    );
  }
}
