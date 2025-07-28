import { Execution, Game, Player } from "../game/Game";

export class StopAllTradesExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private readonly targetTeamId?: string,
  ) {}

  init(mg: Game, _: number): void {}

  tick(_: number): void {
    try {
      const tradingPartners = this.player.tradingPartners();

      for (const partner of tradingPartners) {
        if (!this.shouldEmbargoPartner(partner)) {
          continue;
        }

        this.player.addEmbargo(partner.id(), false);
      }
    } catch (error) {
      console.error("Error in StopAllTradesExecution:", error);
    } finally {
      this.active = false;
    }
  }

  private shouldEmbargoPartner(partner: Player): boolean {
    if (this.targetTeamId !== undefined) {
      return this.shouldEmbargoSpecificTeam(partner);
    }
    return this.shouldEmbargoAllTeams(partner);
  }

  private shouldEmbargoSpecificTeam(partner: Player): boolean {
    const partnerTeam = partner.team();
    return partnerTeam?.toString() === this.targetTeamId;
  }

  private shouldEmbargoAllTeams(partner: Player): boolean {
    if (this.player.isAlliedWith(partner)) {
      return false;
    }

    const myTeam = this.player.team();
    const partnerTeam = partner.team();

    // Don't embargo same team members
    return !(myTeam !== null && partnerTeam !== null && myTeam === partnerTeam);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
