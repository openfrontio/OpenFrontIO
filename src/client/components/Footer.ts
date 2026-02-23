import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("page-footer")
export class Footer extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer
        class="[.in-game_&]:hidden bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center gap-2 pt-[2px] pb-2 text-white/50 w-full border-t border-white/10 shrink-0 mt-auto"
      >
        <div class="flex items-center justify-center gap-6 pt-2">
          <a
            href="https://github.com/openfrontio/OpenFrontIO"
            target="_blank"
            rel="noopener noreferrer"
            class="opacity-60 hover:opacity-100 hover:scale-110 transition-all"
          >
            <img
              src="/icons/github-mark-white.svg"
              data-i18n-alt="news.github_link"
              class="h-7 w-7 object-contain"
            />
          </a>
          <a
            href="https://www.reddit.com/r/OpenFront/"
            target="_blank"
            rel="noopener noreferrer"
            class="opacity-60 hover:opacity-100 hover:scale-110 transition-all"
          >
            <svg
              class="h-7 w-7 object-contain"
              viewBox="0 0 24 24"
              fill="white"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.249-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"
              />
            </svg>
          </a>
          <a
            href="https://discord.gg/openfront"
            target="_blank"
            rel="noopener noreferrer"
            class="opacity-60 hover:opacity-100 hover:scale-110 transition-all"
          >
            <svg
              class="h-7 w-7 object-contain"
              viewBox="0 0 24 24"
              fill="white"
            >
              <path
                d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-14.36a.074.074 0 0 0-.032-.027zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.085 2.157 2.418 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.085 2.157 2.418 0 1.334-.946 2.419-2.157 2.419z"
              />
            </svg>
          </a>
          <a
            href="https://openfront.wiki/Main_Page"
            target="_blank"
            rel="noopener noreferrer"
            class="opacity-60 hover:opacity-100 hover:scale-110 transition-all"
          >
            <img
              src="/icons/wiki-logo.svg"
              data-i18n-alt="main.wiki"
              class="h-7 w-7 object-contain"
            />
          </a>
        </div>
        <div class="text-xs mt-2 flex items-center justify-center gap-4">
          <a
            href="/terms-of-service.html"
            data-i18n="main.terms_of_service"
            target="_blank"
            class="hover:text-white transition-colors"
          ></a>
          <span data-i18n="main.copyright"></span>
          <a
            href="/privacy-policy.html"
            data-i18n="main.privacy_policy"
            target="_blank"
            class="hover:text-white transition-colors"
          ></a>
        </div>
      </footer>
    `;
  }
}
