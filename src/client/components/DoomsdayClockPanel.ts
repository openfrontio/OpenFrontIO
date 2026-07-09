import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import {
  doomsdayClockDrain,
  doomsdayClockSideRequiredTiles,
  doomsdayClockWaveState,
} from "../../core/game/DoomsdayClock";
import { GameMode, PlayerType, Team } from "../../core/game/Game";
import { themeProvider } from "../theme/ThemeProvider";
import { renderTroops, translateText } from "../Utils";
import { GameView } from "../view";

const doomsdayClockIcon = assetUrl("images/DoomsdayClockSkull.svg");

/**
 * The Doomsday Clock readout: a self-contained panel showing the rising bar, the
 * side's share vs the threshold, the stage (Stable/Unstable/Collapsing) and the
 * wave countdown. Embedded by game-right-sidebar so it stacks (centered) under
 * the game timer; it hides only when the mode is off or after a winner. A
 * spectator, replay viewer, or eliminated / not-spawned player still sees the
 * zone-only readout (rising bar + wave countdown, no personal status line).
 */
@customElement("doomsday-clock-panel")
export class DoomsdayClockPanel extends LitElement {
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) hasWinner = false;
  // Bumped by the parent each tick so the countdown + bar advance every second.
  @property({ attribute: false }) refreshKey = 0;

  // Light DOM so Tailwind classes apply and it stacks in the parent's flex.
  createRenderRoot() {
    return this;
  }

  private secondsToHms(d: number): string {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    return h !== 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // The player's "side" (matching the sim): themselves in FFA, their whole team
  // otherwise. Returns the combined tiles and the headcount (the sim scales the
  // threshold by headcount, so the HUD needs it too).
  private sideStats(me: ReturnType<GameView["myPlayer"]>): {
    tiles: number;
    size: number;
  } {
    if (!me) return { tiles: 0, size: 1 };
    const ffa = this.game.config().gameConfig().gameMode === GameMode.FFA;
    const myTeam = me.team();
    if (ffa || myTeam === null) return { tiles: me.numTilesOwned(), size: 1 };
    const mates = this.game
      .playerViews()
      .filter(
        (p) =>
          p.team() === myTeam && p.isAlive() && p.type() !== PlayerType.Bot,
      );
    return {
      tiles: mates.reduce((sum, p) => sum + p.numTilesOwned(), 0),
      size: mates.length,
    };
  }

  // Localized team name (e.g. "Red"), matching TeamStats; falls back to the raw
  // team id for numbered teams.
  private teamDisplayName(team: Team): string {
    const key = `team_colors.${team.toLowerCase()}`;
    const translated = translateText(key);
    return translated !== key ? translated : team;
  }

  // The team's on-map color as a hex string, for the readout label.
  private teamColor(team: Team): string {
    return themeProvider.current().teamColor(team).toHex();
  }

  render() {
    const sd = this.game?.config().doomsdayClockConfig();
    const me = this.game?.myPlayer();
    // Show whenever the mode is on and there's no winner yet. A spectator, a
    // replay viewer, or a not-spawned / eliminated player has no live side, so
    // `live` is false and they get the zone-only readout (rising bar + countdown).
    const visible = !!sd?.enabled && !this.hasWinner;
    this.style.display = visible ? "block" : "none";
    if (!visible || !sd) return html``;

    const live = !!me && me.isAlive();
    const elapsed = Math.floor(this.game.elapsedGameSeconds());
    const land = this.game.numLandTiles() - this.game.numTilesWithFallout();
    const myTeam = me?.team() ?? null;
    const { tiles: yourTiles, size: mySize } = this.sideStats(me);
    // Threshold is scaled by the side's headcount (same as the sim).
    const requiredTiles = doomsdayClockSideRequiredTiles(
      sd.speed,
      land,
      elapsed,
      mySize,
    );
    const wave = doomsdayClockWaveState(sd.speed, elapsed);
    // Wave readout percentages scale by headcount too (capped at the whole map).
    const scalePct = (p: number) => Math.min(100, p * mySize);
    // Match the sim: no land -> no bar, no percentages (avoid div-by-zero / >100%).
    const requiredPct = land > 0 ? (requiredTiles / land) * 100 : 0;
    const yourPct = land > 0 ? (yourTiles / land) * 100 : 0;
    const flagged = me?.inDoomsdayClock() ?? false;
    const secondsUnder = Math.floor((me?.doomsdayClockTicks() ?? 0) / 10);
    const draining = flagged && secondsUnder >= sd.warnSeconds;
    // Safe but within 10% (relative) of the bar: e.g. at 9% when the bar is 10%,
    // or 0.9% when it's 1%. About to be caught, so it blinks red too.
    const nearDanger =
      live && !flagged && requiredTiles > 0 && yourPct <= requiredPct * 1.1;
    // In danger (caught/draining) or about to be: everything red.
    const redAlert = flagged || nearDanger;

    // The zone's own progress, independent of your status. Shown while stable
    // AND while collapsing, so you can still see the bar rising as you bleed.
    const zoneDetail = wave.done
      ? translateText("doomsday_clock.final", {
          pct: scalePct(wave.currentPercent),
        })
      : wave.growing
        ? translateText("doomsday_clock.growing", {
            pct: scalePct(wave.targetPercent),
            time: this.secondsToHms(wave.secondsToTarget),
          })
        : translateText("doomsday_clock.next_wave", {
            pct: scalePct(wave.targetPercent),
            time: this.secondsToHms(wave.secondsToNextGrowth),
          });

    // Status word + detail line. Spectators, replay viewers, and eliminated /
    // not-spawned players have no live side, so they see just the zone readout
    // (no personal status word). Detail defaults to the zone readout for everyone.
    let status = "";
    let statusClass = "";
    let detail = zoneDetail;
    if (live && draining && me) {
      // Drain is a % of max-troop capacity, capped at current troops; show the
      // actual per-second loss (renderTroops handles the /10 display unit).
      const chunk = doomsdayClockDrain(
        this.game.config().maxTroops(me),
        secondsUnder - sd.warnSeconds,
        sd,
      );
      status = translateText("doomsday_clock.collapsing", {
        rate: renderTroops(Math.min(me.troops(), chunk)),
      });
      statusClass = "text-red-400 font-bold";
    } else if (live && flagged) {
      // Caught below a wave: count down the cooldown before decay begins.
      status = translateText("doomsday_clock.unstable");
      statusClass = "text-red-400 font-bold";
      detail = translateText("doomsday_clock.decay_in", {
        secs: Math.max(0, sd.warnSeconds - secondsUnder),
      });
    } else if (live) {
      status = translateText("doomsday_clock.stable");
      statusClass = nearDanger ? "text-orange-300 font-bold" : "text-green-400";
    }

    // Panel edge cue: red pulse when in/near danger, orange pulse in the 10s
    // window around a wave firing.
    const edge = redAlert
      ? "sd-pulse-red"
      : wave.waveFlash
        ? "sd-pulse-orange"
        : "";
    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg text-white text-sm";

    return html`
      <style>
        @keyframes sd-red {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(248, 113, 113, 0);
          }
          50% {
            box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.95);
          }
        }
        @keyframes sd-orange {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(251, 146, 60, 0);
          }
          50% {
            box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.9);
          }
        }
        .sd-pulse-red {
          animation: sd-red 1s ease-in-out infinite;
        }
        .sd-pulse-orange {
          animation: sd-orange 1.8s ease-in-out infinite;
        }
      </style>
      <div class="${panel} ${edge}">
        <div class="flex items-center justify-between gap-3">
          <span
            class="flex items-center gap-1.5 font-bold tracking-wide text-red-400"
          >
            <img src=${doomsdayClockIcon} alt="" width="20" height="20" />
            ${translateText("doomsday_clock.title")}
          </span>
          <span class=${statusClass}>${status}</span>
        </div>
        <div class="relative h-2.5 w-52 overflow-hidden rounded bg-gray-600/60">
          <!-- your held share (green) vs the target threshold (red bar): the gap
               between them shows how far you are from safe. -->
          <div
            class="absolute inset-y-0 left-0 bg-green-400"
            style="width:${Math.min(100, yourPct)}%"
          ></div>
          <div
            class="absolute inset-y-0 w-0.5 bg-red-500"
            style="left:${Math.min(100, requiredPct)}%"
          ></div>
        </div>
        <div class="flex items-center justify-between gap-3 text-gray-300">
          <span>
            ${translateText("doomsday_clock.hold", {
              pct: requiredPct.toFixed(1),
            })}
          </span>
          ${live
            ? myTeam !== null
              ? html`<span style=${`color:${this.teamColor(myTeam)}`}>
                  ${translateText("doomsday_clock.your_team", {
                    team: this.teamDisplayName(myTeam),
                    pct: yourPct.toFixed(1),
                  })}
                </span>`
              : html`<span
                  class=${redAlert ? "text-red-300" : "text-green-300"}
                >
                  ${translateText("doomsday_clock.you", {
                    pct: yourPct.toFixed(1),
                  })}
                </span>`
            : ""}
        </div>
        ${detail
          ? html`<div class="text-xs text-gray-400">${detail}</div>`
          : ""}
      </div>
    `;
  }
}
