import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

export type WebGLGateStatus = "software" | "unsupported";

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

const SAFARI_NOTES: string[] = [
  "Mac: WebGL is on by default. If it has been restricted, open Safari > Settings (or Preferences) > Websites > WebGL and set WebGL to Allow or On for this site or globally.",
  "iPhone/iPad: WebGL is natively supported and always on for iOS 8 and later.",
];

/**
 * Full-screen blocking gate shown when a GPU-accelerated WebGL2 context can't
 * be obtained — software rendering (~1fps) or no WebGL2 at all. Shows how to
 * turn hardware acceleration / WebGL back on across the most popular browsers.
 * Shown imperatively from the game-start path.
 */
@customElement("webgl-gate")
export class WebGLGate extends LitElement {
  @property() status: WebGLGateStatus = "software";

  // Render into light DOM so global styles (Tailwind utilities, bg-surface) apply.
  createRenderRoot() {
    return this;
  }

  render() {
    const software = this.status === "software";
    const title = software
      ? "Hardware acceleration is off"
      : "WebGL2 not supported";
    const intro = software
      ? "Your browser is rendering without GPU acceleration, so the game can't run smoothly. Here is how to activate it across the most popular web browsers:"
      : "Your browser doesn't support WebGL2, which this game requires. Here is how to enable it across the most popular web browsers:";

    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-5"
      >
        <div
          class="w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 sm:p-8 rounded-xl bg-surface text-white shadow-2xl"
        >
          <h2 class="text-xl font-bold mb-3">${title}</h2>
          <p class="text-sm leading-relaxed text-white/85 mb-5">${intro}</p>
          ${STEP_SECTIONS.map(
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
            <h3 class="text-sm font-bold text-white mb-1.5">Safari</h3>
            <ul
              class="pl-5 list-disc text-sm leading-relaxed text-white/85 space-y-1.5"
            >
              ${SAFARI_NOTES.map((note) => html`<li>${note}</li>`)}
            </ul>
          </section>
        </div>
      </div>
    `;
  }
}
