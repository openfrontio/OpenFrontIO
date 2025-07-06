import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { NewsArticle } from "./modals/NewsModal";

@customElement("news-button")
export class NewsButton extends LitElement {
  @property({ type: String }) file?: string;
  @property({ type: Object }) article?: NewsArticle;
  @property({ type: String }) timeAgo?: string;

  private _loadedArticle: NewsArticle | null = null;
  private _isLoading = false;

  async connectedCallback() {
    super.connectedCallback();

    if (this.file && !this.article) {
      await this.loadArticleFromFile();
    }
  }

  private async loadArticleFromFile() {
    if (!this.file || this._isLoading) return;

    this._isLoading = true;
    this.requestUpdate();

    try {
      const response = await fetch(this.file);
      if (!response.ok) {
        throw new Error(`Failed to load article: ${response.statusText}`);
      }

      const articleData = await response.json();
      this._loadedArticle = articleData as NewsArticle;
    } catch (error) {
      console.error("Error loading news article:", error);
    } finally {
      this._isLoading = false;
      this.requestUpdate();
    }
  }

  private getCurrentArticle(): NewsArticle | null {
    return this.article || this._loadedArticle;
  }

  private async handleClick() {
    if (this._isLoading) return;

    const currentArticle = this.getCurrentArticle();
    if (!currentArticle) return;

    this.dispatchEvent(
      new CustomEvent("news-article-click", {
        detail: { article: currentArticle },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private getTypeColor(type: string): string {
    switch (type.toLowerCase()) {
      case "patch":
        return "bg-green";
      case "event":
        return "bg-orange";
      case "update":
        return "bg-backgroundDarkLighter";
      case "maintenance":
        return "bg-red";
      case "announcement":
        return "bg-primary";
      default:
        return "bg-backgroundGrey";
    }
  }

  private parseArticleDate(dateString: string): Date {
    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
      // Try parsing formats like "June 21, 2025"
      const parsed = Date.parse(dateString);
      if (!isNaN(parsed)) {
        return new Date(parsed);
      }

      console.warn(`Unable to parse date: ${dateString}`);
      return new Date();
    }

    return date;
  }

  private formatTimeAgo(article: NewsArticle): string {
    if (this.timeAgo) {
      return this.timeAgo;
    }

    const articleDate = this.parseArticleDate(article.date);
    const now = new Date();
    const diffInMs = now.getTime() - articleDate.getTime();

    if (diffInMs < 0) {
      const futureDiffInMs = Math.abs(diffInMs);
      const futureDiffInHours = Math.floor(futureDiffInMs / (1000 * 60 * 60));

      if (futureDiffInHours < 24) {
        return `In ${futureDiffInHours}h`;
      } else {
        const futureDiffInDays = Math.floor(futureDiffInHours / 24);
        return `In ${futureDiffInDays}d`;
      }
    }

    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    const diffInWeeks = Math.floor(diffInDays / 7);
    const diffInMonths = Math.floor(diffInDays / 30);
    const diffInYears = Math.floor(diffInDays / 365);

    if (diffInMinutes < 1) {
      return "Just now";
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else if (diffInDays < 7) {
      return `${diffInDays}d ago`;
    } else if (diffInWeeks < 4) {
      return `${diffInWeeks}w ago`;
    } else if (diffInMonths < 12) {
      return `${diffInMonths}mo ago`;
    } else {
      return `${diffInYears}y ago`;
    }
  }

  render() {
    const currentArticle = this.getCurrentArticle();

    if (this._isLoading) {
      return html`
        <div class="background-panel p-3 animate-pulse">
          <div class="flex items-center justify-between mb-2">
            <div class="h-4 bg-backgroundGrey rounded w-16"></div>
            <div class="h-3 bg-backgroundGrey rounded w-12"></div>
          </div>
          <div class="h-4 bg-backgroundGrey rounded w-3/4 mb-2"></div>
          <div class="h-3 bg-backgroundGrey rounded w-full"></div>
        </div>
      `;
    }

    if (!currentArticle) {
      return html`
        <div class="background-panel p-3 bg-red">
          <p class="text-red text-small">Failed to load news article</p>
        </div>
      `;
    }

    return html`
      <div
        class="background-panel p-3 hover:bg-backgroundDarkLighter transition-all cursor-pointer group mb-2"
        @click=${this.handleClick}
        id="news-button"
        style="${this._isLoading ? "pointer-events: none; opacity: 0.7;" : ""}"
      >
        <div class="flex items-center justify-between mb-2">
          <span
            class="font-title text-xsmall px-2 py-0.5 text-textLight uppercase ${this.getTypeColor(
              currentArticle.type,
            )}"
          >
            ${currentArticle.type}
          </span>
          <span class="text-xsmall text-textGrey"
            >${this.formatTimeAgo(currentArticle)}</span
          >
        </div>

        <h4
          class="font-title text-textLight text-small mb-1  transition-colors"
        >
          ${currentArticle.title}
        </h4>

        ${currentArticle.summary
          ? html`
              <p class="text-xsmall font-secondary text-textGrey">
                ${currentArticle.summary}
              </p>
            `
          : html` <p class="text-xsmall  text-textGrey"></p> `}
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
