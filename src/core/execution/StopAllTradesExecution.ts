import { Execution, Game, Player } from "../game/Game";

export class StopAllTradesExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private readonly targetTeamId?: string | null,
  ) {}

  init(mg: Game, _: number): void {}

  tick(_: number): void {
    try {
      const tradingPartners = this.player.tradingPartners();

      for (const partner of tradingPartners) {
        // If targetTeamId is specified, only embargo players from that team
        if (this.targetTeamId !== undefined && this.targetTeamId !== null) {
          const partnerTeam = partner.team();
          if (partnerTeam?.toString() !== this.targetTeamId) {
            continue;
          }
        } else {
          // If no targetTeamId specified (undefined or null), embargo all non-allied players except same team members
          if (this.player.isAlliedWith(partner)) {
            continue;
          }
          // Don't embargo same team members
          const myTeam = this.player.team();
          const partnerTeam = partner.team();
          if (
            myTeam !== null &&
            partnerTeam !== null &&
            myTeam === partnerTeam
          ) {
            continue;
          }
        }

        this.player.addEmbargo(partner.id(), false);
      }
    } catch (error) {
      console.error("Error in StopAllTradesExecution:", error);
    } finally {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
