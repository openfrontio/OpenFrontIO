import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

interface FakeClan {
  id: string;
  name: string;
  tag: string;
  leaderPublicId: string;
  members: number;
  isOpen: boolean;
  description: string;
}

interface FakeMember {
  publicId: string;
  displayName: string;
  role: "leader" | "officer" | "member";
}

interface FakeMyClan {
  clan: FakeClan;
  role: "leader" | "officer" | "member";
}

const FAKE_MEMBER_NAMES = [
  "GrandMaster42",
  "Lieutenant_X",
  "BattleHawk",
  "NovaStar",
  "IronWill",
  "StormChaser",
  "PhantomBlade",
  "CrimsonTide",
  "FrostNova",
  "ShadowFang",
  "ThunderStrike",
  "VoidWalker",
  "SkyRaider",
  "IronClad",
  "BlazeFury",
  "NightHawk",
  "StormBreaker",
  "DarkMatter",
  "SolarFlare",
  "GhostReaper",
  "WarHound",
  "DeathStroke",
  "IcePhoenix",
  "FireDragon",
  "WolfBane",
  "SteelViper",
  "ThunderBolt",
  "ShadowKnight",
  "CrimsonWolf",
  "BladeRunner",
  "StarFall",
  "VenomStrike",
  "TitanForge",
  "RogueAgent",
  "ViperKing",
  "StormRider",
  "FrostBite",
  "DarkStar",
  "NeonReaper",
  "CyberWolf",
  "BlitzFire",
  "ToxicShark",
  "SilverArrow",
  "RavenClaw",
  "CosmicDust",
  "ArcticFox",
  "PyroKnight",
];

function generateFakeMembers(count: number, names: string[]): FakeMember[] {
  return names.slice(0, count).map((name, i) => ({
    publicId: `p_${i.toString(16).padStart(6, "0")}`,
    displayName: name,
    role: (i === 0
      ? "leader"
      : i < 3
        ? "officer"
        : "member") as FakeMember["role"],
  }));
}

const FAKE_MEMBERS: Record<string, FakeMember[]> = {
  c1: generateFakeMembers(47, FAKE_MEMBER_NAMES),
  c2: generateFakeMembers(32, [
    "FrostByte",
    "ArcticWind",
    "PolarBear",
    "IceBreaker",
    "SnowDrift",
    "TundraWolf",
    "GlacierKing",
    "Permafrost",
    "BlizzardX",
    "NorthStar",
    "ColdFront",
    "WhiteOut",
    "FreezeFrame",
    "Avalanche",
    "IcePick",
    "WinterSolstice",
    "SubZero",
    "HailStorm",
    "FrostGiant",
    "ChillFactor",
    "SnowBlind",
    "FrozenSolid",
    "IceCap",
    "PolarVortex",
    "FrostFire",
    "ColdSnap",
    "Wintermute",
    "SleetStorm",
    "GlacialPace",
    "IceAge",
    "FrozenThorn",
    "NorthWind",
  ]),
  c3: generateFakeMembers(50, [
    "DarkSovereign",
    "ShadowLord",
    "NightBlade",
    "VoidPrince",
    "DuskFall",
    "MidnightSun",
    "EclipseKing",
    "PhantomRule",
    "GrimReaper",
    "OnyxKnight",
    "BlackMamba",
    "DarkMatter",
    "SilentDeath",
    "NightCrawler",
    "ShadowStep",
    "Oblivion",
    "DarkVeil",
    "TwilightZone",
    "AbyssWalker",
    "NullVoid",
    "DarkForge",
    "CryptKeeper",
    "DeathMarch",
    "NightShade",
    "Penumbra",
    "UmbraKing",
    "DarkFlame",
    "EternalNight",
    "VoidHunter",
    "ShadowCast",
    "DimReaper",
    "BlackIce",
    "NightFury",
    "DarkPulse",
    "Netherworld",
    "GhostFace",
    "DarkSide",
    "VeilStrike",
    "ShadowFire",
    "Blackout",
    "ChaosVoid",
    "DoomBringer",
    "GrimDark",
    "NightTerror",
    "VoidBorn",
    "OnyxBlade",
    "ShadowHeart",
    "DarkTide",
    "NullField",
    "UmbraSoul",
  ]),
  c4: generateFakeMembers(25, [
    "SentinelPrime",
    "GuardianAngel",
    "Watchman",
    "Bulwark",
    "Bastion",
    "Rampart",
    "Phalanx",
    "Citadel",
    "Fortify",
    "Aegis",
    "IronGate",
    "StoneWall",
    "ShieldBearer",
    "WardKeeper",
    "HoldFast",
    "LastStand",
    "IronCurtain",
    "DefenseGrid",
    "Safeguard",
    "BunkerDown",
    "CastleKeep",
    "WallBreaker",
    "Garrison",
    "TowerShield",
    "You",
  ]),
};

const FAKE_CLANS: FakeClan[] = [
  {
    id: "c1",
    name: "Order of the Phoenix",
    tag: "OPX",
    leaderPublicId: "p_000000",
    members: 47,
    isOpen: true,
    description: "Veteran alliance forged in fire. All skill levels welcome.",
  },
  {
    id: "c2",
    name: "Arctic Wolves",
    tag: "AWF",
    leaderPublicId: "p_000000",
    members: 32,
    isOpen: true,
    description: "Northern hemisphere domination. Active daily players only.",
  },
  {
    id: "c3",
    name: "Shadow Empire",
    tag: "SHD",
    leaderPublicId: "p_000000",
    members: 50,
    isOpen: false,
    description: "Invite only. Top 100 players.",
  },
  {
    id: "c4",
    name: "Eternal Guard",
    tag: "ETG",
    leaderPublicId: "p_000000",
    members: 25,
    isOpen: false,
    description: "Elite defensive strategists. Application required.",
  },
];

const FAKE_MY_CLANS: FakeMyClan[] = [
  { clan: FAKE_CLANS[0], role: "leader" },
  { clan: FAKE_CLANS[3], role: "member" },
];

type Tab = "my-clans" | "browse" | "create";
type View = "list" | "detail" | "manage" | "transfer";

@customElement("clan-modal")
export class ClanModal extends BaseModal {
  @state() private activeTab: Tab = "my-clans";
  @state() private view: View = "list";
  @state() private selectedClan: FakeClan | null = null;
  @state() private searchQuery = "";
  @state() private createName = "";
  @state() private createTag = "";
  @state() private createDescription = "";
  @state() private createIsOpen = true;
  @state() private manageName = "";
  @state() private manageDescription = "";
  @state() private manageIsOpen = true;
  @state() private transferTarget: string | null = null;
  @state() private memberPage = 0;
  @state() private membersPerPage = 10;
  @state() private memberSearch = "";

  private readonly perPageOptions = [10, 25, 50];

  private resolveLeaderName(clan: FakeClan): string {
    const members = FAKE_MEMBERS[clan.id];
    if (members) {
      const leader = members.find((m) => m.publicId === clan.leaderPublicId);
      if (leader) return leader.displayName;
    }
    return clan.leaderPublicId;
  }

  private resolveName(publicId: string): string {
    for (const members of Object.values(FAKE_MEMBERS)) {
      const found = members.find((m) => m.publicId === publicId);
      if (found) return found.displayName;
    }
    return publicId;
  }

  render() {
    const content = this.renderInner();

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="clan-modal"
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  protected onClose(): void {
    this.view = "list";
    this.selectedClan = null;
    this.searchQuery = "";
    this.transferTarget = null;
    this.memberPage = 0;
    this.memberSearch = "";
  }

  private renderInner() {
    if (this.selectedClan) {
      if (this.view === "manage") {
        return this.renderManage(this.selectedClan);
      }
      if (this.view === "transfer") {
        return this.renderTransfer(this.selectedClan);
      }
      if (this.view === "detail") {
        return this.renderClanDetail(this.selectedClan);
      }
    }

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })}
        ${this.renderTabs()}
        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1">
          ${this.activeTab === "my-clans"
            ? this.renderMyClans()
            : this.activeTab === "browse"
              ? this.renderBrowse()
              : this.renderCreate()}
        </div>
      </div>
    `;
  }

  private renderTabs() {
    const tabs: { key: Tab; label: string }[] = [
      { key: "my-clans", label: translateText("clan_modal.my_clans") },
      { key: "browse", label: translateText("clan_modal.browse") },
      { key: "create", label: translateText("clan_modal.create") },
    ];

    return html`
      <div class="flex border-b border-white/10 px-4 lg:px-6 gap-1">
        ${tabs.map(
          (tab) => html`
            <button
              @click=${() => {
                this.activeTab = tab.key;
                this.view = "list";
                this.selectedClan = null;
              }}
              class="px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all relative
                ${this.activeTab === tab.key
                ? "text-blue-400"
                : "text-white/40 hover:text-white/70"}"
            >
              ${tab.label}
              ${this.activeTab === tab.key
                ? html`<div
                    class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400"
                  ></div>`
                : ""}
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderMyClans() {
    if (FAKE_MY_CLANS.length === 0) {
      return html`
        <div class="flex flex-col items-center justify-center p-12 text-center">
          <p class="text-white/40 text-sm mb-4">
            ${translateText("clan_modal.no_clans")}
          </p>
          <button
            @click=${() => (this.activeTab = "browse")}
            class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-blue-600/80 hover:bg-blue-600 border border-blue-500/50 rounded-lg transition-all"
          >
            ${translateText("clan_modal.browse")}
          </button>
        </div>
      `;
    }

    return html`
      <div class="p-4 lg:p-6 space-y-3">
        ${FAKE_MY_CLANS.map(({ clan, role }) =>
          this.renderClanCard(clan, role),
        )}
      </div>
    `;
  }

  private renderBrowse() {
    const filtered = FAKE_CLANS.filter((c) => {
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return c.tag.toLowerCase().includes(q);
    });

    return html`
      <div class="p-4 lg:p-6 space-y-4">
        <div class="relative">
          <input
            type="text"
            .value=${this.searchQuery}
            @input=${(e: Event) =>
              (this.searchQuery = (e.target as HTMLInputElement).value)}
            class="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
            placeholder="${translateText("clan_modal.search_placeholder")}"
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
        <div class="space-y-3">
          ${filtered.length === 0
            ? html`<p class="text-white/40 text-sm text-center py-8">
                ${translateText("clan_modal.no_results")}
              </p>`
            : filtered.map((clan) => this.renderClanCard(clan))}
        </div>
      </div>
    `;
  }

  private renderClanCard(clan: FakeClan, role?: string) {
    return html`
      <button
        @click=${() => {
          this.selectedClan = clan;
          this.view = "detail";
          this.memberPage = 0;
          this.memberSearch = "";
        }}
        class="w-full text-left bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-white/20 p-4 transition-all cursor-pointer group"
      >
        <div class="flex items-center gap-4">
          <div
            class="w-12 h-12 rounded-xl bg-gradient-to-br ${clan.isOpen
              ? "from-blue-500/20 to-cyan-500/20"
              : "from-amber-500/20 to-orange-500/20"} flex items-center justify-center border border-white/10 shrink-0"
          >
            <span class="text-white font-bold text-sm">${clan.tag}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-white font-bold truncate">${clan.name}</span>
              ${role
                ? html`<span
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                      ${role === "leader"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-blue-500/20 text-blue-400 border border-blue-500/30"}"
                  >
                    ${role}
                  </span>`
                : ""}
              ${!clan.isOpen
                ? html`<span
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30"
                  >
                    ${translateText("clan_modal.invite_only")}
                  </span>`
                : ""}
            </div>
            <div class="flex items-center gap-4 mt-1 text-xs text-white/40">
              <span>${clan.members} members</span>
              <span>${this.resolveLeaderName(clan)}</span>
            </div>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5 text-white/20 group-hover:text-white/50 transition-colors shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </button>
    `;
  }

  private renderClanDetail(clan: FakeClan) {
    const myClan = FAKE_MY_CLANS.find((mc) => mc.clan.id === clan.id);
    const isLeader = myClan?.role === "leader";
    const isMember = !!myClan;
    const members = FAKE_MEMBERS[clan.id] ?? [
      { name: this.resolveLeaderName(clan), role: "leader" as const },
    ];

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: clan.name,
          onBack: () => {
            this.view = "list";
            this.selectedClan = null;
          },
          ariaLabel: translateText("common.back"),
          rightContent: html`
            <span
              class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >
              [${clan.tag}]
            </span>
          `,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
            <!-- Description -->
            <div class="bg-white/5 rounded-xl border border-white/10 p-5">
              <p class="text-white/70 text-sm">${clan.description}</p>
            </div>

            <!-- Stats Row -->
            <div class="grid grid-cols-3 gap-3">
              ${this.renderStat(
                translateText("clan_modal.members"),
                `${clan.members}`,
              )}
              ${this.renderStat(
                translateText("clan_modal.leader"),
                this.resolveLeaderName(clan),
              )}
              ${this.renderStat(
                translateText("clan_modal.status"),
                clan.isOpen
                  ? translateText("clan_modal.open")
                  : translateText("clan_modal.invite_only"),
              )}
            </div>

            <!-- Members Preview -->
            <div
              class="bg-white/5 rounded-xl border border-white/10 p-5 space-y-3"
            >
              <h3
                class="text-sm font-bold text-white/60 uppercase tracking-wider"
              >
                ${translateText("clan_modal.members")}
              </h3>
              ${this.renderMemberSearch()}
              ${(() => {
                const filtered = this.filterMembers(members);
                return html`
                  <div class="space-y-2">
                    ${this.paginateMembers(filtered).map((m) =>
                      this.renderMemberRow(
                        m,
                        isLeader || myClan?.role === "officer",
                      ),
                    )}
                  </div>
                  ${this.renderMemberPagination(filtered.length)}
                `;
              })()}
            </div>

            <!-- Actions -->
            <div class="flex flex-wrap gap-3">
              ${!isMember && clan.isOpen
                ? html`
                    <button
                      class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5"
                    >
                      ${translateText("clan_modal.join_clan")}
                    </button>
                  `
                : ""}
              ${!isMember && !clan.isOpen
                ? html`
                    <button
                      class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 rounded-xl transition-all shadow-lg hover:shadow-amber-900/40 border border-white/5"
                    >
                      ${translateText("clan_modal.request_invite")}
                    </button>
                  `
                : ""}
              ${isMember && !isLeader
                ? html`
                    <button
                      class="flex-1 px-6 py-3 text-sm font-bold text-white/70 uppercase tracking-wider bg-red-600/30 hover:bg-red-600/50 rounded-xl transition-all border border-red-500/30"
                    >
                      ${translateText("clan_modal.leave_clan")}
                    </button>
                  `
                : ""}
              ${isLeader
                ? html`
                    <button
                      @click=${() => {
                        this.manageName = clan.name;
                        this.manageDescription = clan.description;
                        this.manageIsOpen = clan.isOpen;
                        this.view = "manage";
                      }}
                      class="flex-1 px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-white/10 hover:bg-white/15 rounded-xl transition-all border border-white/10"
                    >
                      ${translateText("clan_modal.manage_clan")}
                    </button>
                    <button
                      @click=${() => {
                        this.transferTarget = null;
                        this.view = "transfer";
                      }}
                      class="px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-amber-600/30 hover:bg-amber-600/50 rounded-xl transition-all border border-amber-500/30"
                    >
                      ${translateText("clan_modal.transfer_leadership")}
                    </button>
                  `
                : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderManage(clan: FakeClan) {
    const members = FAKE_MEMBERS[clan.id] ?? [
      { name: this.resolveLeaderName(clan), role: "leader" as const },
    ];

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.manage_clan"),
          onBack: () => {
            this.view = "detail";
            this.memberPage = 0;
            this.memberSearch = "";
          },
          ariaLabel: translateText("common.back"),
          rightContent: html`
            <span
              class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-white/50 border border-white/10"
            >
              [${clan.tag}]
            </span>
          `,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
            <!-- Edit Settings -->
            <div
              class="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-5"
            >
              <h3
                class="text-sm font-bold text-white/60 uppercase tracking-wider"
              >
                ${translateText("clan_modal.clan_settings")}
              </h3>

              <div>
                <label
                  class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
                  >${translateText("clan_modal.clan_name")}</label
                >
                <input
                  type="text"
                  .value=${this.manageName}
                  @input=${(e: Event) =>
                    (this.manageName = (e.target as HTMLInputElement).value)}
                  maxlength="24"
                  class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
                />
              </div>

              <div>
                <label
                  class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
                  >${translateText("clan_modal.description")}</label
                >
                <textarea
                  .value=${this.manageDescription}
                  @input=${(e: Event) =>
                    (this.manageDescription = (
                      e.target as HTMLTextAreaElement
                    ).value)}
                  maxlength="200"
                  rows="3"
                  class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm resize-none"
                ></textarea>
              </div>

              <div class="flex items-center justify-between">
                <div>
                  <div class="text-white text-sm font-bold">
                    ${translateText("clan_modal.open_clan")}
                  </div>
                  <div class="text-white/40 text-xs">
                    ${translateText("clan_modal.open_clan_desc")}
                  </div>
                </div>
                <button
                  @click=${() => (this.manageIsOpen = !this.manageIsOpen)}
                  class="relative w-12 h-7 rounded-full transition-all ${this
                    .manageIsOpen
                    ? "bg-blue-500"
                    : "bg-white/20"}"
                >
                  <div
                    class="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${this
                      .manageIsOpen
                      ? "left-6"
                      : "left-1"}"
                  ></div>
                </button>
              </div>

              <button
                class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5"
              >
                ${translateText("clan_modal.save_changes")}
              </button>
            </div>

            <!-- Member Management -->
            <div
              class="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4"
            >
              <h3
                class="text-sm font-bold text-white/60 uppercase tracking-wider"
              >
                ${translateText("clan_modal.members")} (${clan.members})
              </h3>
              ${this.renderMemberSearch()}
              ${(() => {
                const filtered = this.filterMembers(members);
                return html`
                  <div class="space-y-2">
                    ${this.paginateMembers(filtered).map((m) =>
                      this.renderManageMemberRow(m),
                    )}
                  </div>
                  ${this.renderMemberPagination(filtered.length)}
                `;
              })()}
            </div>

            <!-- Danger Zone -->
            <div
              class="bg-red-500/5 rounded-2xl border border-red-500/20 p-6 space-y-4"
            >
              <h3
                class="text-sm font-bold text-red-400/80 uppercase tracking-wider"
              >
                ${translateText("clan_modal.danger_zone")}
              </h3>
              <button
                class="w-full px-6 py-3 text-sm font-bold text-red-400 uppercase tracking-wider bg-red-600/20 hover:bg-red-600/30 rounded-xl transition-all border border-red-500/30"
              >
                ${translateText("clan_modal.disband_clan")}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderManageMemberRow(member: FakeMember) {
    const isLeader = member.role === "leader";
    return html`
      <div
        class="flex items-center gap-3 py-3 border-b border-white/5 last:border-0"
      >
        <div
          class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
        >
          ${member.displayName.charAt(0)}
        </div>
        <div class="flex-1 min-w-0">
          <span class="text-white text-sm font-medium truncate block"
            >${member.displayName}</span
          >
          <copy-button
            compact
            .copyText=${member.publicId}
            .displayText=${member.publicId}
            .showVisibilityToggle=${false}
            .showCopyIcon=${false}
          ></copy-button>
        </div>
        <span
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
            ${member.role === "leader"
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            : member.role === "officer"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-white/10 text-white/40 border border-white/10"}"
        >
          ${member.role}
        </span>
        ${!isLeader
          ? html`
              <div class="flex items-center gap-1.5">
                ${member.role === "member"
                  ? html`<button
                      class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400/70 border border-purple-500/20 hover:bg-purple-500/20 hover:text-purple-400 transition-all"
                    >
                      ${translateText("clan_modal.promote")}
                    </button>`
                  : ""}
                ${member.role === "officer"
                  ? html`<button
                      class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60 transition-all"
                    >
                      ${translateText("clan_modal.demote")}
                    </button>`
                  : ""}
                <button
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400/70 border border-red-500/20 hover:bg-red-500/20 hover:text-red-400 transition-all"
                >
                  ${translateText("clan_modal.kick")}
                </button>
              </div>
            `
          : ""}
      </div>
    `;
  }

  private renderTransfer(clan: FakeClan) {
    const members = (FAKE_MEMBERS[clan.id] ?? []).filter(
      (m) => m.role !== "leader",
    );

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("clan_modal.transfer_leadership"),
          onBack: () => (this.view = "detail"),
          ariaLabel: translateText("common.back"),
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1 p-4 lg:p-6">
          <div class="space-y-6">
            <div
              class="bg-amber-500/10 rounded-xl border border-amber-500/20 p-4"
            >
              <p class="text-amber-400/80 text-sm">
                ${translateText("clan_modal.transfer_warning")}
              </p>
            </div>

            ${this.renderMemberSearch()}
            ${(() => {
              const filtered = this.filterMembers(members);
              return html`
                <div class="space-y-2">
                  ${this.paginateMembers(filtered).map(
                    (m) => html`
                      <div
                        @click=${() => (this.transferTarget = m.publicId)}
                        class="flex items-center gap-3 py-3 border-b border-white/5 last:border-0 cursor-pointer rounded-lg px-2 transition-all
                          ${this.transferTarget === m.publicId
                          ? "bg-amber-500/10"
                          : "hover:bg-white/5"}"
                      >
                        <div
                          class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
                        >
                          ${m.displayName.charAt(0)}
                        </div>
                        <div class="flex-1 min-w-0">
                          <span
                            class="text-white text-sm font-medium truncate block"
                            >${m.displayName}</span
                          >
                          <copy-button
                            compact
                            .copyText=${m.publicId}
                            .displayText=${m.publicId}
                            .showVisibilityToggle=${false}
                            .showCopyIcon=${false}
                          ></copy-button>
                        </div>
                        <span
                          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
                            ${m.role === "officer"
                            ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                            : "bg-white/10 text-white/40 border border-white/10"}"
                        >
                          ${m.role}
                        </span>
                        ${this.transferTarget === m.publicId
                          ? html`<svg
                              xmlns="http://www.w3.org/2000/svg"
                              class="w-5 h-5 text-amber-400 shrink-0"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>`
                          : ""}
                      </div>
                    `,
                  )}
                </div>
                ${this.renderMemberPagination(filtered.length)}
              `;
            })()}

            <button
              class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider rounded-xl transition-all border
                ${this.transferTarget
                ? "bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 shadow-lg hover:shadow-amber-900/40 border-white/5"
                : "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"}"
              ?disabled=${!this.transferTarget}
            >
              ${this.transferTarget
                ? translateText("clan_modal.confirm_transfer", {
                    name: this.resolveName(this.transferTarget),
                  })
                : translateText("clan_modal.select_new_leader")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private filterMembers(members: FakeMember[]): FakeMember[] {
    if (!this.memberSearch) return members;
    const q = this.memberSearch.toLowerCase();
    return members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.publicId.toLowerCase().includes(q),
    );
  }

  private paginateMembers(members: FakeMember[]): FakeMember[] {
    const start = this.memberPage * this.membersPerPage;
    return members.slice(start, start + this.membersPerPage);
  }

  private renderMemberSearch() {
    return html`
      <div class="relative">
        <input
          type="text"
          .value=${this.memberSearch}
          @input=${(e: Event) => {
            this.memberSearch = (e.target as HTMLInputElement).value;
            this.memberPage = 0;
          }}
          class="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
          placeholder="${translateText(
            "clan_modal.search_members_placeholder",
          )}"
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
  }

  private renderMemberPagination(totalMembers: number) {
    const totalPages = Math.ceil(totalMembers / this.membersPerPage);
    if (totalMembers <= this.perPageOptions[0]) return html``;

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
          ${this.perPageOptions.map(
            (opt) => html`
              <button
                @click=${() => {
                  this.membersPerPage = opt;
                  this.memberPage = 0;
                }}
                class="px-2 py-1 text-xs font-bold rounded-lg transition-all
                  ${this.membersPerPage === opt
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-white/40 hover:text-white/70 border border-transparent"}"
              >
                ${opt}
              </button>
            `,
          )}
        </div>
        <div class="flex items-center gap-2">
          <button
            @click=${() => (this.memberPage = Math.max(0, this.memberPage - 1))}
            ?disabled=${this.memberPage === 0}
            class="px-2 py-1 text-xs font-bold rounded-lg transition-all
              ${this.memberPage === 0
              ? "text-white/20 cursor-not-allowed"
              : "text-white/60 hover:text-white hover:bg-white/10"}"
          >
            &lt;
          </button>
          <span class="text-xs text-white/50 font-medium">
            ${this.memberPage + 1} / ${totalPages}
          </span>
          <button
            @click=${() =>
              (this.memberPage = Math.min(totalPages - 1, this.memberPage + 1))}
            ?disabled=${this.memberPage >= totalPages - 1}
            class="px-2 py-1 text-xs font-bold rounded-lg transition-all
              ${this.memberPage >= totalPages - 1
              ? "text-white/20 cursor-not-allowed"
              : "text-white/60 hover:text-white hover:bg-white/10"}"
          >
            &gt;
          </button>
        </div>
      </div>
    `;
  }

  private renderStat(label: string, value: string) {
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

  private renderMemberRow(member: FakeMember, showId = false) {
    return html`
      <div
        class="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
      >
        <div
          class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-bold shrink-0"
        >
          ${member.displayName.charAt(0)}
        </div>
        <div class="flex-1 min-w-0">
          <span class="text-white text-sm font-medium truncate block"
            >${member.displayName}</span
          >
          ${showId
            ? html`<copy-button
                compact
                .copyText=${member.publicId}
                .displayText=${member.publicId}
                .showVisibilityToggle=${false}
                .showCopyIcon=${false}
              ></copy-button>`
            : ""}
        </div>
        <span
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0
            ${member.role === "leader"
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            : member.role === "officer"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-white/10 text-white/40 border border-white/10"}"
        >
          ${member.role}
        </span>
      </div>
    `;
  }

  private renderCreate() {
    return html`
      <div class="p-4 lg:p-6">
        <div
          class="w-full max-w-lg mx-auto bg-white/5 rounded-2xl border border-white/10 p-6 space-y-5"
        >
          <div>
            <label
              class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
              >${translateText("clan_modal.clan_name")}</label
            >
            <input
              type="text"
              .value=${this.createName}
              @input=${(e: Event) =>
                (this.createName = (e.target as HTMLInputElement).value)}
              maxlength="24"
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm"
              placeholder="${translateText("clan_modal.clan_name_placeholder")}"
            />
          </div>

          <div>
            <label
              class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
              >${translateText("clan_modal.clan_tag")}</label
            >
            <input
              type="text"
              .value=${this.createTag}
              @input=${(e: Event) =>
                (this.createTag = (
                  e.target as HTMLInputElement
                ).value.toUpperCase())}
              maxlength="5"
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm uppercase"
              placeholder="${translateText("clan_modal.clan_tag_placeholder")}"
            />
          </div>

          <div>
            <label
              class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
              >${translateText("clan_modal.description")}</label
            >
            <textarea
              .value=${this.createDescription}
              @input=${(e: Event) =>
                (this.createDescription = (
                  e.target as HTMLTextAreaElement
                ).value)}
              maxlength="200"
              rows="3"
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10 text-sm resize-none"
              placeholder="${translateText(
                "clan_modal.description_placeholder",
              )}"
            ></textarea>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <div class="text-white text-sm font-bold">
                ${translateText("clan_modal.open_clan")}
              </div>
              <div class="text-white/40 text-xs">
                ${translateText("clan_modal.open_clan_desc")}
              </div>
            </div>
            <button
              @click=${() => (this.createIsOpen = !this.createIsOpen)}
              class="relative w-12 h-7 rounded-full transition-all ${this
                .createIsOpen
                ? "bg-blue-500"
                : "bg-white/20"}"
            >
              <div
                class="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${this
                  .createIsOpen
                  ? "left-6"
                  : "left-1"}"
              ></div>
            </button>
          </div>

          <button
            class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5"
          >
            ${translateText("clan_modal.create_clan")}
          </button>
        </div>
      </div>
    `;
  }
}
