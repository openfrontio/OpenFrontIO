import { html } from "lit";

export function renderCheckboxOption(
  id: string,
  checked: boolean,
  label: string,
  onChange: (e: Event) => void,
) {
  return html`
    <label class="option-card ${checked ? "selected" : ""}">
      <div class="checkbox-icon"></div>
      <input type="checkbox" .checked=${checked} @change=${onChange} />
      <div class="option-card-title">${label}</div>
    </label>
  `;
}
