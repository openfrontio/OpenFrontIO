import { AllPlayers } from "@openfront/engine-api/game/GameTypes";
import { Emoji, flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { TerraNulliusImpl } from "@openfront/engine-lib/game/TerraNulliusImpl";
import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  EmojiSection,
  FAVORITE_SLOTS,
  emojiSections,
  favoriteKeyLabel,
  placeFavorite,
} from "../../EmojiKeys";
import {
  CloseViewEvent,
  EmojiKeyEvent,
  EmojiTableVisibleEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { Platform } from "../../Platform";
import { TransformHandler } from "../../TransformHandler";
import { SendEmojiIntentEvent } from "../../Transport";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";

/** Opens the emoji table aimed at a specific player. */
export class ShowPlayerEmojiMenuEvent implements GameEvent {
  constructor(public readonly player: PlayerView) {}
}

@customElement("emoji-table")
export class EmojiTable extends LitElement {
  @state() public isVisible = false;
  public transformHandler: TransformHandler;
  public game: GameView;
  private eventBus: EventBus | null = null;
  private userSettings = new UserSettings();
  /** One entry per favorites slot; null for an empty slot. */
  @state() private favorites: (Emoji | null)[] = [];
  @state() private dragOverSlot: number | null = null;
  /** The emoji being dragged, and its favorites slot if it came from one. */
  private dragged: { emoji: Emoji; fromSlot: number | null } | null = null;

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(ShowEmojiMenuEvent, (e) => {
      const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
      if (!this.game.isValidCoord(cell.x, cell.y)) {
        return;
      }

      const tile = this.game.ref(cell.x, cell.y);
      if (!this.game.hasOwner(tile)) {
        return;
      }

      const targetPlayer = this.game.owner(tile);
      // maybe redundant due to owner check but better safe than sorry
      if (targetPlayer instanceof TerraNulliusImpl) {
        return;
      }

      this.showForPlayer(eventBus, targetPlayer as PlayerView);
    });
    eventBus.on(ShowPlayerEmojiMenuEvent, (e) =>
      this.showForPlayer(eventBus, e.player),
    );
    eventBus.on(EmojiKeyEvent, (e) => {
      const emoji = this.favorites[e.slot];
      if (this.isVisible && emoji) {
        this.onEmojiClicked(emoji);
      }
    });
    eventBus.on(CloseViewEvent, () => {
      if (!this.hidden) {
        this.hideTable();
      }
    });
  }

  private showForPlayer(eventBus: EventBus, targetPlayer: PlayerView) {
    if (this.isVisible) {
      return;
    }
    this.showTable((emoji) => {
      const recipient =
        targetPlayer === this.game.myPlayer() ? AllPlayers : targetPlayer;
      eventBus.emit(
        new SendEmojiIntentEvent(
          recipient,
          flattenedEmojiTable.indexOf(emoji as Emoji),
        ),
      );
      this.hideTable();
    });
  }

  private onEmojiClicked: (emoji: string) => void = () => {};

  private handleBackdropClick = (e: MouseEvent) => {
    const panelContent = this.querySelector(
      'div[class*="bg-zinc-900"]',
    ) as HTMLElement;
    if (panelContent && !panelContent.contains(e.target as Node)) {
      this.hideTable();
    }
  };

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="fixed inset-0 bg-black/15 backdrop-brightness-110 flex items-start sm:items-center justify-center z-10002 pt-4 sm:pt-0"
        @click=${this.handleBackdropClick}
      >
        <div class="relative">
          <!-- Close button -->
          <button
            class="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center
                    bg-zinc-700 hover:bg-red-500 text-white rounded-full shadow-sm transition-colors z-10004"
            @click=${this.hideTable}
          >
            ✕
          </button>

          <div
            class="bg-zinc-900/95 p-3 rounded-xl z-10003 shadow-2xl shadow-black/50 ring-1 ring-white/10
                   max-w-[calc(100vw-32px)] max-h-[calc(100vh-60px)] overflow-y-auto
                   flex flex-col gap-3"
            @contextmenu=${(e: MouseEvent) => e.preventDefault()}
            @wheel=${(e: WheelEvent) => e.stopPropagation()}
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            ${this.renderFavorites()}
            ${emojiSections
              .filter((s) => !s.columns)
              .map((s) => this.renderSection(s))}
            <!-- Fixed-column sections are small, so they share a row. -->
            <div class="flex gap-6">
              ${emojiSections
                .filter((s) => s.columns)
                .map((s) => this.renderSection(s))}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Favorites are set by dragging, so they're hidden on phones. Touch-only
  // devices (tablets) get them without the keyboard shortcut labels.
  private renderFavorites() {
    const empty = this.favorites.every((e) => e === null);
    const showKeys = !Platform.isTouch;
    return html`
      <section class="hidden sm:block">
        <h3
          class="mb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
        >
          ${translateText("emoji_table.favorites")}
        </h3>
        <div class="flex justify-center gap-1">
          ${this.favorites.map((emoji, slot) => {
            let look = "border border-dashed border-zinc-600";
            if (emoji) look = "cursor-pointer bg-white/5 hover:bg-white/10";
            if (this.dragOverSlot === slot) look += " bg-white/20";
            return html`
              <button
                class="relative flex items-center justify-center size-16 rounded-lg text-5xl transition-colors ${look}"
                draggable=${emoji ? "true" : "false"}
                title=${emoji
                  ? translateText("emoji_table.favorite_remove_hint")
                  : ""}
                @click=${() => emoji && this.onEmojiClicked(emoji)}
                @dragstart=${(e: DragEvent) =>
                  emoji && this.startDrag(e, emoji, slot)}
                @dragend=${this.endDrag}
                @dragover=${(e: DragEvent) => this.dragOver(e, slot)}
                @dragleave=${() => (this.dragOverSlot = null)}
                @drop=${(e: DragEvent) => this.drop(e, slot)}
              >
                ${emoji ?? ""}
                ${showKeys
                  ? html`<span
                      class="pointer-events-none absolute top-0.5 left-1.5 text-xs leading-tight font-mono text-zinc-400"
                      translate="no"
                      >${favoriteKeyLabel(slot)}</span
                    >`
                  : null}
              </button>
            `;
          })}
        </div>
        ${empty
          ? html`<p class="mt-1 text-center text-xs text-zinc-500">
              ${translateText(
                showKeys
                  ? "emoji_table.favorites_hint"
                  : "emoji_table.favorites_hint_touch",
              )}
            </p>`
          : null}
      </section>
    `;
  }

  private startDrag(e: DragEvent, emoji: Emoji, fromSlot: number | null) {
    this.dragged = { emoji, fromSlot };
    // Firefox only starts a drag that carries data.
    e.dataTransfer?.setData("text/plain", emoji);
  }

  private dragOver(e: DragEvent, slot: number) {
    if (!this.dragged) return;
    e.preventDefault(); // allow the drop
    this.dragOverSlot = slot;
  }

  private drop(e: DragEvent, slot: number) {
    e.preventDefault();
    if (this.dragged) {
      this.saveFavorites(
        placeFavorite(this.favorites, this.dragged.emoji, slot),
      );
    }
    this.dragged = null;
    this.dragOverSlot = null;
  }

  // drop runs before dragend, so a drag still set here missed every slot. A
  // favorite dragged off its slot that way is removed.
  private endDrag = () => {
    if (this.dragged && this.dragged.fromSlot !== null) {
      const next = [...this.favorites];
      next[this.dragged.fromSlot] = null;
      this.saveFavorites(next);
    }
    this.dragged = null;
    this.dragOverSlot = null;
  };

  private saveFavorites(next: (Emoji | null)[]) {
    this.favorites = next;
    this.userSettings.setFavoriteEmojis(next);
  }

  private renderSection(section: EmojiSection) {
    let grid =
      "grid-cols-[repeat(5,auto)] sm:grid-cols-[repeat(8,auto)] lg:grid-cols-[repeat(10,auto)]";
    if (section.columns === 2) grid = "grid-cols-[repeat(2,auto)]";
    if (section.columns === 3) grid = "grid-cols-[repeat(3,auto)]";
    return html`
      <section>
        <h3
          class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
        >
          ${translateText(section.title)}
        </h3>
        <div class="grid ${grid} gap-1">
          ${section.emojis.map(
            (emoji) => html`
              <button
                class="flex items-center justify-center cursor-pointer size-12 sm:size-14 rounded-lg
                       text-3xl sm:text-4xl hover:bg-white/10 active:bg-white/20 transition-colors"
                draggable="true"
                @click=${() => this.onEmojiClicked(emoji)}
                @dragstart=${(e: DragEvent) => this.startDrag(e, emoji, null)}
                @dragend=${this.endDrag}
              >
                ${emoji}
              </button>
            `,
          )}
        </div>
      </section>
    `;
  }

  hideTable() {
    this.isVisible = false;
    this.eventBus?.emit(new EmojiTableVisibleEvent(false));
    this.requestUpdate();
  }

  showTable(oneEmojiClicked: (emoji: string) => void) {
    this.onEmojiClicked = oneEmojiClicked;
    const stored = this.userSettings.favoriteEmojis();
    this.favorites = Array.from(
      { length: FAVORITE_SLOTS },
      (_, i) => stored[i] ?? null,
    );
    this.isVisible = true;
    this.eventBus?.emit(new EmojiTableVisibleEvent(true));
    this.requestUpdate();
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
