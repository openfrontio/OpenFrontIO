import { LitElement, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { translateText } from "../../Utils";

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
      <li class="mb-2 leading-relaxed text-textGrey text-small">
        <span class="${itemClass} inline">
          ${item.text}
          ${item.contributor
            ? html`<span
                class="ml-2 italic text-primaryLighter opacity-80 text-xsmall"
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

  render() {
    if (!this.article) {
      return html`
        <o-modal title="Latest News">
          <div
            class="text-textLight max-h-[80vh] overflow-y-auto w-full mx-auto custom-scrollbar"
          >
            <p class="p-6 text-textGrey">No news article to display.</p>
          </div>
        </o-modal>
      `;
    }
    return html`
      <o-modal disableContentScroll title=${translateText("main.latest_news")}>
        <div
          class=" text-textLight max-h-[80vh] overflow-y-auto w-full mx-auto custom-scrollbar"
        >
          <!-- Header -->
          <div class=" border-b border-borderBase py-6 px-0 sm:p-6">
            <div class=" flex items-center justify-between mb-4">
              <div class=" flex items-center gap-3">
                <span
                  class=" font-title text-small px-2 py-1 text-textLight uppercase
                    ${this.getTypeColor(this.article.type)}"
                >
                  ${this.article.type}
                </span>
              </div>
            </div>

            <h2 class=" font-title text-3xl text-primary mb-3 leading-tight">
              ${this.article.title}
            </h2>

            <div class="flex items-center gap-2 text-small text-textGrey">
              <o-icon
                src="icons/calendar.svg"
                size="small"
                color="var(--text-color-grey)"
              ></o-icon>
              <span>${this.article.date}</span> q
            </div>

            ${this.article.summary
              ? html`<div class="mt-4  text-textLight leading-relaxed">
                  ${this.article.summary}
                </div>`
              : ""}
          </div>

          <!-- Content -->
          <div class="py-6 px-0 sm:p-6">
            ${this.article.sections.map(
              (section) => html`
                <div class=" mb-8">
                  <h4 class=" font-title text-medium text-textLight mb-4">
                    ${section.title}
                  </h4>
                  <ul class=" list-disc pl-4 mb-6">
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

  public async open(article?: NewsArticle) {
    if (article) {
      this.article = article;
    } else {
      this.article = undefined;
    }

    this.requestUpdate();
    await this.updateComplete;

    await this.waitForModalElement();

    this.modalEl?.open();
  }

  private async waitForModalElement(): Promise<void> {
    let attempts = 0;
    const maxAttempts = 20;

    while (!this.modalEl && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
    }

    if (!this.modalEl) {
      console.warn("Modal element not found after waiting");
    }
  }

  public close() {
    this.modalEl?.close();
  }

  createRenderRoot() {
    return this;
  }

  // Utility method to create articles
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
