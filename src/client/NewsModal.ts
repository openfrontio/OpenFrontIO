import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { assetUrl } from "../core/AssetUrls";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { renderMarkdown } from "./Markdown";
import { normalizeNewsMarkdown } from "./NewsMarkdown";

@customElement("news-modal")
export class NewsModal extends BaseModal {
  protected routerName = "news";

  @property({ type: String }) markdown = "Loading...";

  private initialized: boolean = false;

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("news.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    return html`
      <div
        class="prose prose-invert prose-sm max-w-none px-6 py-3
          [&_a]:text-blue-400 [&_a:hover]:text-blue-300 transition-colors
          [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-white [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-2
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-200
          [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-100
          [&_ul]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1
          [&_li]:text-gray-300 [&_li]:leading-relaxed
          [&_p]:text-gray-300 [&_p]:mb-3 [&_strong]:text-white [&_strong]:font-bold"
      >
        ${renderMarkdown(this.markdown, { includeImages: true })}
      </div>
    `;
  }

  protected onOpen(): void {
    if (!this.initialized) {
      this.initialized = true;
      fetch(assetUrl("changelog.md"))
        .then((response) => (response.ok ? response.text() : "Failed to load"))
        .then((markdown) => normalizeNewsMarkdown(markdown))
        .then((markdown) => (this.markdown = markdown))
        .catch(() => (this.markdown = "Failed to load"));
    }
  }
}
