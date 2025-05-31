import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./LanguageModal";

import ar from "../../resources/lang/ar.json";
import bg from "../../resources/lang/bg.json";
import bn from "../../resources/lang/bn.json";
import cs from "../../resources/lang/cs.json";
import de from "../../resources/lang/de.json";
import en from "../../resources/lang/en.json";
import eo from "../../resources/lang/eo.json";
import es from "../../resources/lang/es.json";
import fr from "../../resources/lang/fr.json";
import he from "../../resources/lang/he.json";
import hi from "../../resources/lang/hi.json";
import it from "../../resources/lang/it.json";
import ja from "../../resources/lang/ja.json";
import nl from "../../resources/lang/nl.json";
import pl from "../../resources/lang/pl.json";
import pt_br from "../../resources/lang/pt_br.json";
import ru from "../../resources/lang/ru.json";
import sh from "../../resources/lang/sh.json";
import tp from "../../resources/lang/tp.json";
import tr from "../../resources/lang/tr.json";
import uk from "../../resources/lang/uk.json";

@customElement("lang-selector")
export class LangSelector extends LitElement {
  @state() public translations: any = {};
  @state() private defaultTranslations: any = {};
  @state() private currentLang: string = "en";
  @state() private languageList: any[] = [];
  @state() private showModal: boolean = false;
  @state() private debugMode: boolean = false;

  private dKeyPressed: boolean = false;

  private languageMap: Record<string, any> = {
    ar,
    bg,
    bn,
    de,
    en,
    es,
    eo,
    fr,
    it,
    hi,
    ja,
    nl,
    pl,
    pt_br,
    ru,
    sh,
    tr,
    tp,
    uk,
    cs,
    he,
  };

  createRenderRoot() {
    return this; // Use Light DOM if you prefer this
  }

  connectedCallback() {
    super.connectedCallback();
    this.setupDebugKey();
    this.initializeLanguage();
  }

  private setupDebugKey() {
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "t") this.dKeyPressed = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.key.toLowerCase() === "t") this.dKeyPressed = false;
    });
  }

  private getClosestSupportedLang(lang: string): string {
    if (!lang) return "en";
    if (lang in this.languageMap) return lang;
    const base = lang.split("-")[0];
    if (base in this.languageMap) return base;
    return "en";
  }

  private async initializeLanguage() {
    const browserLocale = navigator.language;
    const savedLang = localStorage.getItem("lang");
    const userLang = this.getClosestSupportedLang(savedLang || browserLocale);

    this.defaultTranslations = await this.loadLanguage("en");
    this.translations = await this.loadLanguage(userLang);
    this.currentLang = userLang;

    await this.loadLanguageList();
    this.applyTranslation(this.translations);
  }

  private async loadLanguage(lang: string): Promise<any> {
    return Promise.resolve(this.languageMap[lang] || {});
  }

  private async loadLanguageList() {
    try {
      const data = this.languageMap;
      let list: any[] = [];

      const browserLang = new Intl.Locale(navigator.language).language;

      for (const langCode of Object.keys(data)) {
        const langData = data[langCode].lang;
        if (!langData) continue;

        list.push({
          code: langData.lang_code ?? langCode,
          native: langData.native ?? langCode,
          en: langData.en ?? langCode,
          svg: langData.svg ?? langCode,
        });
      }

      let debugLang: any = null;
      if (this.dKeyPressed) {
        debugLang = {
          code: "debug",
          native: "Debug",
          en: "Debug",
          svg: "xx",
        };
        this.debugMode = true;
      }

      const currentLangEntry = list.find((l) => l.code === this.currentLang);
      const browserLangEntry =
        browserLang !== this.currentLang && browserLang !== "en"
          ? list.find((l) => l.code === browserLang)
          : undefined;
      const englishEntry =
        this.currentLang !== "en"
          ? list.find((l) => l.code === "en")
          : undefined;

      list = list.filter(
        (l) =>
          l.code !== this.currentLang &&
          l.code !== browserLang &&
          l.code !== "en" &&
          l.code !== "debug",
      );

      list.sort((a, b) => a.en.localeCompare(b.en));

      const finalList: any[] = [];
      if (currentLangEntry) finalList.push(currentLangEntry);
      if (englishEntry) finalList.push(englishEntry);
      if (browserLangEntry) finalList.push(browserLangEntry);
      finalList.push(...list);
      if (debugLang) finalList.push(debugLang);

      this.languageList = finalList;
    } catch (err) {
      console.error("Failed to load language list:", err);
    }
  }

  private async changeLanguage(lang: string) {
    localStorage.setItem("lang", lang);
    this.translations = await this.loadLanguage(lang);
    this.currentLang = lang;
    this.applyTranslation(this.translations);
    this.showModal = false;
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
      "user-setting",
      "o-modal",
      "o-button",
    ];

    document.title = translations.main?.title || document.title;

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      const keys = key?.split(".") || [];
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
        console.warn(`Translation key not found: ${key}`);
      }
    });

    components.forEach((tag) => {
      document.querySelectorAll(tag).forEach((el) => {
        if (typeof (el as any).requestUpdate === "function") {
          (el as any).requestUpdate();
        }
      });
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

  private openModal() {
    this.debugMode = this.dKeyPressed;
    this.showModal = true;
    this.loadLanguageList();
  }

  render() {
    const currentLang =
      this.languageList.find((l) => l.code === this.currentLang) ??
      (this.currentLang === "debug"
        ? {
            code: "debug",
            native: "Debug",
            en: "Debug",
            svg: "xx",
          }
        : {
            native: "English",
            en: "English",
            svg: "uk_us_flag",
          });

    return html`
      <div class="container__row">
        <button
          id="lang-selector"
          @click=${this.openModal}
          class="text-center appearance-none w-full bg-blue-100 hover:bg-blue-200 text-blue-900 p-3 sm:p-4 lg:p-5 font-medium text-sm sm:text-base lg:text-lg rounded-md border-none cursor-pointer transition-colors duration-300 flex items-center gap-2 justify-center"
        >
          <img
            id="lang-flag"
            class="w-6 h-4"
            src="/flags/${currentLang.svg}.svg"
            alt="flag"
          />
          <span id="lang-name">${currentLang.native} (${currentLang.en})</span>
        </button>
      </div>

      <language-modal
        .visible=${this.showModal}
        .languageList=${this.languageList}
        .currentLang=${this.currentLang}
        @language-selected=${(e: CustomEvent) =>
          this.changeLanguage(e.detail.lang)}
        @close-modal=${() => (this.showModal = false)}
      ></language-modal>
    `;
  }
}
