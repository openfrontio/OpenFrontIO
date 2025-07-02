import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("main-footer")
export class MainFooter extends LitElement {
  // Prevent Shadow DOM to allow Tailwind CSS to apply styles
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer
        class="fixed bottom-0 left-0 right-0 w-full bg-backgroundDark backdrop-blur-sm border-t border-borderBase z-[var(--z-index-base)]"
      >
        <div class="w-full px-4 py-3 max-w-7xl mx-auto">
          <div
            class="flex flex-col sm:flex-row items-center text-small text-textGrey gap-4 w-full sm:justify-between"
          >
            <div class="flex gap-4 justify-center sm:justify-start">
              <a
                data-i18n="main.how_to_play"
                href="https://www.youtube.com/watch?si=znspkP84P76B1w5I&v=jvHEvbko3uw&feature=youtu.be"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >How to Play</a
              >
              <a
                data-i18n="main.wiki"
                href="https://openfront.miraheze.org/wiki/Main_Page"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >Wiki</a
              >
              <a
                data-i18n="main.join_discord"
                href="https://discord.com/invite/jRpxXvG42t"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >Join the Discord!</a
              >
            </div>
            <div class="flex gap-4 justify-center sm:justify-end">
              <a
                href="https://github.com/openfrontio/OpenFrontIO"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >©2025 OpenFront™</a
              >
              <a
                href="/terms-of-service.html"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >Privacy Policy</a
              >
              <a
                href="/privacy-policy.html"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >Terms of Service</a
              >
              <a
                data-i18n="main.advertise"
                href="https://www.playwire.com/contact-direct-sales"
                class="hover:text-textLight transition-colors whitespace-nowrap"
                >Advertise</a
              >
            </div>
          </div>
        </div>
      </footer>
    `;
  }
}
