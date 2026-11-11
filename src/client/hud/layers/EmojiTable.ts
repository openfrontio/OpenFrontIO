import { AllPlayers } from "@openfront/engine-api/game/GameTypes";
import { Emoji, flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { TerraNulliusImpl } from "@openfront/engine-lib/game/TerraNulliusImpl";
import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { LitElement, html, nothing } from "lit";
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
import { HUD_LABEL, hudModalHeader } from "../HudModal";

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
  @state() private dragged: { emoji: Emoji; fromSlot: number | null } | null =
    null;

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
    if (e.target === e.currentTarget) {
      this.hideTable();
    }
  };

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="fixed inset-0 z-10002 flex items-start justify-center bg-black/15 pt-4 backdrop-brightness-110 sm:items-center sm:pt-0"
        @click=${this.handleBackdropClick}
        @dragover=${this.dragOverElsewhere}
        @drop=${this.dropElsewhere}
      >
        <div
          role="dialog"
          aria-labelledby="emoji-table-title"
          class="hud-modal flex max-h-[calc(100dvh-48px)] max-w-[calc(100vw-24px)] flex-col overflow-hidden text-white animate-hud-rise motion-reduce:animate-none"
          @contextmenu=${(e: MouseEvent) => e.preventDefault()}
          @wheel=${(e: WheelEvent) => e.stopPropagation()}
        >
          ${hudModalHeader({
            title: translateText("emoji_table.title"),
            titleId: "emoji-table-title",
            onClose: () => this.hideTable(),
          })}
          <div class="flex flex-col gap-3 overflow-y-auto p-4">
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
    const hint = translateText(
      showKeys
        ? "emoji_table.favorites_hint"
        : "emoji_table.favorites_hint_touch",
    );
    return html`
      <section class="hidden sm:block">
        <h3 class="mb-1 ${HUD_LABEL}">
          ${translateText("emoji_table.favorites")}
        </h3>
        <div class="group flex gap-2" ?data-dragging=${this.dragged !== null}>
          ${this.favorites.map((emoji, slot) => {
            let look = "bg-white/6 ring-1 ring-white/12 text-white/30";
            if (emoji) {
              look =
                "cursor-pointer bg-white/10 ring-1 ring-white/20 hover:bg-white/15";
            }
            // The drag mark is more specific than plain utilities, so the slot
            // under the pointer leaves it out to show its own look.
            if (this.dragOverSlot === slot) {
              look = "bg-malibu-blue/30 ring-2 ring-aquarius";
            } else {
              look +=
                " group-data-dragging:bg-malibu-blue/15 group-data-dragging:ring-aquarius/60";
            }
            return html`
              <button
                class="relative flex size-14 items-center justify-center rounded-lg text-3xl ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius ${look}"
                draggable=${emoji ? "true" : "false"}
                title=${
                  emoji
                    ? translateText("emoji_table.favorite_remove_hint")
                    : hint
                }
                aria-label=${emoji ? nothing : hint}
                @click=${() => emoji && this.onEmojiClicked(emoji)}
                @dragstart=${(e: DragEvent) =>
                  emoji && this.startDrag(e, emoji, slot)}
                @dragend=${this.endDrag}
                @dragover=${(e: DragEvent) => this.dragOver(e, slot)}
                @dragleave=${() => (this.dragOverSlot = null)}
                @drop=${(e: DragEvent) => this.drop(e, slot)}
              >
                <!-- Raised to leave room for the key label. Like the label, it
                     ignores the pointer, or dragging over it would fire a
                     dragleave on the slot. -->
                <span
                  class="pointer-events-none ${showKeys ? "-translate-y-2.5" : ""}"
                >
                  ${emoji ?? html`<of-icon name="plus" size="18"></of-icon>`}
                </span>
                ${
                  showKeys
                    ? html`<span
                        class="pointer-events-none absolute bottom-1 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 rounded-sm bg-white/10 px-1 text-[11px] font-bold uppercase leading-4 text-white/70"
                        translate="no"
                        >${favoriteKeyLabel(slot)}</span
                      >`
                    : null
                }
              </button>
            `;
          })}
        </div>
        ${empty ? html`<p class="mt-2 text-xs text-white/55">${hint}</p>` : null}
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

  // Anywhere else in the table accepts a dragged favorite, and dropping it
  // there removes it. A slot's drop runs first and clears `dragged`, so
  // drops on slots never get here. A cancelled drag (Escape) never drops, so
  // it keeps the favorite.
  private dragOverElsewhere = (e: DragEvent) => {
    if (this.dragged && this.dragged.fromSlot !== null) e.preventDefault();
  };

  private dropElsewhere = (e: DragEvent) => {
    if (!this.dragged || this.dragged.fromSlot === null) return;
    e.preventDefault();
    const next = [...this.favorites];
    next[this.dragged.fromSlot] = null;
    this.saveFavorites(next);
    this.dragged = null;
    this.dragOverSlot = null;
  };

  private endDrag = () => {
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
        <h3 class="mb-1 ${HUD_LABEL}">${translateText(section.title)}</h3>
        <div class="grid ${grid} gap-1">
          ${section.emojis.map(
            (emoji) => html`
              <button
                class="flex items-center justify-center cursor-pointer size-12 sm:size-14 rounded-lg
                       text-3xl sm:text-4xl hover:bg-white/10 active:bg-white/20 transition-colors
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius"
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
    // Closing mid-drag removes the dragged button, so its dragend may never
    // come.
    this.dragged = null;
    this.dragOverSlot = null;
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
