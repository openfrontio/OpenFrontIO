import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

export type WebGLGateStatus = "software" | "unsupported" | "limited";

// Hard-block troubleshooting screen seen by a tiny fraction of sessions (no
// GPU-accelerated WebGL2). The content is intentionally NOT translated — it's
// rarely shown and is full of browser-specific UI strings — so it's inlined
// here rather than routed through translateText/en.json.
const STEP_SECTIONS: ReadonlyArray<{ title: string; steps: string[] }> = [
  {
    title: "Google Chrome",
    steps: [
      "Click the three dots in the top-right corner and select Settings.",
      "Click System on the left menu.",
      'Toggle on "Use graphics/hardware acceleration when available".',
      "Relaunch your browser.",
      "Type chrome://flags into your address bar and press Enter.",
      "Search for WebGL in the flags search bar.",
      'Set "WebGL Draft Extensions" (and "WebGL Developer Extensions", if shown) to Enabled.',
      "Click Relaunch to apply the changes.",
    ],
  },
  {
    title: "Microsoft Edge",
    steps: [
      "Click the three dots in the top-right corner and choose Settings.",
      'Select "System and performance" on the left menu.',
      'Ensure "Use hardware acceleration when available" is toggled on.',
      "Go to edge://flags in your address bar and press Enter.",
      'Search for WebGL and set "WebGL Draft Extensions" to Enabled.',
      "Click Restart to apply.",
    ],
  },
  {
    title: "Mozilla Firefox",
    steps: [
      "Type about:config in the address bar and press Enter (accept any warning prompts).",
      "Search for webgl.disabled and ensure the value is set to false.",
      "Search for webgl.force-enabled and toggle the value to true.",
      "Restart your browser.",
    ],
  },
];

// Shown for the "limited" status: WebGL works but texture sizes are capped
// below what the game needs, so the map may render with black areas (#4357).
// The only known cause is fingerprinting protection
// (privacy.resistFingerprinting — on by default in LibreWolf and Mullvad
// Browser, opt-in in Firefox). Unlike the other statuses this is a warning:
// the player may dismiss it and play anyway.
const LIMITED_SECTIONS: ReadonlyArray<{ title: string; steps: string[] }> = [
  {
    title: "Firefox / LibreWolf / Mullvad Browser",
    steps: [
      "Type about:config in the address bar and press Enter (accept any warning prompts).",
      "Search for privacy.resistFingerprinting.exemptedDomains.",
      `Add ${window.location.hostname} to the value (comma-separated if other domains are already listed).`,
      "Restart your browser.",
    ],
  },
];

const LIMITED_NOTES: string[] = [
  "This keeps fingerprinting protection active everywhere else — only this site is exempted.",
  "Alternatively, set privacy.resistFingerprinting to false to turn the protection off entirely.",
];

const SAFARI_NOTES: string[] = [
  "Mac: WebGL is on by default. If it has been restricted, open Safari > Settings (or Preferences) > Websites > WebGL and set WebGL to Allow or On for this site or globally.",
  "iPhone/iPad: WebGL is natively supported and always on for iOS 8 and later.",
];

/**
 * Full-screen gate shown when the WebGL2 context is unusable ("software",
 * "unsupported" — hard block) or degraded ("limited" — texture sizes capped
 * by fingerprinting protection; dismissible via "Continue anyway"). Shows how
 * to turn hardware acceleration / WebGL back on, or exempt the site from
 * fingerprinting protection, across the most popular browsers. Shown
 * imperatively from the game-start path.
 */
@customElement("webgl-gate")
export class WebGLGate extends LitElement {
  @property() status: WebGLGateStatus = "software";

  // Render into light DOM so global styles (Tailwind utilities, bg-surface) apply.
  createRenderRoot() {
    return this;
  }

  render() {
    const limited = this.status === "limited";
    const software = this.status === "software";
    const title = limited
      ? "Your browser is limiting WebGL"
      : software
        ? "Hardware acceleration is off"
        : "WebGL2 not supported";
    const intro = limited
      ? 'A privacy setting is capping WebGL texture sizes below what the game needs, so the map may render with black areas. This is usually "resist fingerprinting" protection, which is on by default in some Firefox-based browsers. Here is how to exempt this site:'
      : software
        ? "Your browser is rendering without GPU acceleration, so the game can't run smoothly. Here is how to activate it across the most popular web browsers:"
        : "Your browser doesn't support WebGL2, which this game requires. Here is how to enable it across the most popular web browsers:";
    const sections = limited ? LIMITED_SECTIONS : STEP_SECTIONS;
    const notesTitle = limited ? "Notes" : "Safari";
    const notes = limited ? LIMITED_NOTES : SAFARI_NOTES;

    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-5"
      >
        <div
          class="w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 sm:p-8 rounded-xl bg-surface text-white shadow-2xl"
        >
          <h2 class="text-xl font-bold mb-3">${title}</h2>
          <p class="text-sm leading-relaxed text-white/85 mb-5">${intro}</p>
          ${sections.map(
            (section) => html`
              <section class="mb-5">
                <h3 class="text-sm font-bold text-white mb-1.5">
                  ${section.title}
                </h3>
                <ol
                  class="pl-5 list-decimal text-sm leading-relaxed text-white/85 space-y-1.5"
                >
                  ${section.steps.map((step) => html`<li>${step}</li>`)}
                </ol>
              </section>
            `,
          )}
          <section class="mb-0">
            <h3 class="text-sm font-bold text-white mb-1.5">${notesTitle}</h3>
            <ul
              class="pl-5 list-disc text-sm leading-relaxed text-white/85 space-y-1.5"
            >
              ${notes.map((note) => html`<li>${note}</li>`)}
            </ul>
          </section>
          ${limited
            ? html`
                <button
                  class="mt-5 w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold text-white transition-colors"
                  @click=${() => this.remove()}
                >
                  Continue anyway
                </button>
              `
            : null}
        </div>
      </div>
    `;
  }
}
