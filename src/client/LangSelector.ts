import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./LanguageModal";

import ar from "../../resources/lang/ar_SA.json";
import bg from "../../resources/lang/bg_BG.json";
import bn from "../../resources/lang/bn_BD.json";
import cs from "../../resources/lang/cs_CZ.json";
import de from "../../resources/lang/de_DE.json";
import en from "../../resources/lang/en.json";
import en_US from "../../resources/lang/en_US.json";
import eo from "../../resources/lang/eo_UY.json";
import es from "../../resources/lang/es_ES.json";
import fr from "../../resources/lang/fr_FR.json";
import he from "../../resources/lang/he_IL.json";
import hi from "../../resources/lang/hi_IN.json";
import it from "../../resources/lang/it_IT.json";
import ja from "../../resources/lang/ja_JP.json";
import nl from "../../resources/lang/nl_NL.json";
import pl from "../../resources/lang/pl_PL.json";
import pt_BR from "../../resources/lang/pt_BR.json";
import ru from "../../resources/lang/ru_RU.json";
import sh from "../../resources/lang/sh_HR.json";
import tp from "../../resources/lang/tp_TP.json";
import tr from "../../resources/lang/tr_TR.json";
import uk from "../../resources/lang/uk_UA.json";

@customElement("lang-selector")
export class LangSelector extends LitElement {
  @state() public translations: Record<string, string> | undefined;
  @state() private defaultTranslations: Record<string, string> | undefined;
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
    en_US,
    es,
    eo,
    fr,
    it,
    hi,
    ja,
    nl,
    pl,
    pt_BR,
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

    this.defaultTranslations = this.loadLanguage("en");
    this.translations = this.loadLanguage(userLang);
    this.currentLang = userLang;

    await this.loadLanguageList();
    this.applyTranslation();
  }

  private loadLanguage(lang: string): Record<string, string> {
    const language = this.languageMap[lang] || {};
    const flat = flattenTranslations(language);
    return flat;
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

  private changeLanguage(lang: string) {
    localStorage.setItem("lang", lang);
    this.translations = this.loadLanguage(lang);
    this.currentLang = lang;
    this.applyTranslation();
    this.showModal = false;
  }

  private applyTranslation() {
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
      "replay-panel",
      "help-modal",
      "username-input",
      "public-lobby",
      "user-setting",
      "o-modal",
      "o-button",
    ];

    document.title = this.translateText("main.title") ?? document.title;

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (key === null) return;
      const text = this.translateText(key);
      if (text === null) {
        console.warn(`Translation key not found: ${key}`);
        return;
      }
      element.textContent = text;
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
    let text: string | undefined;
    if (this.translations && key in this.translations) {
      text = this.translations[key];
    } else if (this.defaultTranslations && key in this.defaultTranslations) {
      text = this.defaultTranslations[key];
    } else {
      console.warn(`Translation key not found: ${key}`);
      return key;
    }

    for (const param in params) {
      const value = params[param];
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

function flattenTranslations(
  obj: Record<string, any>,
  parentKey = "",
  result: Record<string, string> = {},
): Record<string, string> {
  for (const key in obj) {
    const value = obj[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTranslations(value, fullKey, result);
    } else {
      console.warn("Unknown type", typeof value, value);
    }
  }

  return result;
}
