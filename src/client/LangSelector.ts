/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import "./LanguageModal";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import ar from "../../resources/lang/ar.json";
import bg from "../../resources/lang/bg.json";
import bn from "../../resources/lang/bn.json";
import cs from "../../resources/lang/cs.json";
import da from "../../resources/lang/da.json";
import de from "../../resources/lang/de.json";
import en from "../../resources/lang/en.json";
import eo from "../../resources/lang/eo.json";
import es from "../../resources/lang/es.json";
import fi from "../../resources/lang/fi.json";
import fr from "../../resources/lang/fr.json";
import gl from "../../resources/lang/gl.json";
import he from "../../resources/lang/he.json";
import hi from "../../resources/lang/hi.json";
import it from "../../resources/lang/it.json";
import ja from "../../resources/lang/ja.json";
import ko from "../../resources/lang/ko.json";
import nl from "../../resources/lang/nl.json";
import pl from "../../resources/lang/pl.json";
import pt_BR from "../../resources/lang/pt-BR.json";
import ru from "../../resources/lang/ru.json";
import sh from "../../resources/lang/sh.json";
import sk from "../../resources/lang/sk.json";
import sl from "../../resources/lang/sl.json";
import sv_SE from "../../resources/lang/sv-SE.json";
import tp from "../../resources/lang/tp.json";
import tr from "../../resources/lang/tr.json";
import uk from "../../resources/lang/uk.json";
import zh_CN from "../../resources/lang/zh-CN.json";

@customElement("lang-selector")
export class LangSelector extends LitElement {
  @state() public translations: Record<string, string> | undefined;
  @state() public defaultTranslations: Record<string, string> | undefined;
  @state() public currentLang = "en";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @state() private languageList: any[] = [];
  @state() private showModal = false;
  @state() private debugMode = false;

  private debugKeyPressed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly languageMap: Record<string, any> = {
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
    "pt-BR": pt_BR,
    ru,
    sh,
    tr,
    tp,
    uk,
    cs,
    he,
    da,
    fi,
    "sv-SE": sv_SE,
    "zh-CN": zh_CN,
    ko,
    gl,
    sl,
    sk,
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
      if (e.key.toLowerCase() === "t") this.debugKeyPressed = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.key.toLowerCase() === "t") this.debugKeyPressed = false;
    });
  }

  private getClosestSupportedLang(lang: string): string {
    if (!lang) return "en";
    if (lang in this.languageMap) return lang;

    const base = lang.slice(0, 2);
    const candidates = Object.keys(this.languageMap).filter((key) =>
      key.startsWith(base),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length); // More specific first
      return candidates[0];
    }

    return "en";
  }

  private async initializeLanguage() {
    const browserLocale = navigator.language;
    const savedLang = localStorage.getItem("lang");
    const userLang = this.getClosestSupportedLang(savedLang ?? browserLocale);

    this.defaultTranslations = this.loadLanguage("en");
    this.translations = this.loadLanguage(userLang);
    this.currentLang = userLang;

    await this.loadLanguageList();
    this.applyTranslation();
  }

  private loadLanguage(lang: string): Record<string, string> {
    const language = this.languageMap[lang] ?? {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const flat = flattenTranslations(language);
    return flat;
  }

  private async loadLanguageList() {
    try {
      const data = this.languageMap;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let debugLang: any = null;
      if (this.debugKeyPressed) {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalList: any[] = [];
      if (currentLangEntry) finalList.push(currentLangEntry);
      if (englishEntry) finalList.push(englishEntry);
      if (browserLangEntry) finalList.push(browserLangEntry);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
      "settings-modal",
      "username-input",
      "public-lobby",
      "user-setting",
      "o-modal",
      "o-button",
      "territory-patterns-modal",
      "flag-input-modal",
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (el as any).requestUpdate === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    this.debugMode = this.debugKeyPressed;
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
          class="text-center appearance-none w-full bg-blue-100
          dark:bg-gray-700 hover:bg-blue-200 dark:hover:bg-gray-600
          text-blue-900 dark:text-gray-100 p-3 sm:p-4 lg:p-5 font-medium
          text-sm sm:text-base lg:text-lg rounded-md border-none cursor-pointer
          transition-colors duration-300 flex items-center gap-2
          justify-center"
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          this.changeLanguage(e.detail.lang)}
        @close-modal=${() => (this.showModal = false)}
      ></language-modal>
    `;
  }
}

function flattenTranslations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      flattenTranslations(value, fullKey, result);
    } else {
      console.warn("Unknown type", typeof value, value);
    }
  }

  return result;
}
