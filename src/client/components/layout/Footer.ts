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
        class="relative bottom-0 left-0 right-0 w-screen sm:w-full bg-backgroundDark backdrop-blur-sm border-t border-borderBase -mx-4 sm:mx-0"
      >
        <div class="w-full py-3 px-4 sm:max-w-7xl sm:mx-auto sm:px-3">
          <div
            class="flex flex-col sm:flex-row items-center text-small text-textGrey w-full justify-between gap-2 sm:gap-4"
          >
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
            <a
              href="https://github.com/openfrontio/OpenFrontIO"
              class="hover:text-textLight transition-colors whitespace-nowrap"
              >©2025 OpenFront™</a
            >
            <a
              href="/privacy-policy.html"
              class="hover:text-textLight transition-colors whitespace-nowrap"
              >Privacy Policy</a
            >
            <a
              href="/terms-of-service.html"
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
      </footer>
    `;
  }
}
