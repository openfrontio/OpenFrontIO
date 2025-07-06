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
    this.requestUpdate(); // Trigger re-render to show loading state

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
      this.requestUpdate(); // Trigger re-render when loading is complete
    }
  }

  private getCurrentArticle(): NewsArticle | null {
    return this.article || this._loadedArticle;
  }

  private async handleClick() {
    // If we're still loading, wait for it to complete
    if (this._isLoading) {
      // Wait for loading to complete
      while (this._isLoading) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const currentArticle = this.getCurrentArticle();
    if (!currentArticle) return;

    // Dispatch custom event that parent can listen to
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

  private formatTimeAgo(article: NewsArticle): string {
    if (this.timeAgo) {
      return this.timeAgo;
    }

    // Simple time calculation based on article date
    const articleDate = new Date(article.date);
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
                <span
                  class="text-primary hover:text-primaryLighter transition-colors ml-1 read-more"
                >
                  Read more...
                </span>
              </p>
            `
          : html`
              <p class="text-xsmall  text-textGrey">
                <span
                  class="text-primary hover:text-primaryLighter transition-colors read-more"
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
