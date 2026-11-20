import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ResolvedCosmetic } from "../../Cosmetics";
import { translateText } from "../../Utils";
import { type CardItem, type CardItemType } from "../card/CardItems";
import "../card/PlayerCard";
import {
  buildPlayerCardView,
  type PlayerCardView,
} from "../card/PlayerCardModel";
import {
  cardChangeLine,
  cardSlotItemName,
  cardSlotLabel,
} from "./CardChangeText";
import {
  CARD_SLOT_KIND_LIST,
  CARD_SLOT_KINDS,
  type CardDraft,
  type CardEditor,
  type CardSlotKind,
  type CardSlotRef,
  sameSlot,
  swapPreview,
} from "./CardDraft";
import "./InventoryItemTile";
import {
  compareTiles,
  type ItemState,
  itemStateOf,
  unlockLabel,
} from "./ItemState";

type OwnershipFilter = "owned" | "all" | "notOwned";

interface PickerEntry {
  resolved: ResolvedCosmetic;
  state: ItemState;
  note: string | null;
}

function slotKey(slot: CardSlotRef): string {
  return slot.kind === "background"
    ? "background"
    : `${slot.kind}:${slot.index}`;
}

/**
 * The Inventory's Player card tab (card owners): the card preview with its
 * Saved / With changes switch, the Background row and the ordered rows
 * (trackers), and a picker grid under them for the slot being changed.
 * Changes wait for Save; the state lives in a CardEditor the Inventory
 * holds, which its unsaved-changes guard reads too.
 */
@customElement("inventory-card-tab")
export class InventoryCardTab extends LitElement {
  @property({ attribute: false }) editor: CardEditor | null = null;
  @property({ attribute: false }) userMe: UserMeResponse | null = null;
  @property({ attribute: false }) cosmetics: Cosmetics | null = null;
  /** The in-game flag (its image path) and its name, for the card and the
   * flag line. */
  @property({ attribute: false }) flag: string | undefined = undefined;
  @property({ attribute: false }) flagName: string | null = null;
  /** Bumped when shown prices may have changed (a sale ended). */
  @property({ type: Number }) priceEpoch = 0;

  @state() private openSlot: CardSlotRef | null = null;
  @state() private showing: "saved" | "changes" = "changes";
  @state() private filter: OwnershipFilter = "owned";
  @state() private hovered: string | null = null;
  @state() private unlockNote: string | null = null;
  private dragFrom: { kind: CardSlotKind; index: number } | null = null;
  private unsubscribe: (() => void) | null = null;
  private subscribedTo: CardEditor | null = null;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedTo = null;
  }

  protected willUpdate(): void {
    const editor = this.editor;
    if (editor !== this.subscribedTo) {
      this.unsubscribe?.();
      this.subscribedTo = editor;
      this.unsubscribe = editor?.subscribe(() => this.requestUpdate()) ?? null;
    }
    editor?.seed(this.userMe);
  }

  // ---- Names ---------------------------------------------------------------

  private itemName(slot: CardSlotRef, name: string | null): string {
    return cardSlotItemName(this.cosmetics, slot, name);
  }

  private slotLabel(slot: CardSlotRef): string {
    return cardSlotLabel(slot);
  }

  // ---- Card view -----------------------------------------------------------

  private view(draft: CardDraft): PlayerCardView {
    const me = this.userMe;
    const progress = me?.player.progress;
    const values = this.editor?.values ?? new Map<string, number>();
    return buildPlayerCardView(
      {
        username: me?.player.username ?? me?.player.publicId ?? "",
        clanTag: null,
        flag: this.flag,
        badge: progress
          ? {
              level: progress.level,
              prestige: progress.prestige,
              legend: progress.legend,
            }
          : null,
        card: {
          background: draft.background ?? undefined,
          trackers: draft.rows.tracker
            .filter((s): s is string => s !== null)
            .map((stat) => ({
              stat: stat as never,
              value: values.get(stat) ?? 0,
            })),
        },
      },
      this.cosmetics,
    );
  }

  // ---- Actions -------------------------------------------------------------

  private toggleSlot(slot: CardSlotRef): void {
    this.openSlot =
      this.openSlot !== null && sameSlot(this.openSlot, slot) ? null : slot;
    this.hovered = null;
    this.unlockNote = null;
    this.filter = "owned";
  }

  private onPick(slot: CardSlotRef, entry: PickerEntry): void {
    const editor = this.editor;
    const name = entry.resolved.cosmetic?.name;
    if (!editor || name === undefined) return;
    if (entry.state === "earned") {
      this.unlockNote = translateText("inventory_card.unlock_note", {
        name: this.itemName(slot, name),
        unlock: unlockLabel(entry.resolved) ?? "",
      });
      return;
    }
    this.unlockNote = null;
    this.hovered = null;
    editor.pick(slot, name);
    this.showing = "changes";
  }

  private openStore(type: CardItemType): void {
    this.dispatchEvent(
      new CustomEvent("open-store", {
        detail: { type },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---- Rows ----------------------------------------------------------------

  private renderBackgroundRow(): TemplateResult {
    const editor = this.editor!;
    const slot: CardSlotRef = { kind: "background" };
    const name = editor.draft.background;
    const changed = name !== editor.saved.background;
    const url =
      name !== null ? this.cosmetics?.cardBackgrounds?.[name]?.url : undefined;
    const open = this.openSlot?.kind === "background";
    return html`<button
      type="button"
      data-card-slot="background"
      aria-expanded=${open ? "true" : "false"}
      class="flex min-h-14 w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors ${
        changed ? "border-dashed border-white" : "border-white/10"
      } ${open ? "bg-blue-500/15" : "bg-white/5 hover:bg-white/10"}"
      @click=${() => this.toggleSlot(slot)}
    >
      <span
        class="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-black/40 bg-cover bg-center"
        style=${url ? `background-image:url("${url}")` : ""}
      ></span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span
          class="text-[11px] font-black uppercase tracking-wider text-white/60"
          >${this.slotLabel(slot)}</span
        >
        <span class="truncate text-sm font-bold text-white"
          >${this.itemName(slot, name)}</span
        >
        ${
          changed
            ? html`<span class="text-[11px] text-white/60"
                >${translateText("inventory_card.was", {
                  name: this.itemName(slot, editor.saved.background),
                })}</span
              >`
            : nothing
        }
      </span>
      <span aria-hidden="true" class="text-white/50">›</span>
    </button>`;
  }

  private renderRow(kind: CardSlotKind, index: number): TemplateResult {
    const editor = this.editor!;
    const slot: CardSlotRef = { kind, index };
    const rows = editor.draft.rows[kind];
    const name = rows[index] ?? null;
    const was = editor.saved.rows[kind][index] ?? null;
    const changed = name !== was;
    const open = this.openSlot !== null && sameSlot(this.openSlot, slot);
    const label = this.itemName(slot, name);
    const arrowClass =
      "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-lg font-bold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 md:h-9 md:w-9";
    const up = html`<button
      type="button"
      data-card-row-up
      ?disabled=${index === 0}
      aria-label=${translateText("inventory_card.move_up", { name: label })}
      class=${arrowClass}
      @click=${() => editor.move(kind, index, index - 1)}
    >
      <span aria-hidden="true">↑</span>
    </button>`;
    const down = html`<button
      type="button"
      data-card-row-down
      ?disabled=${index === rows.length - 1}
      aria-label=${translateText("inventory_card.move_down", { name: label })}
      class=${arrowClass}
      @click=${() => editor.move(kind, index, index + 1)}
    >
      <span aria-hidden="true">↓</span>
    </button>`;
    return html`<li
      data-card-slot-row=${slotKey(slot)}
      draggable="true"
      class="flex items-center gap-2 rounded-xl border p-1.5 ${
        changed ? "border-dashed border-white" : "border-white/10"
      } ${open ? "bg-blue-500/15" : "bg-white/5"}"
      @dragstart=${(event: DragEvent) => {
        this.dragFrom = { kind, index };
        event.dataTransfer?.setData("text/plain", String(index));
      }}
      @dragover=${(event: Event) => {
        if (this.dragFrom?.kind === kind) event.preventDefault();
      }}
      @drop=${(event: Event) => {
        event.preventDefault();
        const from = this.dragFrom;
        this.dragFrom = null;
        if (from?.kind === kind) editor.move(kind, from.index, index);
      }}
      @dragend=${() => (this.dragFrom = null)}
    >
      <span
        data-card-row-grip
        aria-hidden="true"
        title=${translateText("inventory_card.drag")}
        class="cursor-grab select-none px-1 text-white/40"
        >⋮⋮</span
      >
      <button
        type="button"
        data-card-row-open
        aria-expanded=${open ? "true" : "false"}
        class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left"
        @click=${() => this.toggleSlot(slot)}
      >
        <span
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
          >${index + 1}</span
        >
        <span class="flex min-w-0 flex-col">
          <span
            class="truncate text-sm font-bold ${
              name === null ? "text-white/50" : "text-white"
            }"
            >${label}</span
          >
          ${
            changed
              ? html`<span class="truncate text-[11px] text-white/60"
                  >${translateText("inventory_card.was", {
                    name: this.itemName(slot, was),
                  })}</span
                >`
              : nothing
          }
        </span>
      </button>
      ${up} ${down}
    </li>`;
  }

  private renderRows(kind: CardSlotKind): TemplateResult {
    const spec = CARD_SLOT_KINDS[kind];
    return html`<section
      data-card-rows=${kind}
      class="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-2"
    >
      <h3
        class="flex items-baseline justify-between px-1 text-[11px] font-black uppercase tracking-wider text-white/60"
      >
        <span>${translateText(`inventory_card.rows_${kind}`)}</span>
        <span class="font-semibold normal-case tracking-normal text-white/40"
          >${translateText("inventory_card.rows_order")}</span
        >
      </h3>
      <ol class="flex flex-col gap-2">
        ${Array.from({ length: spec.rows }, (_, i) => this.renderRow(kind, i))}
      </ol>
    </section>`;
  }

  // ---- Preview -------------------------------------------------------------

  private renderPreview(): TemplateResult {
    const editor = this.editor!;
    const hasChanges = editor.changeCount() > 0;
    const showing = hasChanges ? this.showing : "saved";
    const switchButton = (key: "saved" | "changes", label: string) =>
      html`<button
        type="button"
        data-card-view=${key}
        aria-pressed=${showing === key ? "true" : "false"}
        ?disabled=${!hasChanges && key === "changes"}
        class="min-h-11 rounded-md px-3 text-xs font-bold transition-colors disabled:opacity-40 md:min-h-8 ${
          showing === key
            ? "bg-white/15 text-white"
            : "text-white/60 hover:text-white"
        }"
        @click=${() => (this.showing = key)}
      >
        ${label}
      </button>`;
    const flagNote =
      this.flagName !== null
        ? translateText("inventory_card.flag_note", { flag: this.flagName })
        : translateText("inventory_card.flag_note_none");
    return html`<div class="flex min-w-0 flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label=${translateText("inventory_card.view_label")}
          class="flex rounded-lg border border-white/10 bg-black/30 p-0.5"
        >
          ${switchButton("saved", translateText("inventory_card.view_saved"))}
          ${switchButton("changes", translateText("inventory_card.view_changes"))}
        </div>
        <span class="text-xs text-white/50"
          >${translateText("inventory_card.caption")}</span
        >
      </div>
      <div data-card-preview data-showing=${showing} class="min-w-0">
        <player-card
          size="account"
          animated
          .view=${this.view(showing === "saved" ? editor.saved : editor.draft)}
        ></player-card>
      </div>
      <p data-card-flag-note class="flex gap-1.5 text-xs text-white/60">
        <span aria-hidden="true">ⓘ</span><span>${flagNote}</span>
      </p>
    </div>`;
  }

  // ---- Picker --------------------------------------------------------------

  private resolve(type: CardItemType, item: CardItem): ResolvedCosmetic {
    const key = `${type}:${item.name}`;
    return {
      type,
      cosmetic: item,
      colorPalette: null,
      relationship: this.editor?.owns(key) ? "owned" : "purchasable",
      key,
    };
  }

  private pickerEntries(slot: CardSlotRef): PickerEntry[] {
    const editor = this.editor!;
    const section =
      slot.kind === "background"
        ? (this.cosmetics?.cardBackgrounds ?? {})
        : ((this.cosmetics?.[CARD_SLOT_KINDS[slot.kind].section] ??
            {}) as Record<string, CardItem>);
    const type: CardItemType =
      slot.kind === "background"
        ? "cardBackground"
        : CARD_SLOT_KINDS[slot.kind].type;
    const entries: PickerEntry[] = [];
    for (const item of Object.values(section) as CardItem[]) {
      const resolved = this.resolve(type, item);
      const base = itemStateOf(resolved, false);
      if (base === null) continue;
      entries.push(this.entryFor(slot, resolved, base, editor));
    }
    entries.sort(compareTiles);
    return entries.filter((e) => this.matchesFilter(e.state));
  }

  private entryFor(
    slot: CardSlotRef,
    resolved: ResolvedCosmetic,
    base: ItemState,
    editor: CardEditor,
  ): PickerEntry {
    const name = resolved.cosmetic!.name;
    if (slot.kind === "background") {
      if (editor.draft.background === name) {
        return {
          resolved,
          state: editor.saved.background === name ? "equipped" : "unsaved",
          note: null,
        };
      }
      return { resolved, state: base, note: null };
    }
    const at = editor.draft.rows[slot.kind].indexOf(name);
    if (at === -1) return { resolved, state: base, note: null };
    const unsaved = editor.saved.rows[slot.kind][at] !== name;
    return {
      resolved,
      state: unsaved ? "unsaved" : "equipped",
      note: translateText(
        unsaved ? "inventory_card.not_saved_slot" : "inventory_card.in_slot",
        { slot: at + 1 },
      ),
    };
  }

  private matchesFilter(state: ItemState): boolean {
    switch (this.filter) {
      case "owned":
        return state === "equipped" || state === "owned" || state === "unsaved";
      case "notOwned":
        return state === "forSale" || state === "earned";
      case "all":
        return true;
    }
  }

  private renderFilters(): TemplateResult {
    const filters: Array<[OwnershipFilter, string]> = [
      ["owned", "inventory.filter_owned"],
      ["all", "inventory.filter_all"],
      ["notOwned", "inventory.filter_not_owned"],
    ];
    return html`<div
      role="group"
      aria-label=${translateText("inventory.filter_label")}
      class="flex rounded-lg border border-white/10 bg-black/30 p-0.5"
    >
      ${filters.map(
        ([key, label]) =>
          html`<button
            type="button"
            data-card-filter=${key}
            aria-pressed=${this.filter === key ? "true" : "false"}
            class="min-h-11 rounded-md px-3 text-xs font-bold transition-colors md:min-h-8 ${
              this.filter === key
                ? "bg-blue-600/80 text-white"
                : "text-white/70 hover:text-white"
            }"
            @click=${() => (this.filter = key)}
          >
            ${translateText(label)}
          </button>`,
      )}
    </div>`;
  }

  private artwork(slot: CardSlotRef, item: CardItem): TemplateResult {
    if (slot.kind === "background") {
      return html`<player-card
        size="thumb"
        .view=${buildPlayerCardView(
          {
            username: "",
            clanTag: null,
            badge: null,
            card: { background: item.name, trackers: [] },
          },
          this.cosmetics,
        )}
      ></player-card>`;
    }
    const value = this.editor?.values.get(item.name);
    return html`<span class="flex flex-col items-center justify-center">
      <span class="text-xl font-black tabular-nums text-white"
        >${value === undefined ? "—" : value.toLocaleString()}</span
      >
      <span class="text-[11px] font-bold uppercase tracking-wider text-white/60"
        >${this.itemName(slot, item.name)}</span
      >
    </span>`;
  }

  private hint(slot: CardSlotRef): string {
    const editor = this.editor!;
    if (slot.kind !== "background" && this.hovered !== null) {
      const swap = swapPreview(editor.draft, slot, this.hovered);
      if (swap !== null) {
        return swap.displaced === null
          ? translateText("inventory_card.swap_hint_single", {
              a: this.itemName(slot, swap.moved),
              to: swap.to + 1,
            })
          : translateText("inventory_card.swap_hint", {
              a: this.itemName(slot, swap.moved),
              to: swap.to + 1,
              b: this.itemName(slot, swap.displaced),
              from: swap.from + 1,
            });
      }
    }
    return slot.kind === "background"
      ? ""
      : translateText("inventory_card.swap_note");
  }

  private renderStoreTile(slot: CardSlotRef): TemplateResult {
    const type: CardItemType =
      slot.kind === "background"
        ? "cardBackground"
        : CARD_SLOT_KINDS[slot.kind].type;
    return html`<button
      type="button"
      data-card-store-tile
      class="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 p-4 text-center text-sm font-bold text-sky-300 hover:border-white/40 hover:bg-white/5"
      @click=${() => this.openStore(type)}
    >
      <span>${translateText(`inventory_card.store_tile_${slot.kind}`)}</span>
      <span aria-hidden="true">→</span>
    </button>`;
  }

  private renderPicker(): TemplateResult | typeof nothing {
    const slot = this.openSlot;
    if (slot === null || this.editor === null) return nothing;
    const entries = this.pickerEntries(slot);
    const heading =
      slot.kind === "background"
        ? translateText("inventory_card.pick_background")
        : translateText(`inventory_card.pick_${slot.kind}`, {
            slot: slot.index + 1,
          });
    const current =
      slot.kind === "background"
        ? this.editor.draft.background
        : (this.editor.draft.rows[slot.kind][slot.index] ?? null);
    return html`<section
      data-card-picker=${slotKey(slot)}
      aria-label=${heading}
      class="flex flex-col gap-3 border-t border-white/10 pt-4"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-black uppercase tracking-wider text-white">
          ${heading}
        </h3>
        <p
          data-card-swap-hint
          aria-live="polite"
          class="min-w-0 flex-1 text-xs text-white/60"
        >
          ${this.hint(slot)}
        </p>
        ${this.renderFilters()}
        <button
          type="button"
          data-card-clear-slot
          ?disabled=${current === null}
          class="min-h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-bold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 md:min-h-8"
          @click=${() => this.editor?.pick(slot, null)}
        >
          ${translateText(
            slot.kind === "background"
              ? "inventory.use_default"
              : "inventory_card.leave_empty",
          )}
        </button>
      </div>
      ${
        this.unlockNote !== null
          ? html`<p
              data-card-unlock-note
              role="status"
              class="rounded-lg border border-dashed border-white/30 px-3 py-2 text-sm text-white/80"
            >
              ${this.unlockNote}
            </p>`
          : nothing
      }
      ${
        entries.length === 0
          ? html`<p data-card-picker-empty class="text-sm text-white/60">
              ${translateText(`inventory_card.none_${this.filter}`)}
              ${
                this.filter === "owned"
                  ? html`<button
                      type="button"
                      data-card-show-all
                      class="ml-2 font-bold text-sky-300 hover:underline"
                      @click=${() => (this.filter = "all")}
                    >
                      ${translateText("inventory_card.show_all")}
                    </button>`
                  : nothing
              }
            </p>`
          : nothing
      }
      <div
        data-card-grid
        class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]"
      >
        ${entries.map(
          (entry) =>
            html`<div
              data-card-pick=${entry.resolved.key}
              @mouseenter=${() =>
                (this.hovered = entry.resolved.cosmetic?.name ?? null)}
              @mouseleave=${() => (this.hovered = null)}
              @focusin=${() =>
                (this.hovered = entry.resolved.cosmetic?.name ?? null)}
              @focusout=${() => (this.hovered = null)}
            >
              <inventory-item-tile
                .priceEpoch=${this.priceEpoch}
                .resolved=${entry.resolved}
                .state=${entry.state}
                .note=${entry.note}
                .artwork=${this.artwork(slot, entry.resolved.cosmetic as CardItem)}
                .onActivate=${() => this.onPick(slot, entry)}
              ></inventory-item-tile>
            </div>`,
        )}
        ${this.renderStoreTile(slot)}
      </div>
    </section>`;
  }

  // ---- Render --------------------------------------------------------------

  render() {
    if (this.editor === null || this.userMe === null) return nothing;
    return html`<div data-card-tab class="flex flex-col gap-4">
      <div class="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)] md:items-start">
        <div class="order-2 flex flex-col gap-3 md:order-1">
          ${this.renderBackgroundRow()}
          ${CARD_SLOT_KIND_LIST.map((kind) => this.renderRows(kind))}
        </div>
        <div class="order-1 md:order-2">${this.renderPreview()}</div>
      </div>
      ${this.renderPicker()} ${this.renderSaveBar()} ${this.renderToast()}
    </div>`;
  }

  // ---- Save bar ------------------------------------------------------------

  private save(): void {
    void this.editor?.save();
  }

  private renderSaveButton(): TemplateResult {
    const editor = this.editor!;
    const state = editor.saveState;
    const label =
      state === "saving"
        ? "inventory_card.saving"
        : state === "saved"
          ? "inventory_card.saved"
          : state === "failed"
            ? "inventory_card.save_retry"
            : "inventory_card.save_card";
    const style =
      state === "failed"
        ? "border border-rose-400/60 bg-rose-950 text-rose-100 hover:bg-rose-900"
        : state === "saved"
          ? "border border-white/15 bg-slate-800 text-white"
          : "bg-sky-600 text-white hover:bg-sky-500";
    return html`<button
      type="button"
      data-card-save
      data-save-state=${state}
      ?disabled=${state === "saving" || (state !== "saved" && !editor.canSave())}
      class="flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${style}"
      @click=${() => {
        if (state !== "saved") this.save();
      }}
    >
      ${
        state === "saving"
          ? html`<span
              aria-hidden="true"
              class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
            ></span>`
          : state === "saved"
            ? html`<span aria-hidden="true">✓</span>`
            : nothing
      }
      ${translateText(label)}
    </button>`;
  }

  private renderSaveBar(): TemplateResult | typeof nothing {
    const editor = this.editor!;
    const changes = editor.changes();
    if (changes.length === 0 && editor.saveState === "idle") return nothing;
    return html`<div
      data-card-save-bar
      class="sticky bottom-0 z-30 -mx-3 flex flex-wrap items-center gap-3 border-t border-white/10 bg-slate-950/95 px-3 py-3"
    >
      <div class="flex min-w-0 flex-1 items-center gap-3">
        ${
          changes.length > 0
            ? html`<span
                data-card-change-count
                class="shrink-0 rounded-md border border-dashed border-white px-2 py-0.5 text-xs font-bold text-white"
                >${translateText("inventory_card.changes_not_saved", {
                  count: changes.length,
                })}</span
              >`
            : nothing
        }
        <span
          data-card-changes-summary
          class="hidden min-w-0 truncate text-sm text-white/70 md:inline"
          >${changes.map((c) => cardChangeLine(this.cosmetics, c)).join(" · ")}</span
        >
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${
          changes.length > 0
            ? html`<button
                type="button"
                data-card-discard
                ?disabled=${editor.saveState === "saving"}
                class="min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-50"
                @click=${() => editor.discard()}
              >
                ${translateText("inventory_card.discard")}
              </button>`
            : nothing
        }
        ${this.renderSaveButton()}
      </div>
    </div>`;
  }

  private renderToast(): TemplateResult | typeof nothing {
    if (this.editor?.saveState !== "failed") return nothing;
    return html`<div
      data-card-save-toast
      role="alert"
      class="fixed bottom-24 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-rose-400/50 bg-rose-950 p-3 text-white shadow-2xl"
    >
      <span
        aria-hidden="true"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-sm font-black"
        >!</span
      >
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-sm font-bold"
          >${translateText("inventory_card.save_failed_title")}</span
        >
        <span class="text-xs text-white/80"
          >${translateText("inventory_card.save_failed_body")}</span
        >
      </div>
      <button
        type="button"
        data-card-toast-retry
        class="min-h-11 shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-bold hover:bg-white/20"
        @click=${() => this.save()}
      >
        ${translateText("inventory_card.retry")}
      </button>
    </div>`;
  }
}
