import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { adGatekeeper } from "./AdGatekeeper";

// ─── Gutter Ads ──────────────────────────────────────────────────────────────

@customElement("homepage-promos")
export class HomepagePromos extends LitElement {
  private adLoaded: boolean = false;
  private cornerAdLoaded: boolean = false;
  private cornerAdDestroyed: boolean = false;

  private onUserMeResponse = () => {
    if (window.adsEnabled) {
      console.log("showing homepage ads");
      this.show();
      this.loadCornerAdVideo();
    } else {
      console.log("not showing homepage ads");
    }
  };

  private onJoinLobby = () => {
    this.loadBottomRail();
  };

  private onLeaveLobby = () => {
    this.destroyBottomRail();
  };

  private bottomRailActive: boolean = false;

  // The header ad ("flex" leaderboard, GumGum via Playwire) renders in a
  // #pw-oop-flex element that ramp.js nests inside a #pw-oop-flex_container
  // <body> child and docks fixed at the viewport top (#adBanner is an older
  // Playwire container that idles parked offscreen at 10x10/bottom:-100px —
  // watched as a fallback). Measure the docked banner and expose
  // --top-ad-height on <html> so the fixed/sticky bars shift below it, and
  // --top-ad-pad so page content shifts below it when no inline slot reserves
  // the space (consumed in index.html / PlayPage).
  private topAdEl: HTMLElement | null = null;
  private topAdResize: ResizeObserver | null = null;
  private topAdStyle: MutationObserver | null = null;
  private topAdMutation: MutationObserver | null = null;
  private reservedFlexHeight: number = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMeResponse);
    document.addEventListener("join-lobby", this.onJoinLobby);
    document.addEventListener("leave-lobby", this.onLeaveLobby);
    this.topAdMutation = new MutationObserver(() => this.syncTopAd());
    // subtree: the banner is nested inside a wrapper (#pw-oop-flex_container),
    // so watching body's direct children alone misses it.
    this.topAdMutation.observe(document.body, {
      childList: true,
      subtree: true,
    });
    this.syncTopAd();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this.onUserMeResponse);
    document.removeEventListener("join-lobby", this.onJoinLobby);
    document.removeEventListener("leave-lobby", this.onLeaveLobby);
    this.topAdMutation?.disconnect();
    this.topAdStyle?.disconnect();
    this.topAdResize?.disconnect();
    document.documentElement.style.removeProperty("--top-ad-height");
    document.documentElement.style.removeProperty("--top-ad-pad");
    document
      .getElementById("pw-oop-flex_container")
      ?.style.removeProperty("min-height");
  }

  private syncTopAd(): void {
    const el =
      document.getElementById("pw-oop-flex") ??
      document.getElementById("adBanner");
    if (el !== this.topAdEl) {
      this.topAdResize?.disconnect();
      this.topAdResize = null;
      this.topAdStyle?.disconnect();
      this.topAdStyle = null;
      this.topAdEl = el;
      if (el) {
        this.topAdResize = new ResizeObserver(() => this.updateTopAdHeight());
        this.topAdResize.observe(el);
        // Playwire repositions the container via inline styles (parked
        // offscreen <-> docked at top), which a ResizeObserver alone misses.
        this.topAdStyle = new MutationObserver(() => this.updateTopAdHeight());
        this.topAdStyle.observe(el, {
          attributes: true,
          attributeFilter: ["style", "class"],
        });
      }
    }
    this.updateTopAdHeight();
  }

  private updateTopAdHeight(): void {
    let dockedHeight = 0;
    let inlineHeight = 0;
    let unitVisible = false;
    if (this.topAdEl) {
      const rect = this.topAdEl.getBoundingClientRect();
      const style = getComputedStyle(this.topAdEl);
      unitVisible = style.display !== "none" && rect.height >= 30;
      if (unitVisible && style.position === "fixed") {
        // Only make room while the banner is actually docked at the viewport
        // top — not while parked offscreen.
        if (rect.top < window.innerHeight / 4) {
          dockedHeight = Math.ceil(Math.max(0, rect.bottom));
        }
      } else if (unitVisible) {
        inlineHeight = Math.ceil(rect.height);
      }
    }

    // The flex unit swaps between an inline expanded state (in the document
    // flow inside #pw-oop-flex_container) and a smaller fixed leaderboard once
    // scrolled past. Docking empties the container, which would yank the whole
    // page up by the expanded height mid-scroll — so once the unit has shown
    // inline, lock the container to that height for as long as the unit lives.
    // Dock/undock then never changes the document height, and the reserved
    // slot is refilled whenever Playwire re-expands the unit at the top.
    const container = document.getElementById("pw-oop-flex_container");
    if (container && this.topAdEl?.id === "pw-oop-flex") {
      if (!unitVisible) {
        this.reservedFlexHeight = 0;
      } else if (inlineHeight > this.reservedFlexHeight) {
        this.reservedFlexHeight = inlineHeight;
      }
      if (this.reservedFlexHeight > 0) {
        container.style.minHeight = `${this.reservedFlexHeight}px`;
      } else {
        container.style.removeProperty("min-height");
      }
    } else {
      this.reservedFlexHeight = 0;
      container?.style.removeProperty("min-height");
    }

    // --top-ad-height offsets the fixed/sticky bars (viewport-level, never
    // shifts the document). --top-ad-pad pushes the page content down and is
    // only needed when the docked banner has no reserved inline slot backing
    // it (e.g. the legacy #adBanner container, which is fixed from the start).
    const pad = this.reservedFlexHeight > 0 ? 0 : dockedHeight;
    this.setHtmlVar("--top-ad-height", dockedHeight);
    this.setHtmlVar("--top-ad-pad", pad);
  }

  private setHtmlVar(name: string, px: number): void {
    if (px > 0) {
      document.documentElement.style.setProperty(name, `${px}px`);
    } else {
      document.documentElement.style.removeProperty(name);
    }
  }

  public show(): void {
    this.loadGutterAds();
  }

  public close(): void {
    this.adLoaded = false;
    try {
      // Destroy gutter rails and the header ad; bottom_rail persists into
      // spawn phase. These are no-selector units, registered under pw-oop-
      // ids (see destroyBottomRail). The header ad must go too: nothing hides
      // #pw-oop-flex_container in-game and its docked state is fixed at the
      // viewport top, so it would sit over the map.
      window.ramp.destroyUnits("pw-oop-left_rail");
      window.ramp.destroyUnits("pw-oop-right_rail");
      window.ramp.destroyUnits("pw-oop-flex");
      console.log("successfully destroyed gutter rails and header ad");
    } catch (e) {
      console.error("error destroying gutter rails and header ad", e);
    }
    // Adblock-detected users get NO in-game ads (the AdGatekeeper latch is
    // permanent, surviving the blocker being disabled), so the corner video
    // must not keep playing into the game for them. Blocker-free users keep
    // it — same policy as InGamePromo's bottom-left ad.
    if (!adGatekeeper.canShowAds) {
      this.destroyCornerAdVideo();
    }
  }

  public loadBottomRail(): void {
    if (!window.adsEnabled) return;
    if (this.bottomRailActive) return;
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for bottom_rail ad");
      return;
    }

    this.bottomRailActive = true;
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([{ type: "bottom_rail" }]);
          console.log("Bottom rail ad loaded");
        } catch (e) {
          console.error("Failed to add bottom_rail ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load bottom_rail ad:", error);
    }
  }

  public destroyBottomRail(): void {
    if (!this.bottomRailActive) return;
    this.bottomRailActive = false;

    if (!window.ramp) return;

    try {
      window.ramp.destroyUnits("pw-oop-bottom_rail");
      console.log("Bottom rail ad destroyed");
    } catch (e) {
      console.error("Error destroying bottom_rail ad:", e);
    }
  }

  private loadGutterAds(): void {
    console.log("loading ramp gutter rails and header ad");
    if (!window.ramp) {
      console.warn("Playwire RAMP not available");
      return;
    }

    if (this.adLoaded) {
      console.log("Ads already loaded, skipping");
      return;
    }

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            { type: "left_rail" },
            { type: "right_rail" },
            // Header ad (GumGum flex leaderboard); the page shifts below it
            // via --top-ad-height / --top-ad-pad (see syncTopAd).
            { type: "flex" },
          ]);
          this.adLoaded = true;
          console.log("Gutter rails and header ad loaded");
        } catch (e) {
          console.log(e);
        }
      });
    } catch (error) {
      console.error("Failed to load gutter rails and header ad:", error);
    }
  }

  private loadCornerAdVideo(): void {
    if (this.cornerAdLoaded || this.cornerAdDestroyed) return;
    if (window.innerWidth < 1280) return;
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for corner_ad_video");
      return;
    }
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp
            .addUnits([{ type: "corner_ad_video" }])
            .then(() => {
              // Game started while the unit was still loading — never show it.
              if (this.cornerAdDestroyed) return;
              this.cornerAdLoaded = true;
              window.ramp.displayUnits();
              console.log("corner_ad_video loaded");
            })
            .catch((e: unknown) => {
              console.error("Failed to display corner_ad_video:", e);
            });
        } catch (e) {
          console.error("Failed to add corner_ad_video:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load corner_ad_video:", error);
    }
  }

  private destroyCornerAdVideo(): void {
    // Latch first so an addUnits call still in flight skips displayUnits.
    this.cornerAdDestroyed = true;
    if (!this.cornerAdLoaded) return;
    this.cornerAdLoaded = false;
    try {
      window.ramp
        .destroyUnits("corner_ad_video")
        // No-selector units can be registered under a pw-oop- id (see
        // destroyBottomRail); retry with the prefixed name if the plain
        // type isn't recognized.
        .catch(() => window.ramp.destroyUnits("pw-oop-corner_ad_video"))
        .then(() => console.log("corner_ad_video destroyed"))
        .catch((e: unknown) => {
          console.error("Error destroying corner_ad_video:", e);
        });
    } catch (e) {
      console.error("Error destroying corner_ad_video:", e);
    }
  }
}
