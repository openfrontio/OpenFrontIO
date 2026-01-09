import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

type SelectOption = {
  value: number | string;
  label: string;
};

@customElement("setting-select")
export class SettingSelect extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Array }) options: SelectOption[] = [];
  @property({ type: String }) value = "";
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const input = e.target as HTMLSelectElement;
    const selected = this.options.find(
      (option) => String(option.value) === input.value,
    );
    const selectedValue = selected?.value ?? input.value;
    this.value = String(selectedValue);

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: selectedValue },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="setting-item${this.easter ? " easter-egg" : ""}">
        <div class="setting-label-group">
          <label class="setting-label" for="setting-select-input"
            >${this.label}</label
          >
          <div class="setting-description">${this.description}</div>
        </div>
        <select
          id="setting-select-input"
          class="setting-input select"
          .value=${String(this.value)}
          @change=${this.handleChange}
        >
          ${this.options.map(
            (option) =>
              html`<option
                value=${String(option.value)}
                ?selected=${String(option.value) === String(this.value)}
              >
                ${option.label}
              </option>`,
          )}
        </select>
      </div>
    `;
  }
}
