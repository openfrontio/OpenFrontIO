import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  PlayerStats,
  boatUnits,
  bombUnits,
  otherUnits,
} from "../../../../core/StatsSchemas";
import { renderNumber, translateText } from "../../../Utils";

// Structures in display order, most-built first. Listed explicitly rather
// than derived from `otherUnits`, which is ordered arbitrarily and includes
// warships — those are not buildings and get their own section below.
const buildingUnits = [
  "city",
  "port",
  "fact",
  "defp",
  "silo",
  "saml",
] as const satisfies readonly (typeof otherUnits)[number][];

type StatsRow = {
  /** Row label. Omitted when a section holds a single unnamed row. */
  label?: string;
  values: readonly bigint[];
};

/**
 * One section: a heading, column headers, and rows.
 *
 * The leading label column exists only when a section has rows worth naming —
 * six buildings, two ship types. A single-row section is named by its heading
 * instead, rather than padding the row with a filler "Count" cell.
 *
 * That name column is left-aligned; every value column is centred.
 */
function statsSection(
  heading: string,
  columns: readonly string[],
  rows: readonly StatsRow[],
  rowHeader?: string,
): TemplateResult {
  return html`
    <div class="w-full">
      <div
        class="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2"
      >
        ${translateText(heading)}
      </div>
      <div class="overflow-x-auto rounded-lg border border-white/5 bg-black/20">
        <table class="w-full table-fixed text-sm text-gray-300">
          <thead>
            <tr class="bg-white/5">
              ${rowHeader === undefined
                ? ""
                : html`<th
                    class="px-4 py-2 text-left font-semibold text-gray-400"
                  >
                    ${translateText(rowHeader)}
                  </th>`}
              ${columns.map(
                (column) => html`
                  <th class="px-3 py-2 text-center font-semibold text-gray-400">
                    ${translateText(column)}
                  </th>
                `,
              )}
            </tr>
          </thead>
          <tbody class="divide-y divide-white/5">
            ${rows.map(
              (row) => html`
                <tr class="hover:bg-white/5 transition-colors">
                  ${row.label === undefined
                    ? ""
                    : html`<td
                        class="px-4 py-2 text-left font-medium text-white/80"
                      >
                        ${translateText(row.label)}
                      </td>`}
                  ${row.values.map(
                    (value) => html`
                      <td class="px-3 py-2 text-center text-white/60">
                        ${renderNumber(value)}
                      </td>
                    `,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

const UNIT_COLUMNS = [
  "player_stats_table.built",
  "player_stats_table.destroyed",
  "player_stats_table.captured",
  "player_stats_table.lost",
] as const;

@customElement("player-stats-table")
export class PlayerStatsTable extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) stats: PlayerStats;

  render() {
    const stats = this.stats;
    /** Reads one stat slot, defaulting a missing or short array to zero. */
    const at = (values: readonly bigint[] | undefined, index: number): bigint =>
      values?.[index] ?? 0n;
    const slots = (values: readonly bigint[] | undefined, count: number) =>
      Array.from({ length: count }, (unused, i) => at(values, i));

    return html`
      <div class="grid grid-cols-1 gap-6 w-full">
        ${statsSection(
          "player_stats_table.building_stats",
          UNIT_COLUMNS,
          buildingUnits.map((key) => ({
            label: `player_stats_table.unit.${key}`,
            values: slots(stats?.units?.[key], 4),
          })),
          "player_stats_table.building",
        )}
        ${statsSection("player_stats_table.warship_stats", UNIT_COLUMNS, [
          { values: slots(stats?.units?.wshp, 4) },
        ])}
        ${statsSection(
          "player_stats_table.ship_arrivals",
          [
            "player_stats_table.sent",
            "player_stats_table.arrived",
            "player_stats_table.captured",
            "player_stats_table.destroyed",
          ],
          boatUnits.map((key) => ({
            label: `player_stats_table.unit.${key}`,
            values: slots(stats?.boats?.[key], 4),
          })),
          "player_stats_table.ship_type",
        )}
        <!-- Launched and Landed count missiles this player fired; Intercepted
        counts incoming missiles their SAMs shot down (bombIntercept credits
        the SAM owner), so the last column is defensive. -->
        ${statsSection(
          "player_stats_table.nuke_stats",
          [
            "player_stats_table.launched",
            "player_stats_table.landed",
            "player_stats_table.intercepted",
          ],
          bombUnits.map((key) => ({
            label: `player_stats_table.unit.${key}`,
            values: slots(stats?.bombs?.[key], 3),
          })),
          "player_stats_table.weapon",
        )}
        ${statsSection(
          "player_stats_table.attack_stats",
          [
            "player_stats_table.sent",
            "player_stats_table.incoming",
            "player_stats_table.cancelled",
          ],
          [{ values: slots(stats?.attacks, 3) }],
        )}
        ${statsSection(
          "player_stats_table.gold_stats",
          [
            "player_stats_table.workers",
            "player_stats_table.war",
            "player_stats_table.trade",
            "player_stats_table.piracy",
            "player_stats_table.trains",
            "player_stats_table.trains_external",
          ],
          [{ values: slots(stats?.gold, 6) }],
        )}
        ${statsSection(
          "player_stats_table.diplomacy_stats",
          ["player_stats_table.betrayals"],
          [{ values: [stats?.betrayals ?? 0n] }],
        )}
      </div>
    `;
  }
}
