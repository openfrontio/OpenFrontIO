import { html } from "lit";
import type { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import "../baseComponents/setting/SettingSlider";

/** Use the same preference and live CSS value in the settings page and HUD panel. */
export function hudOpacitySetting(settings: UserSettings) {
  return html`
    <setting-slider
      label=${translateText("user_setting.hud_opacity_label")}
      description=${translateText("user_setting.hud_opacity_desc")}
      id="hud-opacity-slider"
      .value=${settings.hudOpacity() * 100}
      @change=${(event: CustomEvent<{ value: number }>) => {
        const value = event.detail?.value;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          console.warn("Slider event missing finite detail.value");
          return;
        }
        settings.setHudOpacity(value / 100);
        document.documentElement.style.setProperty(
          "--hud-opacity",
          String(settings.hudOpacity()),
        );
      }}
    ></setting-slider>
  `;
}
