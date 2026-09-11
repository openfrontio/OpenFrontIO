import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

/**
 * A deliberately leaky component, used only to prove that the global DOM
 * teardown in tests/domTeardown.ts catches the pattern: a component arms work
 * on connect, a test leaves it mounted, and the work lands later and writes
 * reactive state, which makes Lit render.
 *
 * The shape is DesktopDisplay's settle ceiling, which is what was left armed by
 * the tests that made main red on 11 Sept.
 */

/**
 * Short on purpose, so the control test can wait the timer out inside the file
 * and assert it never fired. What matters is that it outlives the TEST, not
 * that it outlives the run.
 */
export const LEAK_DELAY_MS = 25;

/** How many late updates actually reached the component, across the file. */
export const lateUpdates = { count: 0 };

/** How many times disconnectedCallback has run, across the file. */
export const disconnects = { count: 0 };

@customElement("teardown-leaker")
export class TeardownLeaker extends LitElement {
  @state() private ticks = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    this.timer = setTimeout(() => {
      lateUpdates.count++;
      // Writing @state is what schedules the render below.
      this.ticks++;
    }, LEAK_DELAY_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    disconnects.count++;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  render() {
    // Reads a global Vitest deletes when it tears the file's jsdom down. In
    // production code the same read is indirect --
    // translateText() -> getCachedLangSelector() -> document.querySelector.
    return html`<span>${document.body.childElementCount}/${this.ticks}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "teardown-leaker": TeardownLeaker;
  }
}
