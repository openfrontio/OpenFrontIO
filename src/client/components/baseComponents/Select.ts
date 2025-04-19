import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

interface selectItems {
  label: string;
  value: any;
  image?: string;
}

@customElement("o-select")
export class OSelect extends LitElement {
  /**
   * Array of selectable items.
   */
  @property({ type: Array }) items: selectItems[] = [];

  /**
   * Currently selected value.
   */
  @property({ type: String }) selectedValue: string = "";

  /**
   * Error message to display.
   */
  @property({ type: String }) errorMessage: string = "";

  /**
   * Enables search filtering in the dropdown.
   */
  @property({ type: Boolean }) filterEnabled: boolean = false;

  /**
   * If true, show image next to label.
   */
  @property({ type: Boolean }) showImageWithLabel: boolean = false;

  /**
   * Label shown above the select.
   */
  @property({ type: String }) label: string = "";
  @property({ type: String }) translationKey = "";

  @state() private selectedItem: selectItems | null = null;
  @state() private filter: string = "";
  @state() private isOpen: boolean = false;

  static styles = css`
    .c-label {
      color: var(--fontColorLight);
      font-size: 14px;
    }

    .c-select {
      position: relative;
      cursor: pointer;
      padding: 0 10px;
      border: 1px solid transparent;
      border-radius: var(--borderRadius--md);
      background: #1e1e1e;
      height: 50px;

      &.is-error {
        border-color: var(--errorColor);

        + .c-message {
          color: var(--errorColor);
        }
      }
    }

    .c-select__display {
      align-items: center;
      color: var(--fontColorLight);
      width: 100%;
      display: flex;
      gap: 10px;

      span {
        flex: 1;
      }

      img {
        width: 24px;
      }
    }

    .c-select__listWrapper {
      border: 1px solid var(--secondaryBorderColor);
      position: absolute;
      left: -1px;
      right: -1px;
      background: var(--boxBackgroundColor);
      backdrop-filter: blur(var(--blur-md));
      top: 50px;
      z-index: 1000;
    }

    .c-select__list {
      list-style: none;
      overflow: scroll;
      max-height: 35dvh;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 5px;
      margin: 0;
    }

    .c-select__item {
      align-items: center;
      display: flex;
      min-height: 35px;
      color: var(--fontColorLight);
      gap: 10px;

      img {
        max-width: 35px;
        height: auto;
      }
    }

    .c-select__input {
      outline: none;
      padding: 4px 8px;
      margin-bottom: 5px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this._handleOutsideClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("click", this._handleOutsideClick);
  }

  willUpdate(changedProps: Map<string | number | symbol, unknown>) {
    if (changedProps.has("items") || changedProps.has("selectedValue")) {
      const match = this.items.find(
        (item) => item.value === this.selectedValue,
      );
      if (match) {
        this.selectedItem = match;
      }
    }
  }

  private _handleOutsideClick = (event: MouseEvent) => {
    if (!this.contains(event.target as Node)) {
      this.isOpen = false;
    }
  };

  private selectItem(item: selectItems) {
    this.selectedItem = item;
    this.filter = "";
    this.isOpen = false;
    this.dispatchEvent(
      new CustomEvent("o-select-change", {
        detail: item.value,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderSelectedDisplay() {
    if (!this.selectedItem) {
      return html`<span>Select</span>`;
    }

    const { image, label } = this.selectedItem;

    if (this.showImageWithLabel) {
      return html`
        ${image ? html`<img src="${image}" alt="${label} flag" />` : null}
        <span>${label}</span>
      `;
    }

    return image
      ? html`<img src="${image}" alt="${label} flag" />`
      : html`<span>${label}</span>`;
  }

  get filteredItems() {
    return this.items.filter((item) =>
      item.label.toLowerCase().includes(this.filter.toLowerCase()),
    );
  }

  render() {
    return html`
      <div
        class="c-select ${this.errorMessage ? "is-error" : ""}"
        @click=${() => (this.isOpen = !this.isOpen)}
      >
        ${this.label
          ? html`<label class="c-label">
              ${`${this.translationKey}` === ""
                ? `${this.label}`
                : `${translateText(this.translationKey)}`}</label
            >`
          : null}
        <div class="c-select__display">${this.renderSelectedDisplay()}</div>

        ${this.isOpen
          ? html`
              <div class="c-select__listWrapper">
                ${this.filterEnabled
                  ? html`
                      <input
                        class="c-select__input"
                        type="text"
                        placeholder="Search..."
                        .value=${this.filter}
                        @input=${(e: InputEvent) => {
                          this.filter = (e.target as HTMLInputElement).value;
                          e.stopPropagation();
                          e.stopImmediatePropagation();
                        }}
                        @click=${(e: Event) => e.stopPropagation()}
                      />
                    `
                  : null}
                <ul class="c-select__list">
                  ${this.filteredItems.map(
                    (item) => html`
                      <li
                        class="c-select__item"
                        @click=${(e: Event) => {
                          this.selectItem(item);
                          e.stopPropagation();
                          e.stopImmediatePropagation();
                        }}
                      >
                        ${item.image
                          ? html`<img
                              src="${item.image}"
                              alt="${item.label}"
                            />`
                          : ""}
                        <div>${item.label}</div>
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `
          : ""}
      </div>
      ${this.errorMessage
        ? html` <div class="c-message">${this.errorMessage}</div>`
        : ""}
    `;
  }
}
