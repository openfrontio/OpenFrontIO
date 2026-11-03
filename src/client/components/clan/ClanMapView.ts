import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getAudience } from "../../Api";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";

// The clan territory map is a page served by infra (`clanmap.<audience>`),
// framed here. Contract (infra docs/clanmap-client-handoff.md): the page posts
// `clanmap:ready` on load, ~1 min before its JWT expires and after any API
// 401; the parent answers with `clanmap:auth` carrying the current JWT. A
// viewer without an account gets no reply and the map stays read-only. It
// posts `clanmap:loaded` once its first terrain + ownership load settles; a
// spinner covers the frame until then.
export function clanMapOrigin(): string {
  const aud = getAudience();
  return aud === "localhost"
    ? "http://clanmap.localhost:8787"
    : `https://clanmap.${aud}`;
}

@customElement("clan-map-view")
export class ClanMapView extends LitElement {
  @query("iframe") private frame?: HTMLIFrameElement;
  @state() private loading = true;

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
    const auth = await userAuth();
    if (!auth) return;
    // The frame may have been torn down while the token was refreshing.
    const target = this.frame?.contentWindow;
    if (!target) return;
    // Explicit target origin — never "*".
    target.postMessage({ type: "clanmap:auth", jwt: auth.jwt }, origin);
  };

  render() {
    // The page sizes its canvas to the frame and re-fits on resize; the host
    // gives the frame its height. `allow="fullscreen"` is what makes the
    // page's Fullscreen button appear.
    return html`<div class="relative w-full h-full">
      <iframe
        src=${clanMapOrigin() + "/"}
        title=${translateText("clan_modal.map_frame_title")}
        allow="fullscreen"
        allowfullscreen
        class="block w-full h-full border-0 bg-[#0e1116]"
      ></iframe>
      ${
        this.loading
          ? html`<div
              role="status"
              aria-label=${translateText("clan_modal.map_loading")}
              class="absolute inset-0 flex items-center justify-center bg-[#0e1116]"
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
