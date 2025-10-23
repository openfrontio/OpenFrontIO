import { Execution, Game, Player, PlayerType } from "../game/Game";

export class EmbargoAllExecution implements Execution {
  private active = true;

  constructor(
    private readonly player: Player,
    private readonly action: "start" | "stop",
    private readonly excludeTeammates: boolean = true,
  ) {}

  init(mg: Game, _: number): void {
    const me = this.player;
    for (const p of mg.players()) {
      if (!p.isPlayer()) continue;
      if (!p.isAlive()) continue;
      if (p.id() === me.id()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (this.excludeTeammates && me.isOnSameTeam(p)) continue;

      if (this.action === "start") {
        if (!me.hasEmbargoAgainst(p)) me.addEmbargo(p, false);
      } else {
        if (me.hasEmbargoAgainst(p)) me.stopEmbargo(p);
      }
    }

    this.player.recordEmbargoAll();
    this.active = false;
  }

  tick(_: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
