import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import bg from "../../../resources/lang/bg.json";
import bn from "../../../resources/lang/bn.json";
import de from "../../../resources/lang/de.json";
import en from "../../../resources/lang/en.json";
import eo from "../../../resources/lang/eo.json";
import es from "../../../resources/lang/es.json";
import fr from "../../../resources/lang/fr.json";
import hi from "../../../resources/lang/hi.json";
import it from "../../../resources/lang/it.json";
import ja from "../../../resources/lang/ja.json";
import nl from "../../../resources/lang/nl.json";
import pl from "../../../resources/lang/pl.json";
import pt_br from "../../../resources/lang/pt_br.json";
import ru from "../../../resources/lang/ru.json";
import sh from "../../../resources/lang/sh.json";
import tr from "../../../resources/lang/tr.json";
import uk from "../../../resources/lang/uk.json";
import { UserSettings } from "../../core/game/UserSettings";
import "./baseComponents/Select";
import "./baseComponents/setting/SettingNumber";
import "./baseComponents/setting/SettingSlider";
import "./baseComponents/setting/SettingToggle";

@customElement("user-setting")
export class UserSettingModal extends LitElement {
  private userSettings: UserSettings = new UserSettings();

  @state() private darkMode: boolean = this.userSettings.darkMode();
  @state() public translations: any = {};
  @state() private defaultTranslations: any = {};
  @state() private keySequence: string[] = [];
  @state() private showEasterEggSettings = false;

  @state() private language = localStorage.getItem("lang") || "en";
  @state() private languageList: any[] = [];
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };

  private languageMap: Record<string, any> = {
    bg,
    bn,
    de,
    en,
    eo,
    es,
    fr,
    hi,
    it,
    ja,
    nl,
    pl,
    pt_br,
    ru,
    sh,
    tr,
    uk,
  };

  private async loadLanguageList() {
    const data = this.languageMap;
    const list: any[] = [];

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

    list.sort((a, b) => a.en.localeCompare(b.en));
    this.languageList = list;
  }

  private async initializeLanguage() {
    const locale = new Intl.Locale(navigator.language);
    const defaultLang = locale.language;
    const userLang = localStorage.getItem("lang") || defaultLang;

    this.defaultTranslations = await this.loadLanguage("en");
    this.translations = await this.loadLanguage(userLang);
    this.language = userLang;

    await this.loadLanguageList();
    this.applyTranslation(this.translations);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.modalEl?.isModalOpen || this.showEasterEggSettings) return;

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "evan") {
      this.triggerEasterEgg();
      this.keySequence = [];
    }
  };

  private triggerEasterEgg() {
    this.showEasterEggSettings = true;
    const popup = document.createElement("div");
    popup.className = "easter-egg-popup";
    popup.textContent = "🎉 You found a secret setting!";
    document.body.appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 5000);
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
      "setting-slider",
      "setting-number",
      "setting-number",
      "o-modal",
      "o-button",
      "o-select",
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

  private toggleEmojis(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.emojis", enabled);
  }

  private toggleLeftClickOpensMenu(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.leftClickOpensMenu", enabled);

    this.requestUpdate();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.attackRatio", ratio.toString());
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private sliderTroopRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.troopRatio", ratio.toString());
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private async loadLanguage(lang: string): Promise<any> {
    return Promise.resolve(this.languageMap[lang] || {});
  }

  private async changeLanguage(lang: string) {
    localStorage.setItem("lang", lang);
    this.language = lang;
    this.translations = await this.loadLanguage(lang);
    this.applyTranslation(this.translations);
  }

  public toggleDarkMode(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;

    if (typeof enabled !== "boolean") {
      console.warn("Unexpected toggle event payload", e);
      return;
    }

    this.userSettings.set("settings.darkMode", enabled);

    if (enabled) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
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

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadLanguageList();
    this.initializeLanguage();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
    document.body.style.overflow = "auto";
  }

  render() {
    return html`
      <o-modal title="User Settings">
        <div class="container">
          <o-select
            id="lang-selector"
            label="Language"
            translationKey="select_lang.title"
            .items=${this.languageList.map((l) => ({
              label: `${l.native} (${l.en})`,
              value: l.code,
              image: `/flags/${l.svg}.svg`,
            }))}
            .selectedValue=${this.language}
            .showImageWithLabel=${true}
            @o-select-change=${(e: CustomEvent) =>
              this.changeLanguage(e.detail)}
          ></o-select>

          <setting-toggle
            label="🌙 Dark Mode"
            description="Toggle the site’s appearance between light and dark themes"
            id="dark-mode-toggle"
            .checked=${this.userSettings.darkMode()}
            @change=${(e: CustomEvent<{ checked: boolean }>) =>
              this.toggleDarkMode(e)}
          ></setting-toggle>

          <setting-toggle
            label="😊 Emojis"
            description="Toggle whether emojis are shown in game"
            id="emoji-toggle"
            .checked=${this.userSettings.emojis()}
            @change=${this.toggleEmojis}
          ></setting-toggle>

          <setting-toggle
            label="🖱️ Left Click to Open Menu"
            description="When ON, left-click opens menu and sword button attacks. When OFF, right-click attacks directly."
            id="left-click-toggle"
            .checked=${this.userSettings.leftClickOpensMenu()}
            @change=${this.toggleLeftClickOpensMenu}
          ></setting-toggle>

          <setting-slider
            label="⚔️ Attack Ratio"
            description="What percentage of your troops to send in an attack (1–100%)"
            min="1"
            max="100"
            .value=${Number(
              localStorage.getItem("settings.attackRatio") ?? "0.2",
            ) * 100}
            @change=${this.sliderAttackRatio}
          ></setting-slider>

          <setting-slider
            label="🪖🛠️ Troops and Workers Ratio"
            description="Adjust the balance between troops (for combat) and workers (for gold production) (1–100%)"
            min="1"
            max="100"
            .value=${Number(
              localStorage.getItem("settings.troopRatio") ?? "0.95",
            ) * 100}
            @change=${this.sliderTroopRatio}
          ></setting-slider>

          ${this.showEasterEggSettings
            ? html`
                <setting-slider
                  label="Writing Speed Multiplier"
                  description="Adjust how fast you pretend to code (x1–x100)"
                  min="0"
                  max="100"
                  value="40"
                  easter="true"
                  @change=${(e: CustomEvent) => {
                    const value = e.detail?.value;
                    if (typeof value === "undefined") {
                      console.warn("Slider event missing detail.value", e);
                    }
                  }}
                ></setting-slider>

                <setting-number
                  label="Bug Count"
                  description="How many bugs you're okay with (0–1000, emotionally)"
                  value="100"
                  min="0"
                  max="1000"
                  easter="true"
                  @change=${(e: CustomEvent) => {
                    const value = e.detail?.value;
                    if (typeof value === "undefined") {
                      console.warn("Slider event missing detail.value", e);
                    }
                  }}
                ></setting-number>
              `
            : null}
        </div>
      </o-modal>
    `;
  }
}
