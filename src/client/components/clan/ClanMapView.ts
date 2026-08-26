import { html, LitElement } from "lit";
import { customElement, query } from "lit/decorators.js";
import { getAudience } from "../../Api";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";

// The clan territory map is a page served by infra (`clanmap.<audience>`),
// framed here. Contract (infra docs/clanmap-client-handoff.md): the page posts
// `clanmap:ready` on load, ~1 min before its JWT expires and after any API
// 401; the parent answers with `clanmap:auth` carrying the current JWT. A
// viewer without an account gets no reply and the map stays read-only.
export function clanMapOrigin(): string {
  const aud = getAudience();
  return aud === "localhost"
    ? "http://clanmap.localhost:8787"
    : `https://clanmap.${aud}`;
}

@customElement("clan-map-view")
export class ClanMapView extends LitElement {
  @query("iframe") private frame?: HTMLIFrameElement;

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
    // The page sizes its canvas to the frame and re-fits on resize, so the
    // frame just needs a real height: the modal is content-sized on desktop.
    // `allow="fullscreen"` is what makes the page's Fullscreen button appear.
    return html`<iframe
      src=${clanMapOrigin() + "/"}
      title=${translateText("clan_modal.map_frame_title")}
      allow="fullscreen"
      allowfullscreen
      class="block w-full h-[calc(100vh-16rem)] min-h-[320px] border-0 bg-[#0e1116]"
    ></iframe>`;
  }
}
