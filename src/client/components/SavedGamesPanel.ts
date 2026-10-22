import type { SavedGame } from "@openfront/shared/ApiSchemas";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ClientEnv } from "../ClientEnv";
import { showInGameConfirm } from "../InGameModal";
import {
  deleteSavedGame,
  fetchSharedSavedGame,
  listSavedGames,
  type SavedGameError,
  updateSavedGame,
} from "../SavedGamesApi";
import {
  copyToClipboard,
  getMapName,
  renderDuration,
  showToast,
  translateText,
} from "../Utils";

/** Where a save is loaded from: the player's own, or someone's shared one. */
export interface LoadSavedGameDetail {
  id: string;
  shared: boolean;
}

/** The link that opens a shared save in the Solo modal. */
export function savedGameShareUrl(id: string): string {
  return `${ClientEnv.shareOrigin()}/#modal=single-player&save=${encodeURIComponent(id)}`;
}

/**
 * The Solo modal's saved games: a shared save opened from a link, and the
 * signed-in player's own saves. Starting one is the modal's job; this only
 * fires `load-saved-game`.
 */
@customElement("saved-games-panel")
export class SavedGamesPanel extends LitElement {
  /** Whether to list the player's own saves (a signed-in account). */
  @property({ type: Boolean }) signedIn = false;
  /** A shared save to offer, from a `#modal=single-player&save=` link. */
  @property({ attribute: false }) sharedId: string | null = null;
  /** A game is starting: no second one. */
  @property({ type: Boolean }) busy = false;

  @state() private saves: SavedGame[] | "loading" | "error" = "loading";
  @state() private shared: SavedGame | SavedGameError | "loading" | null = null;
  @state() private renamingId: string | null = null;
  @state() private renameValue = "";
  // The row with a request in flight; its buttons are off until it settles.
  @state() private pendingId: string | null = null;
  @state() private rowError: { id: string; message: string } | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  protected willUpdate(changed: Map<string | number | symbol, unknown>) {
    // connectedCallback covers the first render; later sign-ins load here.
    if (changed.has("signedIn") && changed.get("signedIn") !== undefined) {
      void this.refresh();
    }
    if (changed.has("sharedId")) void this.loadShared();
  }

  async refresh(): Promise<void> {
    if (!this.signedIn) return;
    this.saves = "loading";
    const saves = await listSavedGames();
    this.saves = saves === false ? "error" : saves;
  }

  private async loadShared(): Promise<void> {
    const id = this.sharedId;
    if (id === null) {
      this.shared = null;
      return;
    }
    this.shared = "loading";
    const result = await fetchSharedSavedGame(id);
    // Superseded by another link while this one loaded.
    if (this.sharedId === id) this.shared = result;
  }

  private load(id: string, shared: boolean) {
    this.dispatchEvent(
      new CustomEvent<LoadSavedGameDetail>("load-saved-game", {
        detail: { id, shared },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private replace(updated: SavedGame) {
    if (!Array.isArray(this.saves)) return;
    this.saves = this.saves.map((s) => (s.id === updated.id ? updated : s));
  }

  private errorText(error: SavedGameError, sharing: boolean): string {
    if (error === "rejected") {
      return translateText(
        sharing
          ? "saved_games.error.name_not_shareable"
          : "saved_games.error.name_invalid",
      );
    }
    if (error === "not_found") {
      return translateText("saved_games.error.not_found");
    }
    return translateText("saved_games.error.request_failed");
  }

  private async run(
    save: SavedGame,
    work: () => Promise<SavedGame | SavedGameError>,
    sharing: boolean,
  ): Promise<boolean> {
    this.pendingId = save.id;
    this.rowError = null;
    try {
      const result = await work();
      if (typeof result === "string") {
        this.rowError = {
          id: save.id,
          message: this.errorText(result, sharing),
        };
        return false;
      }
      this.replace(result);
      return true;
    } finally {
      this.pendingId = null;
    }
  }

  private async toggleShared(save: SavedGame) {
    const makePublic = !save.public;
    const ok = await this.run(
      save,
      () => updateSavedGame(save.id, { public: makePublic }),
      makePublic,
    );
    if (ok && makePublic) await this.copyLink(save.id);
  }

  private async copyLink(id: string) {
    try {
      await copyToClipboard(savedGameShareUrl(id));
      showToast(translateText("saved_games.link_copied"), "green");
    } catch {
      showToast(translateText("saved_games.error.copy_failed"), "red");
    }
  }

  private startRename(save: SavedGame) {
    this.renamingId = save.id;
    this.renameValue = save.name;
    this.rowError = null;
  }

  private async submitRename(save: SavedGame) {
    const name = this.renameValue.trim();
    if (name === "" || name === save.name) {
      this.renamingId = null;
      return;
    }
    const ok = await this.run(
      save,
      () => updateSavedGame(save.id, { name }),
      save.public,
    );
    if (ok) this.renamingId = null;
  }

  private async deleteSave(save: SavedGame) {
    const confirmed = await showInGameConfirm(
      translateText("saved_games.delete_confirm", { name: save.name }),
    );
    if (!confirmed) return;
    this.pendingId = save.id;
    this.rowError = null;
    try {
      const result = await deleteSavedGame(save.id);
      // Already gone is as good as deleted.
      if (result === true || result === "not_found") {
        if (Array.isArray(this.saves)) {
          this.saves = this.saves.filter((s) => s.id !== save.id);
        }
        return;
      }
      this.rowError = {
        id: save.id,
        message: this.errorText(result, false),
      };
    } finally {
      this.pendingId = null;
    }
  }

  private details(save: SavedGame): string {
    return [
      getMapName(save.map) ?? save.map,
      renderDuration(save.tick / 10),
      new Date(save.createdAt).toLocaleDateString(),
    ].join(" · ");
  }

  private button(
    label: string,
    onClick: () => void,
    opts: { primary?: boolean; disabled?: boolean; attr?: string } = {},
  ): TemplateResult {
    const tone = opts.primary
      ? "bg-blue-600 hover:bg-blue-500 text-white"
      : "bg-white/5 hover:bg-white/10 text-white/80 border border-white/10";
    return html`<button
      class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tone}"
      data-action=${opts.attr ?? ""}
      ?disabled=${opts.disabled ?? false}
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  private renderShared(): TemplateResult | null {
    const shared = this.shared;
    if (shared === null) return null;
    let body: TemplateResult;
    if (shared === "loading") {
      body = html`<div class="text-sm text-white/50">
        ${translateText("saved_games.loading")}
      </div>`;
    } else if (typeof shared === "string") {
      body = html`<div class="text-sm text-red-400" data-shared-error>
        ${translateText(
          shared === "not_found"
            ? "saved_games.error.shared_not_found"
            : "saved_games.error.request_failed",
        )}
      </div>`;
    } else {
      body = html`<div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white truncate">${shared.name}</div>
          <div class="text-xs text-white/50">${this.details(shared)}</div>
        </div>
        ${this.button(
          translateText("saved_games.play"),
          () => this.load(shared.id, true),
          { primary: true, disabled: this.busy, attr: "play-shared" },
        )}
      </div>`;
    }
    return html`<div
      class="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4"
      data-shared-save
    >
      <div
        class="mb-2 text-[11px] font-bold uppercase tracking-wider text-blue-300/80"
      >
        ${translateText("saved_games.shared_title")}
      </div>
      ${body}
    </div>`;
  }

  private renderRow(save: SavedGame): TemplateResult {
    const pending = this.pendingId === save.id;
    const renaming = this.renamingId === save.id;
    const error = this.rowError?.id === save.id ? this.rowError.message : null;
    return html`<li
      class="flex flex-col gap-2 rounded-lg bg-white/5 border border-white/10 p-3"
      data-save-id=${save.id}
    >
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          ${renaming
            ? html`<input
                class="w-full rounded-md bg-black/30 border border-white/20 px-2 py-1 text-sm text-white"
                maxlength="64"
                aria-label=${translateText("saved_games.rename")}
                .value=${this.renameValue}
                @input=${(e: Event) =>
                  (this.renameValue = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") void this.submitRename(save);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    this.renamingId = null;
                  }
                }}
              />`
            : html`<div class="flex items-center gap-2">
                <span class="font-semibold text-white truncate"
                  >${save.name}</span
                >
                ${save.public
                  ? html`<span
                      class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-green-500/20 text-green-300"
                      >${translateText("saved_games.shared_badge")}</span
                    >`
                  : null}
              </div>`}
          <div class="text-xs text-white/50">${this.details(save)}</div>
        </div>
        ${this.button(
          translateText("saved_games.play"),
          () => this.load(save.id, false),
          { primary: true, disabled: this.busy || pending, attr: "play" },
        )}
      </div>
      <div class="flex flex-wrap gap-2">
        ${renaming
          ? html`${this.button(
              translateText("saved_games.rename_save"),
              () => void this.submitRename(save),
              { disabled: pending, attr: "rename-save" },
            )}
            ${this.button(
              translateText("common.cancel"),
              () => (this.renamingId = null),
              { disabled: pending },
            )}`
          : this.button(
              translateText("saved_games.rename"),
              () => this.startRename(save),
              { disabled: pending, attr: "rename" },
            )}
        ${this.button(
          translateText(
            save.public ? "saved_games.unshare" : "saved_games.share",
          ),
          () => void this.toggleShared(save),
          { disabled: pending, attr: "toggle-share" },
        )}
        ${save.public
          ? this.button(
              translateText("saved_games.copy_link"),
              () => void this.copyLink(save.id),
              { attr: "copy-link" },
            )
          : null}
        ${this.button(
          translateText("saved_games.delete"),
          () => void this.deleteSave(save),
          { disabled: pending, attr: "delete" },
        )}
      </div>
      ${error !== null
        ? html`<div class="text-xs text-red-400" data-row-error>${error}</div>`
        : null}
    </li>`;
  }

  private renderOwn(): TemplateResult | null {
    if (!this.signedIn) return null;
    const saves = this.saves;
    let body: TemplateResult;
    if (saves === "loading") {
      body = html`<div class="text-sm text-white/50">
        ${translateText("saved_games.loading")}
      </div>`;
    } else if (saves === "error") {
      body = html`<div class="text-sm text-red-400">
        ${translateText("saved_games.error.list_failed")}
      </div>`;
    } else if (saves.length === 0) {
      body = html`<div class="text-sm text-white/50" data-saves-empty>
        ${translateText("saved_games.empty")}
      </div>`;
    } else {
      body = html`<ul class="flex flex-col gap-2">
        ${saves.map((s) => this.renderRow(s))}
      </ul>`;
    }
    return html`<div data-own-saves>
      <div
        class="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/60"
      >
        ${translateText("saved_games.title")}
      </div>
      ${body}
    </div>`;
  }

  render() {
    const shared = this.renderShared();
    const own = this.renderOwn();
    if (shared === null && own === null) return null;
    return html`<div class="flex flex-col gap-4">${shared}${own}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "saved-games-panel": SavedGamesPanel;
  }
}
