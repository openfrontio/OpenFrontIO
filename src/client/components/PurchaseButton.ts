import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import { translateText } from "../Utils";
import "./CapIcon";
import "./PlutoniumIcon";

const PURCHASE_STYLE_ID = "purchase-button-styles";
if (!document.getElementById(PURCHASE_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = PURCHASE_STYLE_ID;
  style.textContent = `
    @keyframes purchase-streak {
      0%   { left: -60%; opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 1; }
      100% { left: 160%; opacity: 0; }
    }
    .purchase-sparkle-streak {
      pointer-events: none;
      position: absolute;
      top: 0;
      left: -60%;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent 0%, rgba(134,239,172,0.5) 50%, transparent 100%);
      transform: skewX(-15deg);
      opacity: 0;
    }
    cosmetic-container:hover .purchase-sparkle-streak {
      animation: purchase-streak 0.7s ease-in-out;
    }
    cosmetic-container:hover .purchase-sparkle-btn {
      background: rgb(34,197,94);
      border-color: rgb(74,222,128);
      color: white;
      box-shadow: 0 0 20px rgba(74,222,128,0.6);
    }
    cosmetic-container:hover .purchase-sparkle-btn-hard {
      background: rgb(22,163,74);
      border-color: rgb(74,222,128);
      color: white;
      box-shadow: 0 0 20px rgba(74,222,128,0.6);
    }
    cosmetic-container:hover .purchase-sparkle-btn-soft {
      background: rgb(180,83,9);
      border-color: rgb(217,119,6);
      color: white;
      box-shadow: 0 0 20px rgba(217,119,6,0.6);
    }
    @keyframes purchase-pulse {
      0%   { box-shadow: 0 0 15px rgba(74,222,128,0.6), 0 0 30px rgba(34,197,94,0.3); }
      50%  { box-shadow: 0 0 25px rgba(74,222,128,0.9), 0 0 50px rgba(34,197,94,0.5); }
      100% { box-shadow: 0 0 15px rgba(74,222,128,0.6), 0 0 30px rgba(34,197,94,0.3); }
    }
    .purchase-sparkle-btn:hover {
      background: rgb(22,163,74) !important;
      border-color: rgb(74,222,128) !important;
      color: white !important;
      animation: purchase-pulse 1.2s ease-in-out infinite !important;
    }
    .purchase-sparkle-btn-hard:hover {
      background: rgb(22,163,74) !important;
      border-color: rgb(74,222,128) !important;
      color: white !important;
      animation: purchase-pulse 1.2s ease-in-out infinite !important;
    }
    @keyframes purchase-pulse-soft {
      0%   { box-shadow: 0 0 15px rgba(217,119,6,0.6), 0 0 30px rgba(180,83,9,0.3); }
      50%  { box-shadow: 0 0 25px rgba(217,119,6,0.9), 0 0 50px rgba(180,83,9,0.5); }
      100% { box-shadow: 0 0 15px rgba(217,119,6,0.6), 0 0 30px rgba(180,83,9,0.3); }
    }
    .purchase-sparkle-btn-soft:hover {
      background: rgb(180,83,9) !important;
      border-color: rgb(217,119,6) !important;
      color: white !important;
      animation: purchase-pulse-soft 1.2s ease-in-out infinite !important;
    }
    @keyframes purchase-ember-0 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-35px) translateX(5px) scale(0.2); opacity: 0; }
    }
    @keyframes purchase-ember-1 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-30px) translateX(-6px) scale(0.3); opacity: 0; }
    }
    @keyframes purchase-ember-2 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-40px) translateX(3px) scale(0.2); opacity: 0; }
    }
    @keyframes purchase-ember-3 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-28px) translateX(-4px) scale(0.3); opacity: 0; }
    }
    .purchase-ember {
      pointer-events: none;
      position: absolute;
      top: 0;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: rgba(74,222,128,0.9);
      box-shadow: 0 0 4px rgba(74,222,128,0.8);
      opacity: 0;
      display: none;
    }
    .purchase-ember-0 { left: 20%; animation: purchase-ember-0 1.2s ease-out infinite; }
    .purchase-ember-1 { left: 40%; animation: purchase-ember-1 1.5s ease-out infinite 0.25s; }
    .purchase-ember-2 { left: 60%; animation: purchase-ember-2 1.3s ease-out infinite 0.5s; }
    .purchase-ember-3 { left: 80%; animation: purchase-ember-3 1.6s ease-out infinite 0.15s; }
    cosmetic-container:hover .purchase-ember {
      display: block;
    }
    @keyframes purchase-burst-a { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-70px) translateX(14px) scale(0); opacity:0; } }
    @keyframes purchase-burst-b { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-60px) translateX(-12px) scale(0); opacity:0; } }
    @keyframes purchase-burst-c { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-80px) translateX(8px) scale(0); opacity:0; } }
    @keyframes purchase-burst-d { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-55px) translateX(-16px) scale(0); opacity:0; } }
    @keyframes purchase-burst-e { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-75px) translateX(18px) scale(0); opacity:0; } }
    @keyframes purchase-burst-f { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-65px) translateX(-6px) scale(0); opacity:0; } }
    .purchase-burst {
      pointer-events: none;
      position: absolute;
      top: 0;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: rgba(74,222,128,1);
      box-shadow: 0 0 6px rgba(74,222,128,0.9), 0 0 2px rgba(255,255,255,0.5);
      opacity: 0;
      display: none;
    }
    .purchase-burst-0  { left: 3%;  animation: purchase-burst-a 0.9s  ease-out infinite 0.00s; }
    .purchase-burst-1  { left: 8%;  animation: purchase-burst-d 1.1s  ease-out infinite 0.73s; }
    .purchase-burst-2  { left: 12%; animation: purchase-burst-c 0.95s ease-out infinite 0.41s; }
    .purchase-burst-3  { left: 16%; animation: purchase-burst-f 1.05s ease-out infinite 0.17s; }
    .purchase-burst-4  { left: 20%; animation: purchase-burst-b 0.85s ease-out infinite 0.89s; }
    .purchase-burst-5  { left: 24%; animation: purchase-burst-e 1.0s  ease-out infinite 0.53s; }
    .purchase-burst-6  { left: 28%; animation: purchase-burst-a 1.1s  ease-out infinite 0.29s; }
    .purchase-burst-7  { left: 32%; animation: purchase-burst-c 0.9s  ease-out infinite 0.97s; }
    .purchase-burst-8  { left: 36%; animation: purchase-burst-f 1.05s ease-out infinite 0.61s; }
    .purchase-burst-9  { left: 40%; animation: purchase-burst-d 0.95s ease-out infinite 0.07s; }
    .purchase-burst-10 { left: 44%; animation: purchase-burst-b 1.0s  ease-out infinite 0.83s; }
    .purchase-burst-11 { left: 48%; animation: purchase-burst-e 0.85s ease-out infinite 0.37s; }
    .purchase-burst-12 { left: 52%; animation: purchase-burst-a 1.1s  ease-out infinite 0.67s; }
    .purchase-burst-13 { left: 56%; animation: purchase-burst-f 0.9s  ease-out infinite 0.11s; }
    .purchase-burst-14 { left: 60%; animation: purchase-burst-c 1.05s ease-out infinite 0.79s; }
    .purchase-burst-15 { left: 64%; animation: purchase-burst-d 0.95s ease-out infinite 0.47s; }
    .purchase-burst-16 { left: 68%; animation: purchase-burst-b 1.0s  ease-out infinite 0.23s; }
    .purchase-burst-17 { left: 72%; animation: purchase-burst-e 0.85s ease-out infinite 1.03s; }
    .purchase-burst-18 { left: 76%; animation: purchase-burst-a 1.1s  ease-out infinite 0.57s; }
    .purchase-burst-19 { left: 80%; animation: purchase-burst-f 0.95s ease-out infinite 0.31s; }
    .purchase-burst-20 { left: 6%;  animation: purchase-burst-b 0.92s ease-out infinite 0.15s; }
    .purchase-burst-21 { left: 14%; animation: purchase-burst-e 1.08s ease-out infinite 0.86s; }
    .purchase-burst-22 { left: 22%; animation: purchase-burst-a 0.88s ease-out infinite 0.44s; }
    .purchase-burst-23 { left: 30%; animation: purchase-burst-d 1.02s ease-out infinite 0.71s; }
    .purchase-burst-24 { left: 38%; animation: purchase-burst-f 0.93s ease-out infinite 0.03s; }
    .purchase-burst-25 { left: 46%; animation: purchase-burst-c 1.07s ease-out infinite 0.59s; }
    .purchase-burst-26 { left: 54%; animation: purchase-burst-b 0.87s ease-out infinite 0.92s; }
    .purchase-burst-27 { left: 62%; animation: purchase-burst-e 0.98s ease-out infinite 0.26s; }
    .purchase-burst-28 { left: 70%; animation: purchase-burst-a 1.12s ease-out infinite 0.64s; }
    .purchase-burst-29 { left: 78%; animation: purchase-burst-d 0.91s ease-out infinite 0.38s; }
    .purchase-burst-30 { left: 84%; animation: purchase-burst-c 1.03s ease-out infinite 0.77s; }
    .purchase-burst-31 { left: 88%; animation: purchase-burst-f 0.86s ease-out infinite 0.09s; }
    .purchase-burst-32 { left: 92%; animation: purchase-burst-b 1.06s ease-out infinite 0.52s; }
    .purchase-burst-33 { left: 96%; animation: purchase-burst-e 0.94s ease-out infinite 0.81s; }
    .purchase-burst-34 { left: 10%; animation: purchase-burst-d 0.89s ease-out infinite 0.34s; }
    .purchase-burst-35 { left: 26%; animation: purchase-burst-a 1.04s ease-out infinite 0.96s; }
    .purchase-burst-36 { left: 42%; animation: purchase-burst-f 0.91s ease-out infinite 0.19s; }
    .purchase-burst-37 { left: 58%; animation: purchase-burst-c 1.09s ease-out infinite 0.69s; }
    .purchase-burst-38 { left: 74%; animation: purchase-burst-b 0.87s ease-out infinite 0.46s; }
    .purchase-burst-39 { left: 90%; animation: purchase-burst-e 1.01s ease-out infinite 0.13s; }
    .purchase-btn-wrap:hover .purchase-burst {
      display: block;
    }
  `;
  document.head.appendChild(style);
}

@customElement("purchase-button")
export class PurchaseButton extends LitElement {
  @property({ type: Object })
  product: Product | null = null;

  @property({ type: Number })
  priceHard: number | null = null;

  @property({ type: Number })
  priceSoft: number | null = null;

  @property({ type: String })
  rarity: string = "common";

  @property({ type: Function })
  onPurchaseDollar?: () => void;

  @property({ type: Function })
  onPurchaseHard?: () => void;

  @property({ type: Function })
  onPurchaseSoft?: () => void;

  createRenderRoot() {
    return this;
  }

  private handleClick(e: Event, handler?: () => void) {
    e.stopPropagation();
    if (!handler) return;
    const container = this.closest("cosmetic-container") as HTMLElement | null;
    if (container && !container.querySelector(".cosmetic-loading-overlay")) {
      const overlay = document.createElement("div");
      overlay.className = "cosmetic-loading-overlay";
      overlay.innerHTML = `<div class="cosmetic-loading-spinner"></div>`;
      container.appendChild(overlay);
    }
    Promise.resolve(handler()).finally(() => {
      container?.querySelector(".cosmetic-loading-overlay")?.remove();
    });
  }

  private renderDollarButton() {
    return html`
      <button
        class="purchase-sparkle-btn relative overflow-hidden w-full px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-all duration-200
         hover:bg-green-500 hover:border-green-400 hover:text-white hover:shadow-[0_0_20px_rgba(74,222,128,0.6)]"
        @click=${(e: Event) => this.handleClick(e, this.onPurchaseDollar)}
      >
        <span class="purchase-sparkle-streak"></span>
        ${translateText("territory_patterns.purchase")}
        <span class="ml-1 text-white/50">(${this.product!.price})</span>
      </button>
    `;
  }

  private renderHardButton() {
    return html`
      <button
        class="purchase-sparkle-btn-hard relative overflow-hidden w-full px-2 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 flex items-center justify-center gap-2
         hover:bg-green-500 hover:border-green-400 hover:text-white hover:shadow-[0_0_20px_rgba(74,222,128,0.6)]"
        @click=${(e: Event) => this.handleClick(e, this.onPurchaseHard)}
      >
        <plutonium-icon .size=${20} style="margin-top:3px"></plutonium-icon>
        ${this.priceHard!.toLocaleString()}
      </button>
    `;
  }

  private renderSoftButton() {
    return html`
      <button
        class="purchase-sparkle-btn-soft relative overflow-hidden w-full px-2 py-1.5 bg-amber-700/20 text-amber-600 border border-amber-700/30 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 flex items-center justify-center gap-2
         hover:bg-amber-700 hover:border-amber-600 hover:text-white hover:shadow-[0_0_20px_rgba(217,119,6,0.6)]"
        @click=${(e: Event) => this.handleClick(e, this.onPurchaseSoft)}
      >
        <cap-icon .size=${22} style="margin-top:3px"></cap-icon>
        ${this.priceSoft!.toLocaleString()}
      </button>
    `;
  }

  render() {
    const hasDollar = this.product && this.onPurchaseDollar;
    const hasHard = this.priceHard !== null && this.onPurchaseHard;
    const hasSoft = this.priceSoft !== null && this.onPurchaseSoft;

    if (!hasDollar && !hasHard && !hasSoft) return nothing;

    return html`
      <div class="no-crazygames w-full mt-2 relative purchase-btn-wrap">
        ${this.rarity !== "common"
          ? html`<span class="purchase-ember purchase-ember-0"></span>
              <span class="purchase-ember purchase-ember-1"></span>
              <span class="purchase-ember purchase-ember-2"></span>
              <span class="purchase-ember purchase-ember-3"></span>
              ${Array.from(
                { length: 40 },
                (_, i) =>
                  html`<span
                    class="purchase-burst purchase-burst-${i}"
                  ></span>`,
              )}`
          : null}
        <div class="flex flex-col gap-1 w-full">
          ${hasDollar ? this.renderDollarButton() : null}
          ${hasHard ? this.renderHardButton() : null}
          ${hasSoft ? this.renderSoftButton() : null}
        </div>
      </div>
    `;
  }
}
