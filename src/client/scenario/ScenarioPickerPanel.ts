import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import type { ScenarioBundle } from "./ScenarioBundle";
import {
  type DownloadedScenario,
  downloadPlayableScenario,
  type ScenarioPlayError,
  scenarioPlayErrorKey,
} from "./ScenarioPicker";
import {
  listMyScenarios,
  listPublishedScenarios,
  scenarioThumbnailUrl,
} from "./ScenariosApi";

/** The scenario and nation to start a game on. */
export interface PlayScenarioDetail {
  bundle: ScenarioBundle;
  nationID: string;
}

/** A playable entry in either list: published, so it has a version. */
interface Entry {
  id: string;
  name: string;
  description: string;
  version: number;
}

type Tab = "mine" | "shared";

/** How many shared scenarios a page loads (the API takes up to 50). */
const PAGE_SIZE = 20;

/**
 * The Solo modal's scenarios, collapsed until opened: the player's own
 * published scenarios and everyone's shared ones. Picking one downloads its
 * latest version and offers its playable nations. Starting the game is the
 * modal's job; this only fires `play-scenario`.
 */
@customElement("scenario-picker-panel")
export class ScenarioPickerPanel extends LitElement {
  /** Whether to list the player's own scenarios (a signed-in account). */
  @property({ type: Boolean }) signedIn = false;
  /** A game is starting: no second one. */
  @property({ type: Boolean }) busy = false;

  @state() private expanded = false;
  @state() private tab: Tab = "shared";
  @state() private mine: Entry[] | "loading" | ScenarioPlayError | null = null;
  @state() private shared: Entry[] = [];
  // The page of shared scenarios "load more" asks for, from 1.
  private nextPage = 1;
  // "idle" until the first page is asked for; "more" once a full page has
  // loaded, so another may follow on "load more".
  @state() private sharedState:
    | "idle"
    | "loading"
    | "more"
    | "done"
    | ScenarioPlayError = "idle";
  @state() private selected: {
    entry: Entry;
    download: DownloadedScenario | "loading" | ScenarioPlayError;
  } | null = null;
  @state() private nationID: string | null = null;
  // Thumbnails that failed to load (none yet, or the endpoint missing).
  @state() private brokenThumbs = new Set<string>();
  // Bumped on every pick and reset, so a download that finishes after its
  // pick was replaced is dropped.
  private pick = 0;
  // Bumped on every reset, so a list that loads after one is dropped.
  private generation = 0;

  createRenderRoot() {
    return this;
  }

  /** Back to collapsed, dropping the lists and any downloaded bundle. */
  reset(): void {
    this.pick++;
    this.generation++;
    this.expanded = false;
    this.mine = null;
    this.shared = [];
    this.nextPage = 1;
    this.sharedState = "idle";
    this.selected = null;
    this.nationID = null;
  }

  private toggle() {
    if (this.expanded) {
      this.expanded = false;
      return;
    }
    this.expanded = true;
    this.showTab(this.signedIn ? "mine" : "shared");
  }

  private showTab(tab: Tab) {
    this.tab = tab;
    if (tab === "mine" && this.mine === null) void this.loadMine();
    if (tab === "shared" && this.sharedState === "idle") void this.loadShared();
  }

  private async loadMine(): Promise<void> {
    const generation = this.generation;
    this.mine = "loading";
    const list = await listMyScenarios();
    if (generation !== this.generation) return;
    this.mine =
      typeof list === "string"
        ? list
        : list.flatMap((s) =>
            // A draft never published has nothing to play.
            s.latestVersion === null
              ? []
              : [{ ...s, version: s.latestVersion }],
          );
  }

  private async loadShared(): Promise<void> {
    const generation = this.generation;
    this.sharedState = "loading";
    const list = await listPublishedScenarios(this.nextPage, PAGE_SIZE);
    if (generation !== this.generation) return;
    if (typeof list === "string") {
      this.sharedState = list;
      return;
    }
    // Something published since the last page shifts this one down; skip
    // what is already listed.
    const listed = new Set(this.shared.map((s) => s.id));
    this.shared = [
      ...this.shared,
      ...list
        .filter((s) => !listed.has(s.id))
        .map((s) => ({ ...s, version: s.latestVersion })),
    ];
    this.nextPage++;
    this.sharedState = list.length < PAGE_SIZE ? "done" : "more";
  }

  private async select(entry: Entry): Promise<void> {
    const pick = ++this.pick;
    this.selected = { entry, download: "loading" };
    this.nationID = null;
    const download = await downloadPlayableScenario(entry.id);
    if (pick !== this.pick) return;
    this.selected = { entry, download };
    if (typeof download !== "string" && download.nations.length === 1) {
      this.nationID = download.nations[0].id;
    }
  }

  private back() {
    this.pick++;
    this.selected = null;
    this.nationID = null;
  }

  private play(download: DownloadedScenario) {
    if (this.nationID === null) return;
    this.dispatchEvent(
      new CustomEvent<PlayScenarioDetail>("play-scenario", {
        detail: { bundle: download.bundle, nationID: this.nationID },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private errorText(error: ScenarioPlayError) {
    return html`<div class="text-sm text-red-400" data-scenario-error>
      ${translateText(scenarioPlayErrorKey(error))}
    </div>`;
  }

  private message(key: string) {
    return html`<div class="text-sm text-white/50">${translateText(key)}</div>`;
  }

  private thumbnail(entry: Entry, size: string): TemplateResult {
    const key = `${entry.id}:${entry.version}`;
    if (this.brokenThumbs.has(key)) {
      return html`<div
        class="${size} shrink-0 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-white/30"
        data-thumbnail-placeholder
      >
        <svg
          class="w-6 h-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>
      </div>`;
    }
    return html`<img
      class="${size} shrink-0 rounded-md object-cover bg-black/30 border border-white/10"
      src=${scenarioThumbnailUrl(entry.id, entry.version)}
      alt=""
      loading="lazy"
      @error=${() => {
        this.brokenThumbs = new Set(this.brokenThumbs).add(key);
      }}
    />`;
  }

  private renderEntry(entry: Entry): TemplateResult {
    return html`<li>
      <button
        type="button"
        class="w-full flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 p-3 text-left transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
        data-scenario-id=${entry.id}
        ?disabled=${this.busy}
        @click=${() => void this.select(entry)}
      >
        ${this.thumbnail(entry, "w-20 h-14")}
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white truncate">${entry.name}</div>
          ${
            entry.description === ""
              ? null
              : html`<div class="text-xs text-white/50 line-clamp-2">
                  ${entry.description}
                </div>`
          }
        </div>
      </button>
    </li>`;
  }

  private renderList(entries: Entry[], emptyKey: string): TemplateResult {
    if (entries.length === 0) return this.message(emptyKey);
    return html`<ul class="flex flex-col gap-2">
      ${entries.map((e) => this.renderEntry(e))}
    </ul>`;
  }

  private renderMine(): TemplateResult {
    const mine = this.mine;
    if (mine === null || mine === "loading") {
      return this.message("scenario_picker.loading");
    }
    if (typeof mine === "string") {
      return html`<div class="flex flex-col gap-2">
        ${this.errorText(mine)}
        ${
          // Signing in again is what fixes that one, not a retry.
          mine === "unauthorized"
            ? null
            : html`<button
                type="button"
                class="self-center px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                data-retry-mine
                @click=${() => void this.loadMine()}
              >
                ${translateText("scenario_picker.retry")}
              </button>`
        }
      </div>`;
    }
    return this.renderList(mine, "scenario_picker.mine_empty");
  }

  private renderShared(): TemplateResult {
    const state = this.sharedState;
    const failed =
      state !== "idle" &&
      state !== "loading" &&
      state !== "more" &&
      state !== "done";
    const listed = this.shared.length > 0;
    let list: TemplateResult | null = null;
    if (listed || state === "done") {
      list = this.renderList(this.shared, "scenario_picker.shared_empty");
    } else if (state === "loading") {
      list = this.message("scenario_picker.loading");
    }
    const more = failed || (listed && state !== "done");
    return html`<div class="flex flex-col gap-2" data-shared-scenarios>
      ${list} ${failed ? this.errorText(state) : null}
      ${
        more
          ? html`<button
              type="button"
              class="self-center px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 disabled:opacity-50"
              data-load-more
              ?disabled=${state === "loading"}
              @click=${() => void this.loadShared()}
            >
              ${translateText(
                state === "loading"
                  ? "scenario_picker.loading"
                  : failed
                    ? "scenario_picker.retry"
                    : "scenario_picker.load_more",
              )}
            </button>`
          : null
      }
    </div>`;
  }

  private renderNations(download: DownloadedScenario): TemplateResult {
    return html`<div class="flex flex-col gap-3">
      <div
        class="text-[11px] font-bold uppercase tracking-wider text-blue-300/80"
      >
        ${translateText("scenario_picker.pick_nation")}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${download.nations.map(
          (n) =>
            html`<button
              type="button"
              class="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-white text-left transition-colors ${
                this.nationID === n.id
                  ? "bg-blue-600/40 border-blue-400"
                  : "bg-white/5 border-white/10 hover:bg-white/10"
              }"
              aria-pressed=${this.nationID === n.id}
              data-nation-id=${n.id}
              @click=${() => (this.nationID = n.id)}
            >
              ${
                n.flag === null
                  ? null
                  : html`<img
                      class="w-6 h-4 shrink-0 object-cover rounded-sm"
                      src=${assetUrl(`flags/${n.flag}.svg`)}
                      alt=""
                    />`
              }
              <span class="truncate">${n.name}</span>
            </button>`,
        )}
      </div>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        data-play-scenario
        ?disabled=${this.nationID === null || this.busy}
        @click=${() => this.play(download)}
      >
        ${translateText(
          this.busy ? "scenario_picker.starting" : "scenario_picker.play",
        )}
      </button>
    </div>`;
  }

  private renderSelected(): TemplateResult | null {
    const selected = this.selected;
    if (selected === null) return null;
    const { entry, download } = selected;
    let body: TemplateResult;
    if (download === "loading") {
      body = this.message("scenario_picker.downloading");
    } else if (typeof download === "string") {
      body = html`<div class="flex items-center gap-3">
        <div class="flex-1">${this.errorText(download)}</div>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
          @click=${() => void this.select(entry)}
        >
          ${translateText("scenario_picker.retry")}
        </button>
      </div>`;
    } else {
      body = this.renderNations(download);
    }
    return html`<div
      class="flex flex-col gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4"
      data-selected-scenario
    >
      <div class="flex items-start gap-3">
        ${this.thumbnail(entry, "w-28 h-20")}
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white">${entry.name}</div>
          <div class="text-xs text-white/60 whitespace-pre-line">
            ${entry.description}
          </div>
        </div>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 disabled:opacity-50"
          data-scenario-back
          ?disabled=${this.busy}
          @click=${this.back}
        >
          ${translateText("common.back")}
        </button>
      </div>
      ${body}
    </div>`;
  }

  private renderTabs(): TemplateResult {
    const tabs: Tab[] = this.signedIn ? ["mine", "shared"] : ["shared"];
    return html`<div class="flex gap-2" role="tablist">
      ${tabs.map(
        (tab) =>
          html`<button
            type="button"
            role="tab"
            aria-selected=${this.tab === tab}
            data-scenario-tab=${tab}
            class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border ${
              this.tab === tab
                ? "bg-malibu-blue/20 border-malibu-blue/50 text-white"
                : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
            }"
            @click=${() => this.showTab(tab)}
          >
            ${translateText(
              tab === "mine"
                ? "scenario_picker.mine"
                : "scenario_picker.shared",
            )}
          </button>`,
      )}
    </div>`;
  }

  render() {
    const expanded = this.expanded;
    return html`<div class="w-full">
      <button
        type="button"
        aria-expanded=${expanded}
        data-scenarios-toggle
        @click=${this.toggle}
        class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-bold text-white uppercase tracking-wider transition-all duration-200 active:scale-[0.99] ${
          expanded
            ? "bg-malibu-blue/20 border-malibu-blue/50"
            : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
        }"
      >
        <svg
          class="w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 2l5 4-5 4z" />
        </svg>
        ${translateText("scenario_picker.title")}
      </button>
      ${
        expanded
          ? html`<div class="mt-4 flex flex-col gap-4">
              ${
                this.selected !== null
                  ? this.renderSelected()
                  : html`${this.renderTabs()}
                    ${this.tab === "mine" ? this.renderMine() : this.renderShared()}`
              }
            </div>`
          : null
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scenario-picker-panel": ScenarioPickerPanel;
  }
}
