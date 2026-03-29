import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import playerAchievementMetadataJson from "../../../../../resources/playerAchievementMetadata.json" with { type: "json" };
import type {
  AchievementsResponse,
  PlayerAchievementJson,
} from "../../../../core/ApiSchemas";
import type { Difficulty } from "../../../../core/game/Game";
import { translateText } from "../../../Utils";

type PlayerAchievementMetadata = {
  difficulty: Difficulty;
};

type PlayerAchievementCard = {
  achievement: string;
  achievedAt: string | null;
  isUnlocked: boolean;
};

const playerAchievementMetadata = playerAchievementMetadataJson as Record<
  string,
  PlayerAchievementMetadata
>;

@customElement("player-achievements")
export class PlayerAchievements extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) achievementGroups: AchievementsResponse = [];

  private get unlockedAchievements(): PlayerAchievementJson[] {
    return this.achievementGroups
      .flatMap((group) => (group.type === "player" ? group.data : []))
      .slice()
      .sort(
        (a, b) =>
          new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime(),
      );
  }

  private get achievements(): PlayerAchievementCard[] {
    const unlockedByKey = new Map(
      this.unlockedAchievements.map((achievement) => [
        achievement.achievement,
        achievement,
      ]),
    );
    const knownKeys = Object.keys(playerAchievementMetadata);
    const achievementKeys = [
      ...knownKeys,
      ...this.unlockedAchievements
        .map((achievement) => achievement.achievement)
        .filter((achievement) => !knownKeys.includes(achievement)),
    ];
    const originalOrder = new Map(
      achievementKeys.map((achievement, index) => [achievement, index]),
    );

    return achievementKeys
      .map((achievement) => {
        const unlockedAchievement = unlockedByKey.get(achievement);
        return {
          achievement,
          achievedAt: unlockedAchievement?.achievedAt ?? null,
          isUnlocked: unlockedAchievement !== undefined,
        };
      })
      .sort((a, b) => {
        if (a.isUnlocked !== b.isUnlocked) {
          return Number(b.isUnlocked) - Number(a.isUnlocked);
        }
        if (a.achievedAt && b.achievedAt) {
          return (
            new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime()
          );
        }
        return (
          (originalOrder.get(a.achievement) ?? 0) -
          (originalOrder.get(b.achievement) ?? 0)
        );
      });
  }

  private formatDate(achievedAt: string): string {
    const date = new Date(achievedAt);
    if (Number.isNaN(date.getTime())) {
      return achievedAt;
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(date);
  }

  private resolveTitle(achievementKey: string): string {
    const translationKey = `achievements.${achievementKey}`;
    const translated = translateText(translationKey);
    return translated === translationKey ? achievementKey : translated;
  }

  private resolveDescription(achievementKey: string): string | null {
    const translationKey = `achievements.${achievementKey}_desc`;
    const translated = translateText(translationKey);
    return translated === translationKey ? null : translated;
  }

  private resolveDifficulty(achievementKey: string): Difficulty | null {
    return playerAchievementMetadata[achievementKey]?.difficulty ?? null;
  }

  private difficultyClasses(difficulty: Difficulty): string {
    switch (difficulty) {
      case "Easy":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-400/25";
      case "Medium":
        return "bg-amber-500/15 text-amber-200 border-amber-400/25";
      case "Hard":
        return "bg-rose-500/15 text-rose-200 border-rose-400/25";
      case "Impossible":
        return "bg-violet-500/15 text-violet-200 border-violet-400/25";
      default:
        return "bg-white/5 text-white/60 border-white/10";
    }
  }

  private renderDifficultyBadge(difficulty: Difficulty | null) {
    if (!difficulty) {
      return html`
        <span
          class="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/50"
        >
          ${translateText("account_modal.unknown_difficulty")}
        </span>
      `;
    }

    const translationKey = `difficulty.${difficulty.toLowerCase()}`;
    const translated = translateText(translationKey);
    const label = translated === translationKey ? difficulty : translated;

    return html`
      <span
        class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${this.difficultyClasses(
          difficulty,
        )}"
      >
        ${label}
      </span>
    `;
  }

  private renderAchievementCard(achievement: PlayerAchievementCard) {
    const difficulty = this.resolveDifficulty(achievement.achievement);
    const description = this.resolveDescription(achievement.achievement);
    const cardClasses = achievement.isUnlocked
      ? "border-white/10 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-black/20"
      : "border-white/6 bg-gradient-to-br from-slate-900/40 via-slate-900/20 to-black/10 opacity-80";

    return html`
      <article
        class="rounded-2xl border p-5 shadow-lg shadow-black/20 ${cardClasses}"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div
              class="text-[11px] font-bold uppercase tracking-[0.24em] text-white/35"
            >
              ${translateText("account_modal.achievement_label")}
            </div>
            <h4 class="mt-2 text-lg font-semibold text-white">
              ${this.resolveTitle(achievement.achievement)}
            </h4>
            ${description
              ? html`
                  <p class="mt-2 text-sm leading-6 text-white/60">
                    ${description}
                  </p>
                `
              : null}
          </div>
          ${this.renderDifficultyBadge(difficulty)}
        </div>

        <div class="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
          <div
            class="text-[11px] font-bold uppercase tracking-[0.24em] text-white/35"
          >
            ${achievement.isUnlocked
              ? translateText("account_modal.achieved_on")
              : translateText("account_modal.status")}
          </div>
          ${achievement.isUnlocked && achievement.achievedAt
            ? html`
                <time
                  class="mt-2 block text-sm font-medium text-white/80"
                  datetime=${achievement.achievedAt}
                >
                  ${this.formatDate(achievement.achievedAt)}
                </time>
              `
            : html`
                <div class="mt-2 text-sm font-medium text-white/50">
                  ${translateText("account_modal.not_unlocked_yet")}
                </div>
              `}
        </div>
      </article>
    `;
  }

  render() {
    if (this.achievements.length === 0) {
      return html`
        <div
          class="rounded-2xl border border-dashed border-white/10 bg-black/10 px-5 py-6 text-sm text-white/45"
        >
          ${translateText("account_modal.no_achievements")}
        </div>
      `;
    }

    return html`
      <div class="max-h-[36rem] overflow-y-auto pr-1 custom-scrollbar">
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          ${this.achievements.map((achievement) =>
            this.renderAchievementCard(achievement),
          )}
        </div>
      </div>
    `;
  }
}
