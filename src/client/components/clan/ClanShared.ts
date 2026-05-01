import { html, type TemplateResult } from "lit";
import type {
  ClanJoinRequest,
  ClanMember,
  ClanMemberOrder,
  ClanMemberSort,
  ClanMemberStats,
  ClanStats,
} from "../../ClanApi";
import { showToast, translateText } from "../../Utils";
export { renderLoadingSpinner } from "../BaseModal";
export { showToast };

export type ClanRole = "leader" | "officer" | "member";

export function defaultOrderForSort(sort: ClanMemberSort): ClanMemberOrder {
  return sort === "default" ? "asc" : "desc";
}

export const modalContainerClass =
  "h-full flex flex-col overflow-hidden bg-black/70 backdrop-blur-xl lg:rounded-2xl lg:border border-white/10";

const dateCache = new Map<string, string>();

export function formatClanDate(iso: string): string {
  let cached = dateCache.get(iso);
  if (!cached) {
    cached = new Date(iso).toLocaleDateString();
    dateCache.set(iso, cached);
  }
  return cached;
}

export function translateClanRole(role: string): string {
  return translateText(`clan_modal.role_${role}`);
}

export function renderRoleIcon(role: string): TemplateResult {
  if (role === "leader") {
    return html`<span class="text-sm">👑</span>`;
  }
  if (role === "officer") {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      class="w-4 h-4 text-purple-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>`;
  }
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-4 h-4 text-white/40"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    stroke-width="2"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>`;
}

export function renderStat(label: string, value: string): TemplateResult {
  return html`
    <div class="bg-white/5 rounded-xl border border-white/10 p-4 text-center">
      <div
        class="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1"
      >
        ${label}
      </div>
      <div class="text-white font-bold text-sm truncate">${value}</div>
    </div>
  `;
}

export function renderClanWL(stats: ClanStats): TemplateResult | string {
  if (stats.games === 0) return "";
  return html`
    <div class="bg-white/5 rounded-xl border border-white/10 p-5 space-y-3">
      <h3 class="text-sm font-bold text-white/60 uppercase tracking-wider">
        ${translateText("clan_modal.statistics")}
      </h3>
      <div class="space-y-1.5">
        ${statBuckets.map(({ key, labelKey }) =>
          renderWLBarRow(
            translateText(labelKey),
            stats.stats[key].wins,
            stats.stats[key].losses,
          ),
        )}
      </div>
    </div>
  `;
}

function renderPaginationButtons(
  currentPage: number,
  totalPages: number,
  onPageChange: (page: number) => void,
): TemplateResult {
  return html`
    <div class="flex items-center gap-1">
      <button
        @click=${() => onPageChange(1)}
        ?disabled=${currentPage <= 1}
        class="px-2 py-1 text-xs font-bold rounded-lg transition-all
          ${currentPage <= 1
          ? "text-white/20 cursor-not-allowed"
          : "text-white/60 hover:text-white hover:bg-white/10"}"
      >
        &lt;&lt;
      </button>
      <button
        @click=${() => onPageChange(Math.max(1, currentPage - 1))}
        ?disabled=${currentPage <= 1}
        class="px-2 py-1 text-xs font-bold rounded-lg transition-all
          ${currentPage <= 1
          ? "text-white/20 cursor-not-allowed"
          : "text-white/60 hover:text-white hover:bg-white/10"}"
      >
        &lt;
      </button>
      <span class="text-xs text-white/50 font-medium px-1">
        ${currentPage} / ${totalPages}
      </span>
      <button
        @click=${() => onPageChange(Math.min(totalPages, currentPage + 1))}
        ?disabled=${currentPage >= totalPages}
        class="px-2 py-1 text-xs font-bold rounded-lg transition-all
          ${currentPage >= totalPages
          ? "text-white/20 cursor-not-allowed"
          : "text-white/60 hover:text-white hover:bg-white/10"}"
      >
        &gt;
      </button>
      <button
        @click=${() => onPageChange(totalPages)}
        ?disabled=${currentPage >= totalPages}
        class="px-2 py-1 text-xs font-bold rounded-lg transition-all
          ${currentPage >= totalPages
          ? "text-white/20 cursor-not-allowed"
          : "text-white/60 hover:text-white hover:bg-white/10"}"
      >
        &gt;&gt;
      </button>
    </div>
  `;
}

export function renderServerPagination(
  currentPage: number,
  totalPages: number,
  onPageChange: (page: number) => void,
): TemplateResult {
  return html`
    <div
      class="flex items-center justify-center gap-1 pt-4 border-t border-white/10"
    >
      ${renderPaginationButtons(currentPage, totalPages, onPageChange)}
    </div>
  `;
}

export function renderMemberSearchInput(
  onInput: (e: Event) => void,
  placeholderKey = "clan_modal.search_members_placeholder",
  trailing?: TemplateResult,
): TemplateResult {
  const input = html`
    <div class="relative w-full sm:flex-1 sm:min-w-0">
      <input
        type="text"
        @input=${onInput}
        class="w-full h-10 pl-10 pr-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 text-sm"
        placeholder="${translateText(placeholderKey)}"
      />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    </div>
  `;
  if (!trailing) {
    return html`<div class="mb-3">${input}</div>`;
  }
  return html`
    <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
      ${input}${trailing}
    </div>
  `;
}

const sortOptions: { value: ClanMemberSort; labelKey: string }[] = [
  { value: "default", labelKey: "clan_modal.sort_default" },
  { value: "winsTotal", labelKey: "clan_modal.sort_total_wins" },
  { value: "lossesTotal", labelKey: "clan_modal.sort_total_losses" },
  { value: "winsFfa", labelKey: "clan_modal.sort_ffa_wins" },
  { value: "lossesFfa", labelKey: "clan_modal.sort_ffa_losses" },
  { value: "winsTeam", labelKey: "clan_modal.sort_team_wins" },
  { value: "lossesTeam", labelKey: "clan_modal.sort_team_losses" },
  { value: "winsHvn", labelKey: "clan_modal.sort_hvn_wins" },
  { value: "lossesHvn", labelKey: "clan_modal.sort_hvn_losses" },
  { value: "winsRanked", labelKey: "clan_modal.sort_ranked_wins" },
  { value: "lossesRanked", labelKey: "clan_modal.sort_ranked_losses" },
  { value: "wins1v1", labelKey: "clan_modal.sort_1v1_wins" },
  { value: "losses1v1", labelKey: "clan_modal.sort_1v1_losses" },
];

function renderOrderIcon(order: ClanMemberOrder): TemplateResult {
  // asc: bars grow downward (-, --, ---).  desc: bars shrink downward (---, --, -).
  const widths =
    order === "asc" ? ["w-1.5", "w-2.5", "w-3.5"] : ["w-3.5", "w-2.5", "w-1.5"];
  return html`
    <span
      class="flex flex-col items-start justify-center gap-[3px] w-4 h-4"
      aria-hidden="true"
    >
      ${widths.map(
        (w) => html`<span class="${w} h-[2px] bg-current rounded-sm"></span>`,
      )}
    </span>
  `;
}

export function renderMemberSortControl(
  sort: ClanMemberSort,
  order: ClanMemberOrder,
  onSortChange: (sort: ClanMemberSort) => void,
  onOrderToggle: () => void,
): TemplateResult {
  const orderLabel = translateText(
    order === "asc"
      ? "clan_modal.sort_order_asc"
      : "clan_modal.sort_order_desc",
  );
  return html`
    <div class="flex items-center gap-2 shrink-0">
      <label
        class="text-[10px] font-bold text-white/40 uppercase tracking-wider hidden sm:inline"
      >
        ${translateText("clan_modal.sort_by")}
      </label>
      <select
        @change=${(e: Event) =>
          onSortChange((e.target as HTMLSelectElement).value as ClanMemberSort)}
        class="flex-1 sm:flex-none h-10 pl-3 pr-8 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 text-sm appearance-none bg-no-repeat bg-[right_0.5rem_center] bg-[length:1rem] bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22rgba(255,255,255,0.5)%22 stroke-width=%222%22><path stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22m6 9 6 6 6-6%22/></svg>')]"
      >
        ${sortOptions.map(
          (opt) => html`
            <option
              value=${opt.value}
              ?selected=${opt.value === sort}
              class="bg-neutral-900"
            >
              ${translateText(opt.labelKey)}
            </option>
          `,
        )}
      </select>
      <button
        type="button"
        @click=${onOrderToggle}
        title=${orderLabel}
        aria-label=${orderLabel}
        class="h-10 w-10 shrink-0 flex items-center justify-center bg-white/5 border border-white/10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all"
      >
        ${renderOrderIcon(order)}
      </button>
    </div>
  `;
}

const perPageOptions = [10, 25, 50] as const;

export function renderMemberPagination(
  memberPage: number,
  totalMembers: number,
  membersPerPage: number,
  onPageChange: (page: number) => void,
  onPerPageChange: (perPage: number) => void,
): TemplateResult | string {
  const totalPages = Math.ceil(totalMembers / membersPerPage);
  if (totalMembers <= perPageOptions[0]) return "";

  return html`
    <div
      class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10"
    >
      <div class="flex items-center gap-2">
        <span
          class="text-[10px] font-bold text-white/40 uppercase tracking-wider"
        >
          ${translateText("clan_modal.per_page")}
        </span>
        ${perPageOptions.map(
          (opt) => html`
            <button
              @click=${() => onPerPageChange(opt)}
              class="px-2 py-1 text-xs font-bold rounded-lg transition-all
                ${membersPerPage === opt
                ? "bg-malibu-blue/15 text-aquarius border border-malibu-blue/30"
                : "text-white/40 hover:text-white/70 border border-transparent"}"
            >
              ${opt}
            </button>
          `,
        )}
      </div>
      ${renderPaginationButtons(memberPage, totalPages, onPageChange)}
    </div>
  `;
}

const statBuckets = [
  { key: "total" as const, labelKey: "clan_modal.stats_total" },
  { key: "ffa" as const, labelKey: "clan_modal.stats_ffa" },
  { key: "team" as const, labelKey: "clan_modal.stats_team" },
  { key: "hvn" as const, labelKey: "clan_modal.stats_hvn" },
  { key: "ranked" as const, labelKey: "clan_modal.stats_ranked" },
  { key: "1v1" as const, labelKey: "clan_modal.stats_1v1" },
];

function renderWLBarRow(
  label: string,
  wins: number,
  losses: number,
): TemplateResult {
  const total = wins + losses;
  const hasGames = total > 0;
  const rate = hasGames ? Math.round((wins / total) * 100) : 0;
  const winPct = hasGames ? (wins / total) * 100 : 0;
  const lossPct = hasGames ? 100 - winPct : 0;
  const rateClass = !hasGames
    ? "text-white/25"
    : rate >= 50
      ? "text-green-400"
      : "text-red-400/90";
  return html`
    <div class="flex items-center gap-2">
      <span
        class="text-[10px] font-bold uppercase tracking-wider text-white/50 w-14 shrink-0 truncate"
        title=${label}
      >
        ${label}
      </span>
      <div
        class="flex-1 flex h-5 rounded-md overflow-hidden bg-white/5 text-[11px] font-bold text-white tabular-nums"
        role="img"
        aria-label="${wins} wins, ${losses} losses"
      >
        ${wins > 0
          ? html`<div
              class="bg-malibu-blue flex items-center px-1.5 overflow-hidden whitespace-nowrap"
              style="width:${winPct}%"
            >
              ${wins}W
            </div>`
          : ""}
        ${losses > 0
          ? html`<div
              class="bg-red-500 flex items-center justify-end px-1.5 overflow-hidden whitespace-nowrap"
              style="width:${lossPct}%"
            >
              ${losses}L
            </div>`
          : ""}
      </div>
      <span
        class="text-xs font-bold shrink-0 tabular-nums w-9 text-right ${rateClass}"
      >
        ${hasGames ? `${rate}%` : "—"}
      </span>
    </div>
  `;
}

export function renderMemberStats(
  stats: ClanMemberStats | undefined,
): TemplateResult | string {
  if (!stats) return "";
  return html`
    <div class="mt-1.5 space-y-1">
      ${statBuckets.map(({ key, labelKey }) =>
        renderWLBarRow(
          translateText(labelKey),
          stats[key].wins,
          stats[key].losses,
        ),
      )}
    </div>
  `;
}

export function renderMemberRow(
  member: ClanMember,
  myPublicId: string | null,
): TemplateResult {
  const isMe = member.publicId === myPublicId;
  return html`
    <div
      class="flex flex-col py-2.5 px-3 rounded-xl border
        ${isMe
        ? "bg-malibu-blue/10 border-malibu-blue/20"
        : "bg-white/5 border-white/10"}"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
            ${isMe
            ? "bg-malibu-blue/20 text-aquarius"
            : "bg-white/10 text-white/50"}"
        >
          ${renderRoleIcon(member.role)}
        </div>
        <div class="flex-1 min-w-0 flex flex-col">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <copy-button
                compact
                .copyText=${member.publicId}
                .displayText=${member.publicId}
                .showVisibilityToggle=${false}
                .showCopyIcon=${false}
              ></copy-button>
            </div>
            <span
              class="text-white/30 text-[10px] shrink-0 text-right whitespace-nowrap"
              >${translateText("clan_modal.joined_date", {
                date: formatClanDate(member.joinedAt),
              })}</span
            >
          </div>
        </div>
      </div>
      ${renderMemberStats(member.stats)}
    </div>
  `;
}

export function filterMembersBySearch(
  members: ClanMember[],
  search: string,
): ClanMember[] {
  if (!search) return members;
  const q = search.toLowerCase();
  return members.filter(
    (m) =>
      m.publicId.toLowerCase().includes(q) || m.role.toLowerCase().includes(q),
  );
}

export function filterRequestsBySearch(
  requests: ClanJoinRequest[],
  search: string,
): ClanJoinRequest[] {
  if (!search) return requests;
  const q = search.toLowerCase();
  return requests.filter((r) => r.publicId.toLowerCase().includes(q));
}
