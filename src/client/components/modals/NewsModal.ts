import { LitElement, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";

// Universal content structure for any type of announcement/news
export interface ContentItem {
  text: string;
  contributor?: string;
  type?: "bullet" | "title" | "text" | "code" | "highlight";
}

export interface ContentSection {
  title: string;
  items: ContentItem[];
  collapsible?: boolean;
  collapsed?: boolean;
}

export interface NewsArticle {
  id?: string;
  title: string;
  type: "PATCH" | "EVENT" | "UPDATE" | "MAINTENANCE" | "ANNOUNCEMENT";
  date: string;
  summary?: string;
  sections: ContentSection[];
  tags?: string[];
  priority?: "low" | "medium" | "high" | "critical";
}

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @property({ type: Object }) article: NewsArticle | undefined;

  private renderContentItem(item: ContentItem) {
    const itemClass = item.type ? `item-text ${item.type}` : "item-text";

    return html`
      <li class="mb-2 leading-relaxed text-slate-300 text-small">
        <span class="${itemClass} inline">
          ${item.text}
          ${item.contributor
            ? html`<span
                class="contributor ml-2 text-xs italic text-blue-300 opacity-80 text-xsmall"
                >(${item.contributor})</span
              >`
            : ""}
        </span>
      </li>
    `;
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
        return ""; // Or a default color
    }
  }

  render() {
    if (!this.article) {
      return html`
        <o-modal title="Latest News">
          <div
            class="background-panel text-textLight max-h-[80vh] overflow-y-auto w-full max-w-3xl mx-auto custom scrollbar"
          >
            <p class="p-6 text-slate-300">No news article to display.</p>
          </div>
        </o-modal>
      `;
    }
    return html`
      <o-modal disableContentScroll title="Latest News">
        <div
          class="background-panel text-textLight max-h-[80vh] overflow-y-auto w-full max-w-3xl mx-auto custom scrollbar"
        >
          <!-- Header -->
          <div class="article-header border-b border-slate-700 p-6">
            <div class="header-top flex items-center justify-between mb-4">
              <div class="header-left flex items-center gap-3">
                <span
                  class="article-type font-pixel text-xs px-2 py-1 text-white uppercase
                    ${this.getTypeColor(this.article.type)}"
                >
                  ${this.article.type}
                </span>
              </div>
            </div>

            <h2
              class="article-title font-pixel text-3xl text-blue-400 mb-3 leading-tight"
            >
              ${this.article.title}
            </h2>

            <div
              class="article-date-container flex items-center gap-2 text-sm text-slate-400"
            >
              <svg
                class="calendar-icon w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>${this.article.date}</span>
            </div>

            ${this.article.summary
              ? html`<div
                  class="article-summary mt-4 text-slate-200 leading-relaxed"
                >
                  ${this.article.summary}
                </div>`
              : ""}
          </div>

          <!-- Content -->
          <div class="article-content p-6">
            ${this.article.sections.map(
              (section) => html`
                <div class="content-section mb-8">
                  <h4
                    class="section-title font-pixel text-lg text-blue-400 mb-4"
                  >
                    ${section.title}
                  </h4>
                  <ul class="content-list list-disc pl-4 mb-6">
                    ${section.items.map((item) => this.renderContentItem(item))}
                  </ul>
                </div>
              `,
            )}
          </div>
        </div>
      </o-modal>
    `;
  }

  public open(article?: NewsArticle) {
    if (article) {
      this.article = article;
    } else {
      this.article = undefined;
    }
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  createRenderRoot() {
    return this;
  }

  // Utility method to create articles programmatically
  public static createArticle(data: Partial<NewsArticle>): NewsArticle {
    return {
      id: data.id || `article-${Date.now()}`,
      title: data.title || "Untitled",
      type: data.type || "ANNOUNCEMENT",
      date: data.date || new Date().toLocaleDateString(),
      summary: data.summary,
      sections: data.sections || [],
      tags: data.tags,
      priority: data.priority || "medium",
    };
  }
}
