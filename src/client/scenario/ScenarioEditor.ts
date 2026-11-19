import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * The scenario editor: a full-page screen that replaces the menu, like the
 * replay viewer. A placeholder for now; see docs/ScenarioEditor.md.
 */
@customElement("scenario-editor")
export class ScenarioEditor extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="fixed inset-0 flex items-center justify-center bg-slate-900 text-white text-2xl"
      >
        Scenario editor
      </div>
    `;
  }
}
