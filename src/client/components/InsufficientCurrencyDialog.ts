import { html, LitElement, nothing, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { InsufficientCurrency } from "../Cosmetics";
import { translateText } from "../Utils";
import "./ConfirmDialog";
import { rememberPendingPurchase } from "./inventory/PendingEquip";

/**
 * Shown when the player can't afford a cosmetic. Set `.info` to display it and
 * clear it on `@close`. Plutonium gets a top-up button; caps are dismiss-only.
 *
 * On the end screen (`info.leavesGame`) it is its own box, rendered on
 * <body> so the end screen's transformed modal can't clip it, with what a
 * player mid-game needs:
 *   - Plutonium short: "Get Plutonium", and "or buy for N caps" when the caps
 *     price is affordable (`buy-caps`). "Get Plutonium" first warns that it
 *     leaves the game; going on remembers the item (PendingEquip.ts) so the
 *     Store opens on it after the top-up.
 *   - Caps short: how many more and how to earn them. Close only.
 *
 * Elsewhere it is a plain confirm. One from an in-place purchase outside a
 * game (the Inventory's Player card tab) remembers the item too. Either
 * way, "Get Plutonium" first fires a cancelable, bubbling `top-up` event:
 * a parent that cancels it goes on later by calling `detail.go()`, or
 * navigates itself after `detail.remember()` (the Inventory does, once its
 * unsaved card guard allows).
 */
@customElement("insufficient-currency-dialog")
export class InsufficientCurrencyDialog extends LitElement {
  @property({ attribute: false }) info: InsufficientCurrency | null = null;
  /** Where focus goes back to when the end-screen box closes (the Buy
   * button that opened it). */
  @property({ attribute: false }) returnFocus: HTMLElement | null = null;
  // End screen: the leaves-the-game warning is showing.
  @state() private leaving = false;
  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.dropPortal();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has("info")) this.leaving = false;
    const info = this.info;
    if (info?.leavesGame) {
      if (this.portal === null) {
        this.portal = document.createElement("div");
        document.body.appendChild(this.portal);
      }
      litRender(this.renderBox(info), this.portal);
      // Focus moves in when the box opens, and again when its step changes
      // (the buttons are new).
      if (changed.has("info") || changed.has("leaving")) this.focusFirst();
    } else {
      this.dropPortal();
    }
  }

  private dropPortal() {
    if (this.portal === null) return;
    litRender(html``, this.portal);
    this.portal.remove();
    this.portal = null;
    // Back to where the player was: the Buy button that opened the box.
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }

  private buttons(): HTMLButtonElement[] {
    return [
      ...(this.portal?.querySelectorAll<HTMLButtonElement>(
        "[data-shortfall-box] button",
      ) ?? []),
    ];
  }

  private focusFirst() {
    const first = this.buttons().find((b) => b.dataset.shortfallAction);
    (first ?? this.buttons()[0])?.focus();
  }

  // Escape closes; Tab and Shift+Tab stay inside the box.
  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== "Tab") return;
    const buttons = this.buttons();
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.shiftKey
      ? at <= 0
        ? buttons.length - 1
        : at - 1
      : at === -1 || at === buttons.length - 1
        ? 0
        : at + 1;
    e.preventDefault();
    buttons[next].focus();
  };

  private close() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private leaveForTopUp(info: InsufficientCurrency) {
    this.close();
    const remember = () => {
      if (info.player && info.itemKey) {
        rememberPendingPurchase(info.player, info.itemKey);
      }
    };
    const go = () => {
      remember();
      // Home path (not just hash) so it also works from in-game (win modal).
      window.location.href = "/#modal=store&tab=packs";
    };
    const event = new CustomEvent("top-up", {
      detail: { go, remember },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) go();
  }

  private button(
    name: string,
    label: string,
    onClick: () => void,
    primary: boolean,
  ) {
    return html`<button
      type="button"
      data-shortfall-action=${name}
      class="min-h-11 flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
        primary
          ? "bg-amber-600 text-white hover:bg-amber-700"
          : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
      }"
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  private renderBox(info: InsufficientCurrency) {
    const leaving = this.leaving;
    const heading = leaving
      ? translateText("store.top_up_leaves_game_title")
      : translateText("store.insufficient_currency_title", {
          currency: info.currency,
        });
    const message = leaving
      ? translateText("store.top_up_leaves_game", { item: info.item })
      : translateText("store.insufficient_currency_body", {
          amount: info.shortfall,
          currency: info.currency,
          item: info.item,
        });
    const actions = leaving
      ? [
          this.button(
            "stay",
            translateText("store.top_up_stay"),
            () => this.close(),
            false,
          ),
          this.button(
            "leave",
            translateText("store.get_plutonium"),
            () => this.leaveForTopUp(info),
            true,
          ),
        ]
      : info.canTopUp
        ? [
            info.capsPrice === undefined
              ? nothing
              : this.button(
                  "caps",
                  translateText("store.buy_for_caps", {
                    amount: info.capsPrice,
                  }),
                  () => this.dispatchEvent(new CustomEvent("buy-caps")),
                  false,
                ),
            this.button(
              "top-up",
              translateText("store.get_plutonium"),
              () => (this.leaving = true),
              true,
            ),
          ]
        : [
            this.button(
              "close",
              translateText("common.close"),
              () => this.close(),
              true,
            ),
          ];
    return html`<div
      class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}
      @keydown=${this.onKeydown}
    >
      <div
        data-shortfall-box
        role="dialog"
        aria-modal="true"
        class="relative mx-4 w-full max-w-md rounded-2xl border border-amber-500/50 bg-surface p-6 shadow-2xl"
      >
        <button
          type="button"
          aria-label=${translateText("common.close")}
          class="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-white/50 transition-all hover:bg-white/10 hover:text-white"
          @click=${() => this.close()}
        >
          ×
        </button>
        <h2 class="mb-2 pr-10 text-lg font-bold text-white">${heading}</h2>
        <p class="mb-2 text-sm font-medium text-amber-300">${message}</p>
        ${
          !leaving && !info.canTopUp
            ? html`<p class="mb-2 text-sm text-white/70">
                ${translateText("store.earn_caps_hint")}
              </p>`
            : nothing
        }
        <div class="mt-4 flex flex-col gap-2 sm:flex-row">${actions}</div>
      </div>
    </div>`;
  }

  render() {
    const info = this.info;
    if (!info || info.leavesGame) return nothing;
    return html`<confirm-dialog
      .heading=${translateText("store.insufficient_currency_title", {
        currency: info.currency,
      })}
      .message=${translateText("store.insufficient_currency_body", {
        amount: info.shortfall,
        currency: info.currency,
        item: info.item,
      })}
      variant="warning"
      .wide=${true}
      .showClose=${true}
      .buttons=${info.canTopUp ? "confirmOnly" : "none"}
      .confirmText=${
        info.canTopUp
          ? translateText("store.purchase_currency", {
              currency: info.currency,
            })
          : ""
      }
      @cancel=${() => this.close()}
      @confirm=${() => this.leaveForTopUp(info)}
    ></confirm-dialog>`;
  }
}
