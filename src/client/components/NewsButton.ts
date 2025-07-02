import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { NewsArticle } from "./modals/NewsModal";

@customElement("news-button")
export class NewsButton extends LitElement {
  static properties = {
    article: { type: Object },
    timeAgo: { type: String },
  };

  article!: NewsArticle;
  timeAgo?: string;

  private handleClick() {
    // Dispatch custom event that parent can listen to
    this.dispatchEvent(
      new CustomEvent("news-article-click", {
        detail: { article: this.article },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private getTypeColor(type: string): string {
    switch (type.toLowerCase()) {
      case "patch":
        return "bg-orange";
      case "event":
        return "bg-green";
      case "update":
        return "bg-orange";
      case "maintenance":
        return "bg-backgroundGrey";
      case "announcement":
        return "bg-primary";
      default:
        return "bg-slate-600";
    }
  }

  private formatTimeAgo(): string {
    if (this.timeAgo) {
      return this.timeAgo;
    }

    // Simple time calculation based on article date
    const articleDate = new Date(this.article.date);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - articleDate.getTime()) / (1000 * 60 * 60),
    );

    if (diffInHours < 1) {
      return "Just now";
    } else if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays}d ago`;
    }
  }

  render() {
    if (!this.article) {
      return html``;
    }

    return html`
      <div
        class="background-panel p-3 hover:bg-slate-800/50 transition-all cursor-pointer group"
        @click=${this.handleClick}
      >
        <div class="flex items-center justify-between mb-2">
          <span
            class="text-xs font-title px-2 py-0.5 text-white uppercase ${this.getTypeColor(
              this.article.type,
            )}"
          >
            ${this.article.type}
          </span>
          <span class="text-xs text-slate-400">${this.formatTimeAgo()}</span>
        </div>

        <h4
          class="font-title text-white text-sm mb-1 group-hover:text-blue-400 transition-colors"
        >
          ${this.article.title}
        </h4>

        ${this.article.summary
          ? html`
              <p class="text-xs text-slate-400">
                ${this.article.summary}
                <span
                  class="text-blue-400 hover:text-blue-300 transition-colors ml-1 read-more"
                >
                  Read more...
                </span>
              </p>
            `
          : html`
              <p class="text-xs text-slate-400">
                <span
                  class="text-blue-400 hover:text-blue-300 transition-colors read-more"
                >
                  Read more...
                </span>
              </p>
            `}
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
