import {
  AllianceRequest,
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
  private enemyUpdated: Tick;

  constructor(
    private game: Game,
    private player: Player,
    private attackRatio: number,
    private assistAllies: boolean,
  ) {}

  handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      if (shouldAcceptAllianceRequest(this.player, req)) {
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
    if (this.game.ticks() - this.enemyUpdated > 100) {
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
          this.enemyUpdated = this.game.ticks();
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
        this.enemyUpdated = this.game.ticks();
      }
    }

    // Select the most hated player to be an enemy
    if (this.enemy === null) {
      const mostHated = this.player.allRelationsSorted()[0] ?? null;
      if (mostHated != null && mostHated.relation === Relation.Hostile) {
        this.enemy = mostHated.player;
        this.enemyUpdated = this.game.ticks();
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

function shouldAcceptAllianceRequest(player: Player, request: AllianceRequest) {
  const notTraitor = !request.requestor().isTraitor();
  const noMalice = player.relation(request.requestor()) >= Relation.Neutral;
  const requestorIsMuchLarger =
    request.requestor().numTilesOwned() > player.numTilesOwned() * 3;
  const notTooManyAlliances =
    requestorIsMuchLarger || request.requestor().alliances().length < 3;
  return notTraitor && noMalice && notTooManyAlliances;
}
