import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import "./PurchaseButton";

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | string;

interface RarityConfig {
  gradient: string;
  border: string;
  glow: string;
  hoverGlowSize: string;
  nameColor: string;
  legendary?: boolean;
  shimmer?: boolean;
  shimmerColor?: string; // rgb triplet e.g. "255,200,80"
  borderSweep?: boolean;
  borderSweepColor?: string; // rgb triplet e.g. "192,132,252"
}

const rarityConfig: Record<string, RarityConfig> = {
  common: {
    gradient: "rgba(80,80,80,0.55)",
    border: "rgba(255,255,255,0.15)",
    glow: "rgba(255,255,255,0.5)",
    hoverGlowSize: "10px",
    nameColor: "rgba(255,255,255,0.7)",
  },
  uncommon: {
    gradient: "rgba(30,100,30,0.65)",
    border: "rgba(74,222,128,0.45)",
    glow: "rgba(74,222,128,0.6)",
    hoverGlowSize: "12px",
    nameColor: "rgba(255,255,255,1)",
  },
  rare: {
    gradient: "rgba(20,60,160,0.70)",
    border: "rgba(96,165,250,0.50)",
    glow: "rgba(96,165,250,0.7)",
    hoverGlowSize: "14px",
    nameColor: "rgba(255,255,255,1)",
  },
  epic: {
    gradient: "rgba(90,20,160,0.75)",
    border: "rgba(192,132,252,0.60)",
    glow: "rgba(192,132,252,0.85)",
    hoverGlowSize: "14px",
    nameColor: "rgba(255,255,255,1)",
    shimmer: true,
    shimmerColor: "192,132,252",
  },
  legendary: {
    gradient: "rgba(180,80,0,0.75)",
    border: "rgba(251,146,60,0.65)",
    glow: "rgba(251,146,60,0.95)",
    hoverGlowSize: "25px",
    nameColor: "rgba(255,255,255,1)",
    legendary: true,
    shimmer: true,
    shimmerColor: "255,200,80",
    borderSweep: true,
    borderSweepColor: "255,200,80",
  },
};

const fallback = rarityConfig["common"];

const STYLE_ID = "cosmetic-container-styles";
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes legendary-pulse {
      0%   { box-shadow: 0 0 15px rgba(251,146,60,0.8), 0 0 30px rgba(251,146,60,0.4); }
      50%  { box-shadow: 0 0 25px rgba(251,146,60,0.9), 0 0 45px rgba(251,146,60,0.5); }
      100% { box-shadow: 0 0 15px rgba(251,146,60,0.8), 0 0 30px rgba(251,146,60,0.4); }
    }
    @keyframes legendary-shimmer {
      0%   { left: -60%; }
      100% { left: 160%; }
    }
    @keyframes legendary-border-sweep {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes sparkle-twinkle-0 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      40%, 60% { opacity: 1; transform: scale(1.2) rotate(20deg); }
    }
    @keyframes sparkle-twinkle-1 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      30%, 55% { opacity: 1; transform: scale(1.1) rotate(-15deg); }
    }
    @keyframes sparkle-twinkle-2 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      45%, 65% { opacity: 1; transform: scale(1.3) rotate(10deg); }
    }
    @keyframes sparkle-twinkle-3 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      35%, 58% { opacity: 1; transform: scale(1.0) rotate(-20deg); }
    }
    .legendary-hovered {
      animation: legendary-pulse 1.4s ease-in-out infinite;
    }
    .legendary-shimmer.active {
      animation: legendary-shimmer 0.8s ease-in-out;
    }
    .legendary-border-sweep {
      animation: legendary-border-sweep 8s linear infinite;
    }
    .legendary-sparkle-0 { animation: sparkle-twinkle-0 1.6s ease-in-out infinite; }
    .legendary-sparkle-1 { animation: sparkle-twinkle-1 1.9s ease-in-out infinite 0.3s; }
    .legendary-sparkle-2 { animation: sparkle-twinkle-2 1.7s ease-in-out infinite 0.7s; }
    .legendary-sparkle-3 { animation: sparkle-twinkle-3 2.0s ease-in-out infinite 0.1s; }
    @keyframes cosmetic-spin {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .cosmetic-loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.6);
      border-radius: 0.75rem;
      z-index: 20;
    }
    .cosmetic-loading-spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255,255,255,0.2);
      border-top-color: rgb(74,222,128);
      border-radius: 50%;
      animation: cosmetic-spin 0.8s linear infinite;
    }
  `;
  document.head.appendChild(style);
}

@customElement("cosmetic-container")
export class CosmeticContainer extends LitElement {
  @property({ type: String })
  rarity: Rarity = "common";

  @property({ type: Boolean })
  selected: boolean = false;

  @property({ type: String })
  name: string = "";

  @property({ type: Object })
  product: Product | null = null;

  @property({ type: Number })
  priceHard: number | null = null;

  @property({ type: Number })
  priceSoft: number | null = null;

  @property({ type: Function })
  onPurchaseDollar?: () => void;

  @property({ type: Function })
  onPurchaseHard?: () => void;

  @property({ type: Function })
  onPurchaseSoft?: () => void;

  private static _backdrop: HTMLDivElement | null = null;
  private static _ensureBackdrop(): HTMLDivElement {
    if (!CosmeticContainer._backdrop) {
      const el = document.createElement("div");
      el.style.cssText = `
        pointer-events: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0);
        z-index: 9;
        transition: background 0.3s ease;
      `;
      document.body.appendChild(el);
      CosmeticContainer._backdrop = el;
    }
    return CosmeticContainer._backdrop;
  }

  private _shimmer: HTMLDivElement | null = null;
  private _borderSweep: HTMLDivElement | null = null;
  private _sparkles: HTMLDivElement[] = [];
  private _glowColor = fallback.glow;
  private _glowSize = fallback.hoverGlowSize;
  private _isLegendary = false;
  private _hasGlint = false;
  private _hasBorderSweep = false;
  private _loading = false;
  private _loadingOverlay: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  private applyHostStyles() {
    const cfg = rarityConfig[this.rarity] ?? fallback;
    this._glowColor = cfg.glow;
    this._glowSize = cfg.hoverGlowSize;
    this._isLegendary = !!cfg.legendary;
    this._hasGlint = !!cfg.shimmer;
    this._hasBorderSweep = !!cfg.borderSweep;

    this.style.position = "relative";
    this.style.overflow = "hidden";
    this.style.background = `linear-gradient(to top, ${cfg.gradient} 0%, rgba(15,15,20,0.85) 100%)`;
    this.style.border = `1px solid ${this.selected ? cfg.glow : cfg.border}`;
    this.style.backdropFilter = "blur(8px)";
    this.style.borderRadius = "0.75rem";
    this.style.transition =
      "border-color 0.2s, background 0.2s, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s";
    this.style.zIndex = "0";
    const hasPurchase =
      this.product !== null ||
      this.priceHard !== null ||
      this.priceSoft !== null;
    this.style.cursor = hasPurchase ? "pointer" : "";

    if (this.selected) {
      this.style.boxShadow = `0 0 18px ${cfg.glow}`;
    } else if (!this.classList.contains("legendary-hovered")) {
      this.style.boxShadow = "";
    }
  }

  private _ensureLegendaryElements() {
    if (this._shimmer || this._borderSweep) return;

    // Shimmer sweep — epic and legendary
    if (this._hasGlint) {
      const shimmer = document.createElement("div");
      shimmer.className = "legendary-shimmer";
      shimmer.style.cssText = `
        pointer-events: none;
        position: absolute;
        top: 0;
        left: -60%;
        width: 40%;
        height: 100%;
        background: linear-gradient(90deg, transparent 0%, rgba(${(rarityConfig[this.rarity] ?? fallback).shimmerColor ?? "255,200,80"},0.45) 50%, transparent 100%);
        transform: skewX(-15deg);
        z-index: 10;
        display: none;
      `;
      this.appendChild(shimmer);
      this._shimmer = shimmer;
    }

    if (!this._hasBorderSweep) return;
    const sweepWrap = document.createElement("div");
    sweepWrap.style.cssText = `
      pointer-events: none;
      position: absolute;
      inset: -2px;
      border-radius: 0.85rem;
      z-index: -1;
      overflow: hidden;
      display: none;
    `;
    const sweepInner = document.createElement("div");
    sweepInner.className = "legendary-border-sweep";
    const sc =
      (rarityConfig[this.rarity] ?? fallback).borderSweepColor ?? "255,200,80";
    sweepInner.style.cssText = `
      position: absolute;
      inset: -100%;
      background: conic-gradient(
        from 0deg,
        transparent 0deg,
        rgba(${sc},0.0) 60deg,
        rgba(${sc},0.9) 120deg,
        rgba(${sc},1) 180deg,
        rgba(${sc},0.9) 240deg,
        rgba(${sc},0.0) 300deg,
        transparent 360deg
      );
    `;
    // Inner mask to hide center, show only border ring
    const sweepMask = document.createElement("div");
    sweepMask.style.cssText = `
      position: absolute;
      inset: 2px;
      border-radius: 0.75rem;
      background: transparent;
    `;
    sweepWrap.appendChild(sweepInner);
    sweepWrap.appendChild(sweepMask);
    this.appendChild(sweepWrap);
    this._borderSweep = sweepWrap;

    // Corner sparkles ✦
    const corners = [
      { top: "4px", left: "4px" },
      { top: "4px", right: "4px" },
      { bottom: "4px", left: "4px" },
      { bottom: "4px", right: "4px" },
    ];
    this._sparkles = corners.map((pos, i) => {
      const el = document.createElement("div");
      el.className = `legendary-sparkle-${i}`;
      el.textContent = "✦";
      el.style.cssText = `
        pointer-events: none;
        position: absolute;
        font-size: 10px;
        color: rgba(255,220,100,0.9);
        text-shadow: 0 0 6px rgba(255,200,60,1);
        z-index: 11;
        opacity: 0;
        display: none;
        line-height: 1;
      `;
      Object.assign(el.style, pos);
      this.appendChild(el);
      return el;
    });
  }

  private _onClick = () => {
    if (CosmeticContainer._backdrop) {
      CosmeticContainer._backdrop.style.background = "rgba(0,0,0,0)";
    }
    // Only auto-fire container click when there's exactly one purchase path
    const handlers = [
      this.onPurchaseDollar,
      this.onPurchaseHard,
      this.onPurchaseSoft,
    ].filter(Boolean);
    if (handlers.length === 1 && !this._loading) {
      this._loading = true;
      this._showLoadingOverlay();
      Promise.resolve(handlers[0]!()).finally(() => {
        this._hideLoadingOverlay();
      });
    }
  };

  private _showLoadingOverlay() {
    if (this._loadingOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "cosmetic-loading-overlay";
    overlay.innerHTML = `<div class="cosmetic-loading-spinner"></div>`;
    this.appendChild(overlay);
    this._loadingOverlay = overlay;
  }

  private _hideLoadingOverlay() {
    this._loadingOverlay?.remove();
    this._loadingOverlay = null;
    this._loading = false;
  }

  private _onMouseEnter = () => {
    if (this._hasGlint || this._hasBorderSweep) {
      this._ensureLegendaryElements();
    }
    if (this._isLegendary) {
      this.style.transform = "scale(1.12)";
      this.style.zIndex = "10";
      this.classList.add("legendary-hovered");
      this._sparkles.forEach((s) => (s.style.display = "block"));
      CosmeticContainer._ensureBackdrop().style.background = "rgba(0,0,0,0.6)";
    }
    if (this._hasBorderSweep && this._borderSweep) {
      this._borderSweep.style.display = "block";
    }
    if (this._hasGlint && this._shimmer) {
      this._shimmer.style.display = "block";
      this._shimmer.classList.remove("active");
      void this._shimmer.offsetWidth;
      this._shimmer.classList.add("active");
    }
    if (!this._isLegendary && !this.selected) {
      this.style.boxShadow = `0 0 ${this._glowSize} ${this._glowColor}`;
    }
  };

  private _onMouseLeave = () => {
    if (this._isLegendary) {
      this.style.transform = "";
      this.style.zIndex = "0";
      this.classList.remove("legendary-hovered");
      this._sparkles.forEach((s) => (s.style.display = "none"));
      if (CosmeticContainer._backdrop) {
        CosmeticContainer._backdrop.style.background = "rgba(0,0,0,0)";
      }
    }
    if (this._hasGlint && this._shimmer) this._shimmer.style.display = "none";
    if (this._hasBorderSweep && this._borderSweep)
      this._borderSweep.style.display = "none";
    if (!this.selected) this.style.boxShadow = "";
  };

  private _nameEl: HTMLDivElement | null = null;

  private _updateNameEl() {
    if (this.name) {
      this._nameEl ??= document.createElement("div");
      const cfg = rarityConfig[this.rarity] ?? fallback;
      this._nameEl.className = `text-xs font-bold uppercase tracking-wider text-center truncate w-full`;
      this._nameEl.style.color = cfg.nameColor;
      this._nameEl.title = this.name;
      this._nameEl.textContent = this.name;
      // Always ensure it's the first child
      if (this.firstChild !== this._nameEl) {
        this.prepend(this._nameEl);
      }
    } else if (this._nameEl) {
      this._nameEl.remove();
      this._nameEl = null;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.applyHostStyles();
    this._updateNameEl();
    this.addEventListener("mouseenter", this._onMouseEnter);
    this.addEventListener("mouseleave", this._onMouseLeave);
    this.addEventListener("click", this._onClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("mouseenter", this._onMouseEnter);
    this.removeEventListener("mouseleave", this._onMouseLeave);
    this.removeEventListener("click", this._onClick);
  }

  updated() {
    this.applyHostStyles();
    this._updateNameEl();
  }

  render() {
    return html`
      <slot></slot>
      ${this.product || this.priceHard !== null || this.priceSoft !== null
        ? html`<purchase-button
            .product=${this.product}
            .priceHard=${this.priceHard}
            .priceSoft=${this.priceSoft}
            .rarity=${this.rarity}
            .onPurchaseDollar=${this.onPurchaseDollar}
            .onPurchaseHard=${this.onPurchaseHard}
            .onPurchaseSoft=${this.onPurchaseSoft}
          ></purchase-button>`
        : null}
    `;
  }
}
