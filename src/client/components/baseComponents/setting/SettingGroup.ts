import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

const COLLAPSED_STATE_KEY = "settings.collapsedGroups";

@customElement("setting-group")
export class SettingGroup extends LitElement {
  @property() label = "Group";
  @property() groupId = "";
  @property({ type: Boolean }) columns = false;

  @state() private collapsed = false;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .setting-group {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .setting-group__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.05);
      cursor: pointer;
      user-select: none;
      transition: background 0.2s ease;
    }

    .setting-group__header:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .setting-group__title {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .setting-group__toggle {
      font-size: 12px;
      color: #888;
      transition: transform 0.2s ease;
    }

    .setting-group__toggle.collapsed {
      transform: rotate(-90deg);
    }

    .setting-group__content {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .setting-group__content.collapsed {
      display: none;
    }

    .setting-group__content.columns {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .setting-group__content.columns.collapsed {
      display: none;
    }

    /* Ensure slotted items fill their column */
    ::slotted(*) {
      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadCollapsedState();
  }

  private loadCollapsedState() {
    if (!this.groupId) return;
    try {
      const saved = localStorage.getItem(COLLAPSED_STATE_KEY);
      if (saved) {
        const states = JSON.parse(saved) as Record<string, boolean>;
        this.collapsed = states[this.groupId] ?? false;
      }
    } catch {
      // Ignore parse errors
    }
  }

  private saveCollapsedState() {
    if (!this.groupId) return;
    try {
      const saved = localStorage.getItem(COLLAPSED_STATE_KEY);
      const states = saved
        ? (JSON.parse(saved) as Record<string, boolean>)
        : {};
      states[this.groupId] = this.collapsed;
      localStorage.setItem(COLLAPSED_STATE_KEY, JSON.stringify(states));
    } catch {
      // Ignore storage errors
    }
  }

  private toggleCollapsed() {
    this.collapsed = !this.collapsed;
    this.saveCollapsedState();
  }

  render() {
    const contentClasses = [
      "setting-group__content",
      this.collapsed ? "collapsed" : "",
      this.columns ? "columns" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return html`
      <div class="setting-group">
        <div class="setting-group__header" @click=${this.toggleCollapsed}>
          <span class="setting-group__title">${this.label}</span>
          <span
            class="setting-group__toggle ${this.collapsed ? "collapsed" : ""}"
          >
            ▼
          </span>
        </div>
        <div class="${contentClasses}">
          <slot></slot>
        </div>
      </div>
    `;
  }
}
