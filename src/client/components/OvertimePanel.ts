import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ColoredTeams, GameMode, Team } from "../../core/game/Game";
import { translateText } from "../Utils";
import { GameView, PlayerView } from "../view";

/**
 * The Overtime readout: once the mode has kicked in, shows the shrinking
 * tile share required to win against first place's current share (the top
 * player in FFA, the top team otherwise — the same split WinCheckExecution
 * judges). Embedded by game-right-sidebar so it stacks (centered) under the
 * game timer, like the doomsday-clock panel. Hidden before the start minute,
 * when the mode is off, and after a winner. First place is global info, so
 * spectators and eliminated players see the full readout too.
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

  // The side closest to winning, judged the way WinCheckExecution judges it:
  // the top alive player in FFA, the top team by combined alive tiles
  // otherwise. `isMine` says whether that side is the viewer's own (always
  // false for spectators and replay viewers, who have no side).
  private firstPlace(): {
    name: string;
    tiles: number;
    isMine: boolean;
  } | null {
    const me = this.game.myPlayer();
    const alive = this.game.playerViews().filter((p) => p.isAlive());
    if (!this.isTeamGame()) {
      let top: PlayerView | null = null;
      for (const p of alive) {
        if (top === null || p.numTilesOwned() > top.numTilesOwned()) top = p;
      }
      return top !== null
        ? {
            name: top.displayName(),
            tiles: top.numTilesOwned(),
            isMine: me !== null && top.id() === me.id(),
          }
        : null;
    }
    const teamTiles = new Map<Team, number>();
    for (const p of alive) {
      const team = p.team();
      if (team === null) continue;
      teamTiles.set(team, (teamTiles.get(team) ?? 0) + p.numTilesOwned());
    }
    let topTeam: [Team, number] | null = null;
    for (const entry of teamTiles) {
      if (topTeam === null || entry[1] > topTeam[1]) topTeam = entry;
    }
    // While the bot team holds the most tiles nobody can win on tiles: the
    // sim's win check only ever evaluates the overall max and bails out for
    // bots, never falling through to the runner-up. So there is no first
    // place to show — not the bot team (it can't win) and not the runner-up
    // (its bar crossing the threshold wouldn't end the game).
    if (topTeam !== null && topTeam[0] === ColoredTeams.Bot) return null;
    return topTeam !== null
      ? {
          name: this.teamDisplayName(topTeam[0]),
          tiles: topTeam[1],
          isMine: me !== null && me.team() === topTeam[0],
        }
      : null;
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

    const land = this.game.numLandTiles() - this.game.numTilesWithFallout();
    // The exact bar the sim checks — one shared formula, never re-derived
    // here. Always a whole percentage (see Config.percentageTilesOwnedToWin).
    const requiredPct = this.game.config().percentageTilesOwnedToWin(elapsed);
    const leader = this.firstPlace();
    const leaderPct =
      land > 0 && leader !== null ? (leader.tiles / land) * 100 : 0;
    // Whole percentages only in the readout; floored, so we never overstate
    // the leader's share against the "hold more than X%" bar.
    const leaderPctShown = Math.floor(leaderPct);
    // Green when your own side is in front — or when you have no side to
    // root for (spectators, replays) — red when another side is closest to
    // winning.
    const barClass =
      leader !== null && this.game.myPlayer() !== null && !leader.isMine
        ? "bg-red-400"
        : "bg-green-400";

    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg text-white text-sm";

    return html`
      <div class="${panel}">
        <div class="flex items-center justify-between gap-3">
          <span class="font-bold tracking-wide text-orange-400">
            ${translateText("overtime.title")}
          </span>
          <span class="text-orange-300 font-bold">
            ${translateText("overtime.to_win", { pct: requiredPct })}
          </span>
        </div>
        <div class="relative h-2.5 w-52 overflow-hidden rounded bg-gray-600/60">
          <!-- first place's held share (green when that's your side, red when
               an opponent leads) vs the shrinking win threshold (orange bar):
               the gap between them is how close the game is to ending. -->
          <div
            class="absolute inset-y-0 left-0 ${barClass}"
            style="width:${Math.min(100, leaderPct)}%"
          ></div>
          <div
            class="absolute inset-y-0 w-0.5 bg-orange-400"
            style="left:${Math.min(100, requiredPct)}%"
          ></div>
        </div>
        ${leader !== null
          ? html`<div class="text-xs text-gray-300">
              ${translateText("overtime.first_place", {
                name: leader.name,
                pct: leaderPctShown,
              })}
            </div>`
          : ""}
      </div>
    `;
  }
}
