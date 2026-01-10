import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  PlayerStats,
  boatUnits,
  bombUnits,
  otherUnits,
} from "../../../../core/StatsSchemas";
import { renderNumber, translateText } from "../../../Utils";

@customElement("player-stats-table")
export class PlayerStatsTable extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) stats: PlayerStats;

  render() {
    return html`
      <div class="grid grid-cols-1 gap-6 w-full">
        <div class="w-full">
          <div
            class="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2"
          >
            ${translateText("player_stats_table.building_stats")}
          </div>
          <div
            class="overflow-x-auto rounded-lg border border-white/5 bg-black/20"
          >
            <table class="w-full text-sm text-gray-300">
              <thead>
                <tr class="bg-white/5">
                  <th class="px-4 py-2 font-semibold text-left text-gray-400">
                    ${translateText("player_stats_table.building")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.built")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.destroyed")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.captured")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.lost")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                ${otherUnits.map((key) => {
                  const built = this.stats?.units?.[key]?.[0] ?? 0n;
                  const destroyed = this.stats?.units?.[key]?.[1] ?? 0n;
                  const captured = this.stats?.units?.[key]?.[2] ?? 0n;
                  const lost = this.stats?.units?.[key]?.[3] ?? 0n;
                  return html`
                    <tr class="hover:bg-white/5 transition-colors">
                      <td class="px-4 py-2 text-left font-medium text-white/80">
                        ${translateText(`player_stats_table.unit.${key}`)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(built)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(destroyed)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(captured)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(lost)}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div class="w-full">
          <div
            class="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2"
          >
            ${translateText("player_stats_table.ship_arrivals")}
          </div>
          <div
            class="overflow-x-auto rounded-lg border border-white/5 bg-black/20"
          >
            <table class="w-full text-sm text-gray-300">
              <thead>
                <tr class="bg-white/5">
                  <th class="px-4 py-2 font-semibold text-left text-gray-400">
                    ${translateText("player_stats_table.ship_type")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.sent")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.destroyed")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.arrived")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                ${boatUnits.map((key) => {
                  const sent = this.stats?.boats?.[key]?.[0] ?? 0n;
                  const arrived = this.stats?.boats?.[key]?.[1] ?? 0n;
                  const destroyed = this.stats?.boats?.[key]?.[3] ?? 0n;
                  return html`
                    <tr class="hover:bg-white/5 transition-colors">
                      <td class="px-4 py-2 text-left font-medium text-white/80">
                        ${translateText(`player_stats_table.unit.${key}`)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(sent)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(destroyed)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(arrived)}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div class="w-full">
          <div
            class="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2"
          >
            ${translateText("player_stats_table.nuke_stats")}
          </div>
          <div
            class="overflow-x-auto rounded-lg border border-white/5 bg-black/20"
          >
            <table class="w-full text-sm text-gray-300">
              <thead>
                <tr class="bg-white/5">
                  <th class="px-4 py-2 font-semibold text-left text-gray-400">
                    ${translateText("player_stats_table.weapon")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.launched")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.landed")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.hits")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                ${bombUnits.map((bomb) => {
                  const launched = this.stats?.bombs?.[bomb]?.[0] ?? 0n;
                  const landed = this.stats?.bombs?.[bomb]?.[1] ?? 0n;
                  const intercepted = this.stats?.bombs?.[bomb]?.[2] ?? 0n;
                  return html`
                    <tr class="hover:bg-white/5 transition-colors">
                      <td class="px-4 py-2 text-left font-medium text-white/80">
                        ${translateText(`player_stats_table.unit.${bomb}`)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(launched)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(landed)}
                      </td>
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(intercepted)}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div class="w-full">
          <div
            class="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2"
          >
            ${translateText("player_stats_table.player_metrics")}
          </div>
          <div
            class="overflow-x-auto rounded-lg border border-white/5 bg-black/20 mb-4"
          >
            <table class="w-full text-sm text-gray-300">
              <thead>
                <tr class="bg-white/5">
                  <th class="px-4 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.attack")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.sent")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.received")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.cancelled")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <tr class="hover:bg-white/5 transition-colors">
                  <td class="px-4 py-2 text-center text-white/60">
                    ${translateText("player_stats_table.count")}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.attacks?.[0] ?? 0n)}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.attacks?.[1] ?? 0n)}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.attacks?.[2] ?? 0n)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            class="overflow-x-auto rounded-lg border border-white/5 bg-black/20"
          >
            <table class="w-full text-sm text-gray-300">
              <thead>
                <tr class="bg-white/5">
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.gold")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.workers")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.war")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.trade")}
                  </th>
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText("player_stats_table.steal")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <tr class="hover:bg-white/5 transition-colors">
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.gold?.[0] ?? 0n)}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.gold?.[1] ?? 0n)}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.gold?.[2] ?? 0n)}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.gold?.[3] ?? 0n)}
                  </td>
                  <td class="px-3 py-2 text-center text-white/60">
                    ${renderNumber(this.stats?.gold?.[4] ?? 0n)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
}
