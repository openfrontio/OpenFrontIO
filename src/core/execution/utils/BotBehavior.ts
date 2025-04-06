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

  private emoji(player: Player, emoji: string) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(
      new EmojiExecution(this.player.id(), player.id(), emoji),
    );
  }

  selectEnemy(): Player | null {
    // Forget old enemies
    if (this.game.ticks() - this.lastEnemyUpdateTick > 100) {
      this.enemy = null;
    }

    // Assist allies
    if (this.assistAllies) {
      outer: for (const ally of this.player.allies()) {
        if (ally.targets().length === 0) continue;
        if (this.player.relation(ally) < Relation.Friendly) {
          // this.emoji(ally, "🤦");
          continue;
        }
        for (const target of ally.targets()) {
          if (target === this.player) {
            // this.emoji(ally, "💀");
            continue;
          }
          if (this.player.isAlliedWith(target)) {
            // this.emoji(ally, "👎");
            continue;
          }
          // All checks passed, assist them
          this.player.updateRelation(ally, -20);
          this.enemy = target;
          this.lastEnemyUpdateTick = this.game.ticks();
          this.emoji(ally, "👍");
          break outer;
        }
      }
    }

    // Prefer neighboring bots
    if (this.enemy === null) {
      const bots = this.player
        .neighbors()
        .filter((n) => n.isPlayer() && n.type() == PlayerType.Bot) as Player[];
      if (bots.length > 0) {
        const density = (p: Player) => p.troops() / p.numTilesOwned();
        this.enemy = bots.sort((a, b) => density(a) - density(b))[0];
        this.lastEnemyUpdateTick = this.game.ticks();
      }
    }

    // Select the most hated player to be an enemy
    if (this.enemy === null) {
      const mostHated = this.player.allRelationsSorted()[0] ?? null;
      if (mostHated != null && mostHated.relation === Relation.Hostile) {
        this.enemy = mostHated.player;
        this.lastEnemyUpdateTick = this.game.ticks();
      }
    }

    // Sanity check, don't attack our allies or teammates
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
