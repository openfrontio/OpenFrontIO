import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { getAudience } from "../../Api";
import { userAuth } from "../../Auth";
import {
  getCurrentLanguage,
  isRTL,
  translateText,
  translationTemplates,
} from "../../Utils";

// The clan territory map is a page served by infra (`clanmap.<audience>`),
// framed here. Contract (infra docs/clanmap-client-handoff.md): the page posts
// `clanmap:ready` on load, ~1 min before its JWT expires and after any API
// 401; the parent answers with `clanmap:auth` carrying the current JWT. A
// viewer without an account gets no reply and the map stays read-only. It
// posts `clanmap:loaded` once its first terrain + ownership load settles; a
// spinner covers the frame until then. The page's text comes from here too:
// every `clan_map.*` string in the player's language (English for missing
// ones), sent as `clanmap:lang` on each `clanmap:ready`, signed in or not.
export function clanMapOrigin(): string {
  const aud = getAudience();
  return aud === "localhost"
    ? "http://clanmap.localhost:8787"
    : `https://clanmap.${aud}`;
}

@customElement("clan-map-view")
export class ClanMapView extends LitElement {
  @query("iframe") private frame?: HTMLIFrameElement;
  // The full-screen clan map page: asks the page for its full layout
  // (`?full=1`, map edge to edge with the sidebar floating over it).
  @property({ type: Boolean }) full = false;
  // Open framed on this map pixel (the clan's Map activity "view on map")
  // instead of the player's own territory: `?at=x,y`.
  @property({ attribute: false }) at: { x: number; y: number } | null = null;
  @state() private loading = true;
  // The page has asked for its strings (clanmap:ready), so it's listening.
  private pageReady = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.onMessage);
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.onMessage);
    super.disconnectedCallback();
  }

  private onMessage = async (ev: MessageEvent) => {
    const origin = clanMapOrigin();
    if (ev.origin !== origin) return;
    if (!this.frame || ev.source !== this.frame.contentWindow) return;
    if (ev.data?.type === "clanmap:loaded") {
      this.loading = false;
      return;
    }
    if (ev.data?.type !== "clanmap:ready") return;
    this.pageReady = true;
    this.sendLanguage();
    const auth = await userAuth();
    if (!auth) return;
    // The frame may have been torn down while the token was refreshing.
    const target = this.frame?.contentWindow;
    if (!target) return;
    // Explicit target origin — never "*".
    target.postMessage({ type: "clanmap:auth", jwt: auth.jwt }, origin);
  };

  // The page's text in the player's language. Sent on every clanmap:ready,
  // and again when the language changes while the map is open: LangSelector
  // re-renders this component (it's in its list), and the page skips a
  // message it already has.
  private sendLanguage(): void {
    // Explicit target origin — never "*".
    this.frame?.contentWindow?.postMessage(
      {
        type: "clanmap:lang",
        lang: getCurrentLanguage(),
        rtl: isRTL(),
        strings: translationTemplates("clan_map."),
      },
      clanMapOrigin(),
    );
  }

  protected updated(): void {
    if (this.pageReady) this.sendLanguage();
  }

  private query(): string {
    const params = new URLSearchParams();
    if (this.full) params.set("full", "1");
    if (this.at) params.set("at", `${this.at.x},${this.at.y}`);
    const q = params.toString();
    // `,` reads better unescaped and is safe in a query value.
    return q ? `/?${q.replace(/%2C/g, ",")}` : "/";
  }

  render() {
    // The page sizes its canvas to the frame and re-fits on resize; the host
    // gives the frame its height. `allow="fullscreen"` is what makes the
    // page's Fullscreen button appear.
    return html`<div class="relative w-full h-full">
      <iframe
        src=${clanMapOrigin() + this.query()}
        title=${translateText("clan_modal.map_frame_title")}
        allow="fullscreen"
        allowfullscreen
        class="block w-full h-full border-0 bg-[#3c3c3c]"
      ></iframe>
      ${
        this.loading
          ? html`<div
              role="status"
              aria-label=${translateText("clan_modal.map_loading")}
              class="absolute inset-0 flex items-center justify-center bg-[#3c3c3c]"
            >
              <div
                class="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"
              ></div>
            </div>`
          : ""
      }
    </div>`;
  }
}
