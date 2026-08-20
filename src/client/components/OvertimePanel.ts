import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMode, PlayerType, Team } from "../../core/game/Game";
import { translateText } from "../Utils";
import { GameView } from "../view";

/**
 * The Overtime readout: once the mode has kicked in, shows the shrinking
 * tile share required to win against your side's current share (your own in
 * FFA, your whole team's otherwise — the same split WinCheckExecution judges).
 * Embedded by game-right-sidebar so it stacks (centered) under the game timer,
 * like the doomsday-clock panel. Hidden before the start minute, when the mode
 * is off, and after a winner. Spectators and eliminated players still see the
 * required share (no personal line).
 */
@customElement("overtime-panel")
export class OvertimePanel extends LitElement {
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) hasWinner = false;
  // Bumped by the parent each tick so the readout advances every second.
  @property({ attribute: false }) refreshKey = 0;

  // Light DOM so Tailwind classes apply and it stacks in the parent's flex.
  createRenderRoot() {
    return this;
  }

  private isTeamGame(): boolean {
    return this.game.config().gameConfig().gameMode !== GameMode.FFA;
  }

  private sideTiles(me: ReturnType<GameView["myPlayer"]>): number {
    if (!me) return 0;
    const myTeam = me.team();
    if (!this.isTeamGame() || myTeam === null) return me.numTilesOwned();
    return this.game
      .playerViews()
      .filter(
        (p) =>
          p.team() === myTeam && p.isAlive() && p.type() !== PlayerType.Bot,
      )
      .reduce((sum, p) => sum + p.numTilesOwned(), 0);
  }

  // Localized team name (e.g. "Red"); falls back to the raw id for numbered teams.
  private teamDisplayName(team: Team): string {
    const key = `team_colors.${team.toLowerCase()}`;
    const translated = translateText(key);
    return translated !== key ? translated : team;
  }

  render() {
    const sd = this.game?.config().overtimeConfig();
    const elapsed = Math.floor(this.game?.elapsedGameSeconds() ?? 0);
    const visible =
      !!sd?.enabled && !this.hasWinner && elapsed >= sd.startMinutes * 60;
    this.style.display = visible ? "block" : "none";
    if (!visible || !sd) return html``;

    const me = this.game.myPlayer();
    const live = !!me && me.isAlive();
    const land = this.game.numLandTiles() - this.game.numTilesWithFallout();
    const myTeam = me?.team() ?? null;
    // The exact bar the sim checks — one shared formula, never re-derived here.
    const requiredPct = this.game.config().percentageTilesOwnedToWin(elapsed);
    const yourPct = land > 0 ? (this.sideTiles(me) / land) * 100 : 0;

    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg text-white text-sm";

    return html`
      <div class="${panel}">
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-wide text-orange-400">
            ${translateText("overtime.title")}
          </span>
          <span class="text-orange-300 font-bold">
            ${translateText("overtime.to_win", {
              pct: requiredPct.toFixed(1),
            })}
          </span>
        </div>
        <div class="relative h-2.5 w-52 overflow-hidden rounded bg-gray-600/60">
          <!-- your held share (green) vs the shrinking win threshold (orange
               bar): the gap between them is how far you are from winning. -->
          <div
            class="absolute inset-y-0 left-0 bg-green-400"
            style="width:${Math.min(100, yourPct)}%"
          ></div>
          <div
            class="absolute inset-y-0 w-0.5 bg-orange-400"
            style="left:${Math.min(100, requiredPct)}%"
          ></div>
        </div>
        ${live
          ? html`<div class="text-xs text-gray-300">
              ${myTeam !== null
                ? translateText("doomsday_clock.your_team", {
                    team: this.teamDisplayName(myTeam),
                    pct: yourPct.toFixed(1),
                  })
                : translateText("doomsday_clock.you", {
                    pct: yourPct.toFixed(1),
                  })}
            </div>`
          : ""}
      </div>
    `;
  }
}
