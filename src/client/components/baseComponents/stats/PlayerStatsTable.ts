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
      <div class="mt-4 w-full max-w-md">
        <div class="text-gray-400 text-base font-bold mb-2">
          ${translateText("player_stats_table.building_stats")}
        </div>
        <table class="w-full text-[0.95rem] text-[#ccc] border-collapse">
          <thead>
            <tr>
              <th
                class="px-2 py-1 text-center text-[#bbb] font-semibold text-left"
              >
                ${translateText("player_stats_table.building")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.built")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.destroyed")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.captured")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.lost")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${otherUnits.map((key) => {
              const built = this.stats?.units?.[key]?.[0] ?? 0n;
              const destroyed = this.stats?.units?.[key]?.[1] ?? 0n;
              const captured = this.stats?.units?.[key]?.[2] ?? 0n;
              const lost = this.stats?.units?.[key]?.[3] ?? 0n;
              return html`
                <tr>
                  <td class="px-2 py-1 text-center">
                    ${translateText(`player_stats_table.unit.${key}`)}
                  </td>
                  <td class="px-2 py-1 text-center">${renderNumber(built)}</td>
                  <td class="px-2 py-1 text-center">
                    ${renderNumber(destroyed)}
                  </td>
                  <td class="px-2 py-1 text-center">
                    ${renderNumber(captured)}
                  </td>
                  <td class="px-2 py-1 text-center">${renderNumber(lost)}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      <div class="mt-4 w-full max-w-md">
        <div class="text-gray-400 text-base font-bold mb-2">
          ${translateText("player_stats_table.ship_arrivals")}
        </div>
        <table class="w-full text-[0.95rem] text-[#ccc] border-collapse">
          <thead>
            <tr>
              <th
                class="px-2 py-1 text-center text-[#bbb] font-semibold text-left"
              >
                ${translateText("player_stats_table.ship_type")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.sent")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.destroyed")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.arrived")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${boatUnits.map((key) => {
              const sent = this.stats?.boats?.[key]?.[0] ?? 0n;
              const arrived = this.stats?.boats?.[key]?.[1] ?? 0n;
              const destroyed = this.stats?.boats?.[key]?.[3] ?? 0n;
              return html`
                <tr>
                  <td class="px-2 py-1 text-center">
                    ${translateText(`player_stats_table.unit.${key}`)}
                  </td>
                  <td class="px-2 py-1 text-center">${renderNumber(sent)}</td>
                  <td class="px-2 py-1 text-center">
                    ${renderNumber(destroyed)}
                  </td>
                  <td class="px-2 py-1 text-center">
                    ${renderNumber(arrived)}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      <div class="mt-4 w-full max-w-md">
        <div class="text-gray-400 text-base font-bold mb-2">
          ${translateText("player_stats_table.nuke_stats")}
        </div>
        <table class="w-full text-[0.95rem] text-[#ccc] border-collapse">
          <thead>
            <tr>
              <th
                class="px-2 py-1 text-center text-[#bbb] font-semibold text-left"
                style="width:40%"
              >
                ${translateText("player_stats_table.weapon")}
              </th>
              <th
                class="px-2 py-1 text-center text-[#bbb] font-semibold text-center"
                style="width:20%"
              >
                ${translateText("player_stats_table.launched")}
              </th>
              <th
                class="px-2 py-1 text-center text-[#bbb] font-semibold text-center"
                style="width:20%"
              >
                ${translateText("player_stats_table.landed")}
              </th>
              <th
                class="px-2 py-1 text-center text-[#bbb] font-semibold text-center"
                style="width:20%"
              >
                ${translateText("player_stats_table.hits")}
              </th>
            </tr>
          </thead>
          <tbody>
            ${bombUnits.map((bomb) => {
              const launched = this.stats?.bombs?.[bomb]?.[0] ?? 0n;
              const landed = this.stats?.bombs?.[bomb]?.[1] ?? 0n;
              const intercepted = this.stats?.bombs?.[bomb]?.[2] ?? 0n;
              return html`
                <tr>
                  <td class="px-2 py-1 text-center">
                    ${translateText(`player_stats_table.unit.${bomb}`)}
                  </td>
                  <td class="px-2 py-1 text-center text-center">
                    ${renderNumber(launched)}
                  </td>
                  <td class="px-2 py-1 text-center text-center">
                    ${renderNumber(landed)}
                  </td>
                  <td class="px-2 py-1 text-center text-center">
                    ${renderNumber(intercepted)}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      <div class="mt-4 w-full max-w-md">
        <div class="text-gray-400 text-base font-bold mb-2">
          ${translateText("player_stats_table.player_metrics")}
        </div>
        <table class="w-full text-[0.95rem] text-[#ccc] border-collapse">
          <thead>
            <tr>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.attack")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.sent")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.received")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.cancelled")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="px-2 py-1 text-center">
                ${translateText("player_stats_table.count")}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.attacks?.[0] ?? 0n)}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.attacks?.[1] ?? 0n)}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.attacks?.[2] ?? 0n)}
              </td>
            </tr>
          </tbody>
        </table>
        <table
          class="w-full text-[0.95rem] text-[#ccc] border-collapse"
          style="margin-top: 0.75rem;"
        >
          <thead>
            <tr>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.gold")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.workers")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.war")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.trade")}
              </th>
              <th class="px-2 py-1 text-center text-[#bbb] font-semibold">
                ${translateText("player_stats_table.steal")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="px-2 py-1 text-center">
                ${translateText("player_stats_table.count")}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.gold?.[0] ?? 0n)}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.gold?.[1] ?? 0n)}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.gold?.[2] ?? 0n)}
              </td>
              <td class="px-2 py-1 text-center">
                ${renderNumber(this.stats?.gold?.[3] ?? 0n)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }
}
