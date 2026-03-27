import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { quickChatPhrases } from "./ChatModal";
import {
  DEFAULT_PRESETS,
  PresetSlot,
  QuickChatPresetService,
} from "./QuickChatPresetService";
import { translateText } from "../../Utils";

const MAX_SLOTS = 5;

@customElement("quick-chat-config-modal")
export class QuickChatConfigModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private slots: PresetSlot[] = [];
  @state() private editingIndex: number | null = null;
  @state() private selectedCategory: string | null = null;
  @state() private confirmReset = false;

  createRenderRoot() {
    return this;
  }

  open() {
    this.slots = QuickChatPresetService.getInstance().load();
    this.editingIndex = null;
    this.selectedCategory = null;
    this.confirmReset = false;
    this.requestUpdate();
    this.modalEl?.open();
  }

  close() {
    this.editingIndex = null;
    this.selectedCategory = null;
    this.confirmReset = false;
    this.modalEl?.close();
  }

  private persist() {
    try {
      QuickChatPresetService.getInstance().save(this.slots);
    } catch (e) {
      console.error("[QuickChatConfigModal] Auto-save failed:", e);
    }
  }

  private reset() {
    if (!this.confirmReset) {
      this.confirmReset = true;
      this.requestUpdate();
      setTimeout(() => {
        this.confirmReset = false;
        this.requestUpdate();
      }, 3000);
      return;
    }
    this.slots = [...DEFAULT_PRESETS];
    this.editingIndex = null;
    this.selectedCategory = null;
    this.confirmReset = false;
    this.persist();
    this.requestUpdate();
  }

  private addSlot() {
    if (this.slots.length >= MAX_SLOTS) return;
    this.slots = [
      ...this.slots,
      { type: "quickchat", category: "help", key: "troops" },
    ];
    this.editingIndex = this.slots.length - 1;
    this.selectedCategory = null;
    this.persist();
    this.requestUpdate();
  }

  private removeSlot(index: number) {
    if (this.slots.length <= 1) return;
    this.slots = this.slots.filter((_, i) => i !== index);
    if (this.editingIndex !== null) {
      if (this.editingIndex === index) {
        this.editingIndex = null;
        this.selectedCategory = null;
      } else if (this.editingIndex > index) {
        this.editingIndex--;
      }
    }
    this.persist();
    this.requestUpdate();
  }

  private selectSlot(index: number) {
    if (this.editingIndex === index) {
      this.editingIndex = null;
      this.selectedCategory = null;
    } else {
      this.editingIndex = index;
      const slot = this.slots[index];
      this.selectedCategory =
        slot.type === "quickchat" ? (slot.category ?? null) : null;
    }
    this.requestUpdate();
  }

  private selectCategory(cat: string) {
    this.selectedCategory = cat;
    this.requestUpdate();
  }

  private assignQcPhrase(category: string, key: string) {
    if (this.editingIndex === null) return;
    this.slots = this.slots.map((s, i) =>
      i === this.editingIndex ? { type: "quickchat", category, key } : s,
    );
    this.persist();
    const next = this.editingIndex + 1;
    if (next < this.slots.length) {
      this.editingIndex = next;
      const nextSlot = this.slots[next];
      this.selectedCategory =
        nextSlot.type === "quickchat" ? (nextSlot.category ?? null) : null;
    } else {
      this.editingIndex = null;
      this.selectedCategory = null;
    }
    this.requestUpdate();
  }

  private assignSpecial(type: "emoji" | "trade") {
    if (this.editingIndex === null) return;
    this.slots = this.slots.map((s, i) =>
      i === this.editingIndex ? { type } : s,
    );
    this.persist();
    this.editingIndex = null;
    this.selectedCategory = null;
    this.requestUpdate();
  }

  private slotLabel(slot: PresetSlot): string {
    if (slot.type === "quickchat" && slot.category && slot.key)
      return translateText(`chat.${slot.category}.${slot.key}`);
    if (slot.type === "emoji") return translateText("quick_chat.emoji_panel");
    if (slot.type === "trade") return translateText("quick_chat.trade_toggle");
    return "?";
  }

  render() {
    const categories = Object.keys(quickChatPhrases);
    const editing =
      this.editingIndex !== null ? this.slots[this.editingIndex] : null;

    return html`
      <o-modal title="${translateText("quick_chat.configure_presets")}">
        <div class="chat-columns">

          <!-- Column 1: preset slots -->
          <div class="chat-column">
            <div class="column-title">${translateText("quick_chat.preset_label")}</div>

            ${this.slots.map(
              (slot, i) => html`
                <div style="display:flex;gap:4px;">
                  <button
                    class="chat-option-button ${this.editingIndex === i ? "selected" : ""}"
                    style="flex:1;"
                    @click=${() => this.selectSlot(i)}
                  >${i + 1}. ${this.slotLabel(slot)}</button>
                  ${this.slots.length > 1
                    ? html`<button
                        class="chat-option-button"
                        style="padding:8px 10px;"
                        @click=${(e: Event) => { e.stopPropagation(); this.removeSlot(i); }}
                      >✕</button>`
                    : null}
                </div>
              `,
            )}

            ${this.slots.length < MAX_SLOTS
              ? html`<button
                  class="chat-option-button"
                  @click=${this.addSlot}
                >${translateText("quick_chat.add_preset")}</button>`
              : null}
          </div>

          <!-- Column 2: category + actions -->
          ${editing !== null
            ? html`
                <div class="chat-column">
                  <div class="column-title">${translateText("chat.category")}</div>

                  ${categories.map(
                    (cat) => html`
                      <button
                        class="chat-option-button ${this.selectedCategory === cat ? "selected" : ""}"
                        @click=${() => this.selectCategory(cat)}
                      >${translateText(`chat.cat.${cat}`)}</button>
                    `,
                  )}

                  <div class="column-title" style="margin-top:8px;">${translateText("quick_chat.actions")}</div>

                  <button
                    class="chat-option-button ${editing.type === "emoji" ? "selected" : ""}"
                    @click=${() => this.assignSpecial("emoji")}
                  >${translateText("quick_chat.emoji_panel")}</button>

                  <button
                    class="chat-option-button ${editing.type === "trade" ? "selected" : ""}"
                    @click=${() => this.assignSpecial("trade")}
                  >${translateText("quick_chat.trade_toggle")}</button>
                </div>
              `
            : null}

          <!-- Column 3: phrases -->
          ${editing !== null && this.selectedCategory
            ? html`
                <div class="chat-column">
                  <div class="column-title">${translateText("chat.phrase")}</div>
                  <div class="phrase-scroll-area">
                    ${(quickChatPhrases[this.selectedCategory] ?? []).map(
                      (phrase) => {
                        const label = translateText(
                          `chat.${this.selectedCategory}.${phrase.key}`,
                        );
                        const isActive =
                          editing.type === "quickchat" &&
                          editing.category === this.selectedCategory &&
                          editing.key === phrase.key;
                        return html`
                          <button
                            class="chat-option-button ${isActive ? "selected" : ""}"
                            @click=${() =>
                              this.assignQcPhrase(
                                this.selectedCategory!,
                                phrase.key,
                              )}
                          >
                            ${label}
                            ${phrase.requiresPlayer
                              ? html`<span style="font-size:10px;opacity:0.4;margin-left:4px;">[needs target]</span>`
                              : null}
                          </button>
                        `;
                      },
                    )}
                  </div>
                </div>
              `
            : null}
        </div>

        <div class="chat-preview" style="font-size:12px;color:#aaa;">
          ${editing !== null
            ? translateText("quick_chat.editing_hint", { n: (this.editingIndex ?? 0) + 1 })
            : translateText("quick_chat.select_hint")}
        </div>

        <div class="chat-send" style="gap:8px;">
          <button class="chat-send-button" @click=${this.close}>
            ${translateText("quick_chat.done")}
          </button>
          <button
            class="chat-option-button"
            style="${this.confirmReset ? "color:#f87171;" : "opacity:0.45;"}"
            @click=${this.reset}
          >${this.confirmReset
            ? translateText("quick_chat.confirm_reset")
            : translateText("quick_chat.reset_defaults")}</button>
        </div>
      </o-modal>
    `;
  }
}
