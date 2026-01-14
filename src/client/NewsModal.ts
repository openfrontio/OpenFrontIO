import { html, LitElement } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, property, query } from "lit/decorators.js";
import version from "resources/version.txt?raw";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import changelog from "/changelog.md?url";
import megaphone from "/images/Megaphone.svg?url";

@customElement("news-modal")
export class NewsModal extends BaseModal {
  @property({ type: String }) markdown = "Loading...";

  private initialized: boolean = false;

  render() {
    const content = html`
      <div
        class="h-full flex flex-col ${this.inline
          ? "bg-black/60 backdrop-blur-md rounded-2xl border border-white/10"
          : ""}"
      >
        ${modalHeader({
          title: translateText("news.title"),
          onBack: this.close,
          ariaLabel: translateText("common.back"),
        })}
        <div
          class="prose prose-invert prose-sm max-w-none overflow-y-auto px-6 py-3 mr-1
            [&_a]:text-blue-400 [&_a:hover]:text-blue-300 transition-colors
            [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-white [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-2
            [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-200
            [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-100
            [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1
            [&_li]:text-gray-300 [&_li]:leading-relaxed
            [&_p]:text-gray-300 [&_p]:mb-3 [&_strong]:text-white [&_strong]:font-bold
            scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
        >
          ${resolveMarkdown(this.markdown, {
            includeImages: true,
            includeCodeBlockClassNames: true,
          })}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title=${translateText("news.title")}
        ?inline=${this.inline}
        hideCloseButton
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  protected onOpen(): void {
    if (!this.initialized) {
      this.initialized = true;
      fetch(changelog)
        .then((response) => (response.ok ? response.text() : "Failed to load"))
        .then((markdown) =>
          markdown
            // Convert bold header lines (e.g. "**Title**") into real Markdown headers
            // Exclude lines starting with - or * to avoid converting bullet points
            .replace(/^([^\-*\s].*?) \*\*(.+?)\*\*$/gm, "## $1 $2")
            .replace(
              /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/pull\/(\d+)\b/g,
              (_match, prNumber) =>
                `[#${prNumber}](https://github.com/openfrontio/OpenFrontIO/pull/${prNumber})`,
            )
            .replace(
              /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/compare\/([\w.-]+)\b/g,
              (_match, comparison) =>
                `[${comparison}](https://github.com/openfrontio/OpenFrontIO/compare/${comparison})`,
            ),
        )
        .then((markdown) => (this.markdown = markdown));
    }
  }
}

@customElement("news-button")
export class NewsButton extends LitElement {
  @query("news-modal") private newsModal!: NewsModal;

  connectedCallback() {
    super.connectedCallback();
    this.checkForNewVersion();
  }

  private checkForNewVersion() {
    const lastSeenVersion = localStorage.getItem("last-seen-version");
    if (lastSeenVersion !== null && lastSeenVersion !== version) {
      setTimeout(() => {
        this.open();
      }, 500);
    }
  }

  public open() {
    localStorage.setItem("last-seen-version", version);
    this.newsModal.open();
  }

  render() {
    return html`
      <button
        class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)] hidden"
        @click=${this.open}
      >
        <img
          class="size-[48px] dark:invert"
          src="${megaphone}"
          alt=${translateText("news.title")}
        />
      </button>
      <news-modal></news-modal>
    `;
  }
}
