import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

// Import language files
import bgTranslations from "../../resources/lang/bg.json";
import deTranslations from "../../resources/lang/de.json";
import enTranslations from "../../resources/lang/en.json";
import esTranslations from "../../resources/lang/es.json";
import frTranslations from "../../resources/lang/fr.json";
import jaTranslations from "../../resources/lang/ja.json";
import nlTranslations from "../../resources/lang/nl.json";

const translations = {
  en: enTranslations,
  bg: bgTranslations,
  ja: jaTranslations,
  fr: frTranslations,
  nl: nlTranslations,
  de: deTranslations,
  es: esTranslations,
};

@customElement("lang-selector")
export class LangSelector extends LitElement {
  @state() public translations: any = {};
  @state() private defaultTranslations: any = {};
  @state() private currentLang: string = "en";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.initializeLanguage();
  }

  private async initializeLanguage() {
    const locale = new Intl.Locale(navigator.language);
    const defaultLang = locale.language;
    const userLang = localStorage.getItem("lang") || defaultLang;

    this.defaultTranslations = await this.loadLanguage("en");
    this.translations = await this.loadLanguage(userLang);
    this.currentLang = userLang;

    this.applyTranslation(this.translations);
  }

  private async loadLanguage(lang: string): Promise<any> {
    try {
      const translation = translations[lang as keyof typeof translations];
      if (!translation) throw new Error(`Language file not found: ${lang}`);
      return translation;
    } catch (error) {
      console.error("🚨 Translation load error:", error);
      return {};
    }
  }

  private applyTranslation(translations: any) {
    const components = [
      "single-player-modal",
      "host-lobby-modal",
      "join-private-lobby-modal",
      "emoji-table",
      "leader-board",
      "build-menu",
      "win-modal",
      "game-starting-modal",
      "top-bar",
      "player-panel",
      "help-modal",
      "username-input",
      "public-lobby",
    ];

    document.title = translations.main?.title || document.title;

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      const keys = key.split(".");
      let text = translations;
      for (const k of keys) {
        text = text?.[k];
        if (!text) break;
      }
      if (!text && this.defaultTranslations) {
        let fallback = this.defaultTranslations;
        for (const k of keys) {
          fallback = fallback?.[k];
          if (!fallback) break;
        }
        text = fallback;
      }
      if (text) {
        element.innerHTML = text;
      } else {
        console.warn(`Missing translation key: ${key}`);
      }
    });

    components.forEach((tagName) => {
      const el = document.querySelector(tagName) as any;
      if (el && typeof el.requestUpdate === "function") {
        el.requestUpdate();
      } else {
        console.warn(
          `requestUpdate() not available on <${tagName}> or element not found.`,
        );
      }
    });
  }

  public translateText(
    key: string,
    params: Record<string, string | number> = {},
  ): string {
    const keys = key.split(".");
    let text: any = this.translations;

    for (const k of keys) {
      text = text?.[k];
      if (!text) break;
    }

    if (!text && this.defaultTranslations) {
      text = this.defaultTranslations;
      for (const k of keys) {
        text = text?.[k];
        if (!text) return key;
      }
    }

    for (const [param, value] of Object.entries(params)) {
      text = text.replace(`{${param}}`, String(value));
    }

    return text;
  }

  private async changeLanguage(lang: string) {
    localStorage.setItem("lang", lang);
    this.translations = await this.loadLanguage(lang);
    this.currentLang = lang;
    this.applyTranslation(this.translations);
  }

  render() {
    return html`
      <select
        @change=${(e: Event) =>
          this.changeLanguage((e.target as HTMLSelectElement).value)}
        class="text-center appearance-none w-full bg-blue-100 hover:bg-blue-200 text-blue-900 p-3 sm:p-4 lg:p-5 font-medium text-sm sm:text-base lg:text-lg rounded-md border-none cursor-pointer transition-colors duration-300"
      >
        <option value="en" ?selected=${this.currentLang === "en"}>
          English
        </option>
        <option value="bg" ?selected=${this.currentLang === "bg"}>
          Български
        </option>
        <option value="ja" ?selected=${this.currentLang === "ja"}>
          日本語
        </option>
        <option value="fr" ?selected=${this.currentLang === "fr"}>
          Français
        </option>
        <option value="nl" ?selected=${this.currentLang === "nl"}>
          Nederlands
        </option>
        <option value="de" ?selected=${this.currentLang === "de"}>
          Deutsch
        </option>
        <option value="es" ?selected=${this.currentLang === "es"}>
          Español
        </option>
      </select>
    `;
  }
}
