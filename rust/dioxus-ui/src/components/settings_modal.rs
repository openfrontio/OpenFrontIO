//! Full Settings Modal component
//!
//! A complete settings modal matching the Lit implementation, with:
//! - 2 volume sliders (background music, sound effects)
//! - 10 toggle buttons (terrain, emojis, dark mode, etc.)
//! - Exit game button
//! - Full i18n support via passed translations

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the settings modal web component
pub fn register() {
    log::debug!("Registered <game-settings-modal> component");
}

/// Settings state received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsState {
    pub background_music_volume: f32,
    pub sound_effects_volume: f32,
    pub alternate_view: bool,
    pub emojis: bool,
    pub dark_mode: bool,
    pub fx_layer: bool,
    pub alert_frame: bool,
    pub structure_sprites: bool,
    pub cursor_cost_label: bool,
    pub anonymous_names: bool,
    pub left_click_opens_menu: bool,
    pub performance_overlay: bool,
}

/// Translations received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Translations {
    pub title: String,
    pub background_music_volume: String,
    pub sound_effects_volume: String,
    pub toggle_terrain: String,
    pub toggle_terrain_desc: String,
    pub emojis: String,
    pub emojis_desc: String,
    pub dark_mode: String,
    pub dark_mode_desc: String,
    pub special_effects: String,
    pub special_effects_desc: String,
    pub alert_frame: String,
    pub alert_frame_desc: String,
    pub structure_sprites: String,
    pub structure_sprites_desc: String,
    pub cursor_cost_label: String,
    pub cursor_cost_label_desc: String,
    pub anonymous_names: String,
    pub anonymous_names_desc: String,
    pub left_click_menu: String,
    pub left_click_menu_desc: String,
    pub performance_overlay: String,
    pub performance_overlay_desc: String,
    pub exit_game: String,
    pub exit_game_desc: String,
    pub on: String,
    pub off: String,
}

/// Icons received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Icons {
    pub settings: String,
    pub music: String,
    pub tree: String,
    pub emoji: String,
    #[serde(rename = "darkMode")]
    pub dark_mode: String,
    pub explosion: String,
    pub siren: String,
    pub structure: String,
    #[serde(rename = "cursorPrice")]
    pub cursor_price: String,
    pub ninja: String,
    pub mouse: String,
    pub exit: String,
}

/// Game settings structure (legacy - kept for compatibility)
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GameSettings {
    pub sound_enabled: bool,
    pub music_volume: f32,
    pub sfx_volume: f32,
    pub show_fps: bool,
    pub graphics_quality: GraphicsQuality,
    pub language: String,
}

impl Default for GameSettings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            music_volume: 0.7,
            sfx_volume: 0.8,
            show_fps: false,
            graphics_quality: GraphicsQuality::High,
            language: "en".to_string(),
        }
    }
}

/// Graphics quality levels
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum GraphicsQuality {
    Low,
    Medium,
    High,
    Ultra,
}

impl GraphicsQuality {
    pub fn as_str(&self) -> &'static str {
        match self {
            GraphicsQuality::Low => "low",
            GraphicsQuality::Medium => "medium",
            GraphicsQuality::High => "high",
            GraphicsQuality::Ultra => "ultra",
        }
    }
}

/// Settings modal props (legacy - kept for compatibility)
#[derive(Props, Clone, PartialEq)]
pub struct SettingsModalProps {
    #[props(default = false)]
    pub open: bool,
    #[props(default = "{}".to_string())]
    pub initial_settings: String,
}

/// Settings Modal component (legacy version)
#[component]
pub fn SettingsModal(props: SettingsModalProps) -> Element {
    let initial: GameSettings = serde_json::from_str(&props.initial_settings).unwrap_or_default();

    let mut is_open = use_signal(|| props.open);
    let mut settings = use_signal(|| initial);

    let on_close = move |_| {
        is_open.set(false);
        emit_event("modal-closed", JsValue::NULL);
    };

    let on_sound_toggle = move |_| {
        settings.write().sound_enabled = !settings().sound_enabled;
        emit_settings_changed(&settings());
    };

    let on_fps_toggle = move |_| {
        settings.write().show_fps = !settings().show_fps;
        emit_settings_changed(&settings());
    };

    if !is_open() {
        return rsx! {};
    }

    rsx! {
        div {
            class: "settings-modal-backdrop",
            style: "position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;",
            onclick: on_close,

            div {
                class: "settings-modal-content",
                style: "background: #1a1a2e; border-radius: 12px; padding: 24px; min-width: 400px; max-width: 90vw; max-height: 90vh; overflow-y: auto; color: #fff; font-family: system-ui, -apple-system, sans-serif;",
                onclick: move |e| e.stop_propagation(),

                div {
                    style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;",
                    h2 { style: "margin: 0; font-size: 24px;", "Settings" }
                    button {
                        onclick: on_close,
                        style: "background: transparent; border: none; color: #888; font-size: 24px; cursor: pointer; padding: 4px 8px;",
                        "×"
                    }
                }

                section {
                    style: "margin-bottom: 24px;",
                    h3 { style: "margin: 0 0 16px 0; font-size: 16px; color: #888; text-transform: uppercase;", "Audio" }
                    SettingToggle {
                        label: "Sound Enabled".to_string(),
                        checked: settings().sound_enabled,
                        on_change: on_sound_toggle,
                    }
                }

                section {
                    style: "margin-bottom: 24px;",
                    h3 { style: "margin: 0 0 16px 0; font-size: 16px; color: #888; text-transform: uppercase;", "Display" }
                    SettingToggle {
                        label: "Show FPS".to_string(),
                        checked: settings().show_fps,
                        on_change: on_fps_toggle,
                    }
                    div {
                        style: "display: flex; justify-content: space-between; align-items: center; padding: 12px 0;",
                        span { "Graphics Quality" }
                        span { style: "color: #4ade80;", "{settings().graphics_quality.as_str()}" }
                    }
                }

                div {
                    style: "display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #333;",
                    button {
                        onclick: on_close,
                        style: "padding: 10px 20px; background: #4ade80; color: #000; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;",
                        "Done"
                    }
                }
            }
        }
    }
}

/// Toggle setting component
#[component]
fn SettingToggle(label: String, checked: bool, on_change: EventHandler<()>) -> Element {
    let bg_color = if checked { "#4ade80" } else { "#444" };
    let knob_left = if checked { "26px" } else { "2px" };

    let button_style = format!(
        "width: 48px; height: 24px; border-radius: 12px; border: none; cursor: pointer; position: relative; transition: background 0.2s; background: {};",
        bg_color
    );

    let knob_style = format!(
        "position: absolute; top: 2px; left: {}; width: 20px; height: 20px; background: white; border-radius: 50%; transition: left 0.2s;",
        knob_left
    );

    rsx! {
        div {
            style: "display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #333;",
            span { "{label}" }
            button {
                onclick: move |_| on_change.call(()),
                style: "{button_style}",
                span { style: "{knob_style}" }
            }
        }
    }
}

/// Emit settings changed event
fn emit_settings_changed(settings: &GameSettings) {
    if let Ok(js_value) = serde_wasm_bindgen::to_value(settings) {
        emit_event("settings-changed", js_value);
    }
}

/// Emit a custom event
fn emit_event(name: &str, detail: JsValue) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&detail);
            init.set_bubbles(true);
            init.set_composed(true);

            if let Ok(event) = CustomEvent::new_with_event_init_dict(name, &init) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

/// Emit a setting change event
fn emit_setting_change(setting: &str, value: JsValue) {
    let value_json = serde_wasm_bindgen::from_value::<Value>(value).unwrap_or(Value::Null);
    emit_ui_event(
        event_name(event_keys::UI_INGAME_SETTINGS_MODAL_SETTING_CHANGE),
        Some("component.settings-modal"),
        json!({
            "setting": setting,
            "value": value_json,
        }),
    );
}

/// Emit modal close event
fn emit_modal_close() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_SETTINGS_MODAL_CLOSE_REQUEST),
        Some("component.settings-modal"),
        json!({}),
    );
}

// ============================================================================
// FULL SETTINGS MODAL (Matching Lit implementation)
// ============================================================================

/// Full settings modal props
#[derive(Props, Clone, PartialEq)]
pub struct FullSettingsModalProps {
    pub settings: SettingsState,
    pub translations: Translations,
    pub icons: Icons,
}

/// Full Settings Modal component that matches the Lit implementation
///
/// This component now supports both Context API and props-based usage.
/// When used with SettingsProvider, it reads from the context.
/// Otherwise, it falls back to using the provided props.
#[component]
pub fn FullSettingsModal(props: FullSettingsModalProps) -> Element {
    // Try to get the context first (preferred way)
    let has_context = try_use_context::<crate::contexts::SettingsContext>().is_some();

    if has_context {
        let context = use_context::<crate::contexts::SettingsContext>();
        render_full_settings_modal_with_context(context)
    } else {
        // Fallback: render with props (for standalone usage without context)
        render_full_settings_modal_with_props(props)
    }
}

/// Render the full settings modal using context state
fn render_full_settings_modal_with_context(context: crate::contexts::SettingsContext) -> Element {
    let mut settings = context.settings;
    let translations = context.translations;
    let icons = context.icons;

    // Close handler
    let on_close = move |_| {
        emit_modal_close();
    };

    // Volume handlers
    let on_bgm_volume_change = {
        move |evt: FormEvent| {
            if let Ok(value) = evt.value().parse::<f32>() {
                let volume = value / 100.0;
                settings.write().background_music_volume = volume;
                emit_setting_change("backgroundMusicVolume", JsValue::from_f64(volume as f64));
            }
        }
    };

    let on_sfx_volume_change = {
        move |evt: FormEvent| {
            if let Ok(value) = evt.value().parse::<f32>() {
                let volume = value / 100.0;
                settings.write().sound_effects_volume = volume;
                emit_setting_change("soundEffectsVolume", JsValue::from_f64(volume as f64));
            }
        }
    };

    // Toggle handlers
    let toggle_alternate_view = {
        move |_| {
            let new_value = !settings().alternate_view;
            settings.write().alternate_view = new_value;
            emit_setting_change("alternateView", JsValue::from_bool(new_value));
        }
    };

    let toggle_emojis = {
        move |_| {
            let new_value = !settings().emojis;
            settings.write().emojis = new_value;
            emit_setting_change("emojis", JsValue::from_bool(new_value));
        }
    };

    let toggle_dark_mode = {
        move |_| {
            let new_value = !settings().dark_mode;
            settings.write().dark_mode = new_value;
            emit_setting_change("darkMode", JsValue::from_bool(new_value));
        }
    };

    let toggle_fx_layer = {
        move |_| {
            let new_value = !settings().fx_layer;
            settings.write().fx_layer = new_value;
            emit_setting_change("fxLayer", JsValue::from_bool(new_value));
        }
    };

    let toggle_alert_frame = {
        move |_| {
            let new_value = !settings().alert_frame;
            settings.write().alert_frame = new_value;
            emit_setting_change("alertFrame", JsValue::from_bool(new_value));
        }
    };

    let toggle_structure_sprites = {
        move |_| {
            let new_value = !settings().structure_sprites;
            settings.write().structure_sprites = new_value;
            emit_setting_change("structureSprites", JsValue::from_bool(new_value));
        }
    };

    let toggle_cursor_cost_label = {
        move |_| {
            let new_value = !settings().cursor_cost_label;
            settings.write().cursor_cost_label = new_value;
            emit_setting_change("cursorCostLabel", JsValue::from_bool(new_value));
        }
    };

    let toggle_anonymous_names = {
        move |_| {
            let new_value = !settings().anonymous_names;
            settings.write().anonymous_names = new_value;
            emit_setting_change("anonymousNames", JsValue::from_bool(new_value));
        }
    };

    let toggle_left_click_menu = {
        move |_| {
            let new_value = !settings().left_click_opens_menu;
            settings.write().left_click_opens_menu = new_value;
            emit_setting_change("leftClickOpensMenu", JsValue::from_bool(new_value));
        }
    };

    let toggle_performance_overlay = {
        move |_| {
            let new_value = !settings().performance_overlay;
            settings.write().performance_overlay = new_value;
            emit_setting_change("performanceOverlay", JsValue::from_bool(new_value));
        }
    };

    let on_exit = move |_| {
        emit_setting_change("exitGame", JsValue::TRUE);
    };

    // Helper for on/off text
    let on_off = |is_on: bool| -> String {
        if is_on {
            translations().on.clone()
        } else {
            translations().off.clone()
        }
    };

    rsx! {
        div {
            class: "bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto",
            onclick: move |e| e.stop_propagation(),

            // Header
            div {
                class: "flex items-center justify-between p-4 border-b border-slate-600",

                div {
                    class: "flex items-center gap-2",
                    img {
                        src: "{icons().settings}",
                        alt: "settings",
                        width: "24",
                        height: "24",
                        class: "align-middle"
                    }
                    h2 {
                        class: "text-xl font-semibold text-white",
                        "{translations().title}"
                    }
                }

                button {
                    class: "text-slate-400 hover:text-white text-2xl font-bold leading-none",
                    onclick: on_close,
                    "×"
                }
            }

            // Content
            div {
                class: "p-4 flex flex-col gap-3",

                // Background Music Volume
                VolumeSlider {
                    icon: icons().music.clone(),
                    label: translations().background_music_volume.clone(),
                    value: settings().background_music_volume,
                    on_change: on_bgm_volume_change
                }

                // Sound Effects Volume
                VolumeSlider {
                    icon: icons().music.clone(),
                    label: translations().sound_effects_volume.clone(),
                    value: settings().sound_effects_volume,
                    on_change: on_sfx_volume_change
                }

                // Toggle: Terrain
                SettingButton {
                    icon: icons().tree.clone(),
                    label: translations().toggle_terrain.clone(),
                    description: translations().toggle_terrain_desc.clone(),
                    status: on_off(settings().alternate_view),
                    on_click: toggle_alternate_view
                }

                // Toggle: Emojis
                SettingButton {
                    icon: icons().emoji.clone(),
                    label: translations().emojis.clone(),
                    description: translations().emojis_desc.clone(),
                    status: on_off(settings().emojis),
                    on_click: toggle_emojis
                }

                // Toggle: Dark Mode
                SettingButton {
                    icon: icons().dark_mode.clone(),
                    label: translations().dark_mode.clone(),
                    description: translations().dark_mode_desc.clone(),
                    status: on_off(settings().dark_mode),
                    on_click: toggle_dark_mode
                }

                // Toggle: Special Effects
                SettingButton {
                    icon: icons().explosion.clone(),
                    label: translations().special_effects.clone(),
                    description: translations().special_effects_desc.clone(),
                    status: on_off(settings().fx_layer),
                    on_click: toggle_fx_layer
                }

                // Toggle: Alert Frame
                SettingButton {
                    icon: icons().siren.clone(),
                    label: translations().alert_frame.clone(),
                    description: translations().alert_frame_desc.clone(),
                    status: on_off(settings().alert_frame),
                    on_click: toggle_alert_frame
                }

                // Toggle: Structure Sprites
                SettingButton {
                    icon: icons().structure.clone(),
                    label: translations().structure_sprites.clone(),
                    description: translations().structure_sprites_desc.clone(),
                    status: on_off(settings().structure_sprites),
                    on_click: toggle_structure_sprites
                }

                // Toggle: Cursor Cost Label
                SettingButton {
                    icon: icons().cursor_price.clone(),
                    label: translations().cursor_cost_label.clone(),
                    description: translations().cursor_cost_label_desc.clone(),
                    status: on_off(settings().cursor_cost_label),
                    on_click: toggle_cursor_cost_label
                }

                // Toggle: Anonymous Names
                SettingButton {
                    icon: icons().ninja.clone(),
                    label: translations().anonymous_names.clone(),
                    description: translations().anonymous_names_desc.clone(),
                    status: on_off(settings().anonymous_names),
                    on_click: toggle_anonymous_names
                }

                // Toggle: Left Click Menu
                SettingButton {
                    icon: icons().mouse.clone(),
                    label: translations().left_click_menu.clone(),
                    description: translations().left_click_menu_desc.clone(),
                    status: on_off(settings().left_click_opens_menu),
                    on_click: toggle_left_click_menu
                }

                // Toggle: Performance Overlay
                SettingButton {
                    icon: icons().settings.clone(),
                    label: translations().performance_overlay.clone(),
                    description: translations().performance_overlay_desc.clone(),
                    status: on_off(settings().performance_overlay),
                    on_click: toggle_performance_overlay
                }

                // Exit Game section
                div {
                    class: "border-t border-slate-600 pt-3 mt-4",
                    button {
                        class: "flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors",
                        onclick: on_exit,

                        img {
                            src: "{icons().exit}",
                            alt: "exit",
                            width: "20",
                            height: "20"
                        }

                        div {
                            class: "flex-1",
                            div { class: "font-medium", "{translations().exit_game}" }
                            div { class: "text-sm text-slate-400", "{translations().exit_game_desc}" }
                        }
                    }
                }
            }
        }
    }
}

/// Render the full settings modal using props (fallback for non-context usage)
fn render_full_settings_modal_with_props(props: FullSettingsModalProps) -> Element {
    let mut settings = use_signal(|| props.settings.clone());
    let translations = props.translations.clone();
    let icons = props.icons.clone();

    // Store the settings signal for external updates
    SETTINGS_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(settings);
    });

    // Close handler
    let on_close = move |_| {
        emit_modal_close();
    };

    // Volume handlers
    let on_bgm_volume_change = {
        move |evt: FormEvent| {
            if let Ok(value) = evt.value().parse::<f32>() {
                let volume = value / 100.0;
                settings.write().background_music_volume = volume;
                emit_setting_change("backgroundMusicVolume", JsValue::from_f64(volume as f64));
            }
        }
    };

    let on_sfx_volume_change = {
        move |evt: FormEvent| {
            if let Ok(value) = evt.value().parse::<f32>() {
                let volume = value / 100.0;
                settings.write().sound_effects_volume = volume;
                emit_setting_change("soundEffectsVolume", JsValue::from_f64(volume as f64));
            }
        }
    };

    // Toggle handlers
    let toggle_alternate_view = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().alternate_view;
            settings.write().alternate_view = new_value;
            emit_setting_change("alternateView", JsValue::from_bool(new_value));
        }
    };

    let toggle_emojis = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().emojis;
            settings.write().emojis = new_value;
            emit_setting_change("emojis", JsValue::from_bool(new_value));
        }
    };

    let toggle_dark_mode = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().dark_mode;
            settings.write().dark_mode = new_value;
            emit_setting_change("darkMode", JsValue::from_bool(new_value));
        }
    };

    let toggle_fx_layer = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().fx_layer;
            settings.write().fx_layer = new_value;
            emit_setting_change("fxLayer", JsValue::from_bool(new_value));
        }
    };

    let toggle_alert_frame = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().alert_frame;
            settings.write().alert_frame = new_value;
            emit_setting_change("alertFrame", JsValue::from_bool(new_value));
        }
    };

    let toggle_structure_sprites = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().structure_sprites;
            settings.write().structure_sprites = new_value;
            emit_setting_change("structureSprites", JsValue::from_bool(new_value));
        }
    };

    let toggle_cursor_cost_label = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().cursor_cost_label;
            settings.write().cursor_cost_label = new_value;
            emit_setting_change("cursorCostLabel", JsValue::from_bool(new_value));
        }
    };

    let toggle_anonymous_names = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().anonymous_names;
            settings.write().anonymous_names = new_value;
            emit_setting_change("anonymousNames", JsValue::from_bool(new_value));
        }
    };

    let toggle_left_click_menu = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().left_click_opens_menu;
            settings.write().left_click_opens_menu = new_value;
            emit_setting_change("leftClickOpensMenu", JsValue::from_bool(new_value));
        }
    };

    let toggle_performance_overlay = {
        let mut settings = settings.clone();
        move |_| {
            let new_value = !settings().performance_overlay;
            settings.write().performance_overlay = new_value;
            emit_setting_change("performanceOverlay", JsValue::from_bool(new_value));
        }
    };

    let on_exit = move |_| {
        emit_setting_change("exitGame", JsValue::TRUE);
    };

    // Helper for on/off text
    let on_off = |is_on: bool| -> String {
        if is_on {
            translations.on.clone()
        } else {
            translations.off.clone()
        }
    };

    rsx! {
        div {
            class: "bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto",
            onclick: move |e| e.stop_propagation(),

            // Header
            div {
                class: "flex items-center justify-between p-4 border-b border-slate-600",

                div {
                    class: "flex items-center gap-2",
                    img {
                        src: "{icons.settings}",
                        alt: "settings",
                        width: "24",
                        height: "24",
                        class: "align-middle"
                    }
                    h2 {
                        class: "text-xl font-semibold text-white",
                        "{translations.title}"
                    }
                }

                button {
                    class: "text-slate-400 hover:text-white text-2xl font-bold leading-none",
                    onclick: on_close,
                    "×"
                }
            }

            // Content
            div {
                class: "p-4 flex flex-col gap-3",

                // Background Music Volume
                VolumeSlider {
                    icon: icons.music.clone(),
                    label: translations.background_music_volume.clone(),
                    value: settings().background_music_volume,
                    on_change: on_bgm_volume_change
                }

                // Sound Effects Volume
                VolumeSlider {
                    icon: icons.music.clone(),
                    label: translations.sound_effects_volume.clone(),
                    value: settings().sound_effects_volume,
                    on_change: on_sfx_volume_change
                }

                // Toggle: Terrain
                SettingButton {
                    icon: icons.tree.clone(),
                    label: translations.toggle_terrain.clone(),
                    description: translations.toggle_terrain_desc.clone(),
                    status: on_off(settings().alternate_view),
                    on_click: toggle_alternate_view
                }

                // Toggle: Emojis
                SettingButton {
                    icon: icons.emoji.clone(),
                    label: translations.emojis.clone(),
                    description: translations.emojis_desc.clone(),
                    status: on_off(settings().emojis),
                    on_click: toggle_emojis
                }

                // Toggle: Dark Mode
                SettingButton {
                    icon: icons.dark_mode.clone(),
                    label: translations.dark_mode.clone(),
                    description: translations.dark_mode_desc.clone(),
                    status: on_off(settings().dark_mode),
                    on_click: toggle_dark_mode
                }

                // Toggle: Special Effects
                SettingButton {
                    icon: icons.explosion.clone(),
                    label: translations.special_effects.clone(),
                    description: translations.special_effects_desc.clone(),
                    status: on_off(settings().fx_layer),
                    on_click: toggle_fx_layer
                }

                // Toggle: Alert Frame
                SettingButton {
                    icon: icons.siren.clone(),
                    label: translations.alert_frame.clone(),
                    description: translations.alert_frame_desc.clone(),
                    status: on_off(settings().alert_frame),
                    on_click: toggle_alert_frame
                }

                // Toggle: Structure Sprites
                SettingButton {
                    icon: icons.structure.clone(),
                    label: translations.structure_sprites.clone(),
                    description: translations.structure_sprites_desc.clone(),
                    status: on_off(settings().structure_sprites),
                    on_click: toggle_structure_sprites
                }

                // Toggle: Cursor Cost Label
                SettingButton {
                    icon: icons.cursor_price.clone(),
                    label: translations.cursor_cost_label.clone(),
                    description: translations.cursor_cost_label_desc.clone(),
                    status: on_off(settings().cursor_cost_label),
                    on_click: toggle_cursor_cost_label
                }

                // Toggle: Anonymous Names
                SettingButton {
                    icon: icons.ninja.clone(),
                    label: translations.anonymous_names.clone(),
                    description: translations.anonymous_names_desc.clone(),
                    status: on_off(settings().anonymous_names),
                    on_click: toggle_anonymous_names
                }

                // Toggle: Left Click Menu
                SettingButton {
                    icon: icons.mouse.clone(),
                    label: translations.left_click_menu.clone(),
                    description: translations.left_click_menu_desc.clone(),
                    status: on_off(settings().left_click_opens_menu),
                    on_click: toggle_left_click_menu
                }

                // Toggle: Performance Overlay
                SettingButton {
                    icon: icons.settings.clone(),
                    label: translations.performance_overlay.clone(),
                    description: translations.performance_overlay_desc.clone(),
                    status: on_off(settings().performance_overlay),
                    on_click: toggle_performance_overlay
                }

                // Exit Game section
                div {
                    class: "border-t border-slate-600 pt-3 mt-4",
                    button {
                        class: "flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors",
                        onclick: on_exit,

                        img {
                            src: "{icons.exit}",
                            alt: "exit",
                            width: "20",
                            height: "20"
                        }

                        div {
                            class: "flex-1",
                            div { class: "font-medium", "{translations.exit_game}" }
                            div { class: "text-sm text-slate-400", "{translations.exit_game_desc}" }
                        }
                    }
                }
            }
        }
    }
}

/// Volume slider component
#[component]
fn VolumeSlider(
    icon: String,
    label: String,
    value: f32,
    on_change: EventHandler<FormEvent>,
) -> Element {
    let display_value = (value * 100.0).round() as i32;

    rsx! {
        div {
            class: "flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors",

            img {
                src: "{icon}",
                alt: "icon",
                width: "20",
                height: "20"
            }

            div {
                class: "flex-1",
                div { class: "font-medium", "{label}" }
                input {
                    r#type: "range",
                    min: "0",
                    max: "100",
                    value: "{display_value}",
                    oninput: move |evt| on_change.call(evt),
                    class: "w-full border border-slate-500 rounded-lg"
                }
            }

            div {
                class: "text-sm text-slate-400",
                "{display_value}%"
            }
        }
    }
}

/// Setting button component (for toggles)
#[component]
fn SettingButton(
    icon: String,
    label: String,
    description: String,
    status: String,
    on_click: EventHandler<()>,
) -> Element {
    rsx! {
        button {
            class: "flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors",
            onclick: move |_| on_click.call(()),

            img {
                src: "{icon}",
                alt: "icon",
                width: "20",
                height: "20"
            }

            div {
                class: "flex-1",
                div { class: "font-medium", "{label}" }
                div { class: "text-sm text-slate-400", "{description}" }
            }

            div {
                class: "text-sm text-slate-400",
                "{status}"
            }
        }
    }
}

// ============================================================================
// WASM EXPORTS AND THREAD-LOCAL STORAGE FOR INITIALIZATION
// ============================================================================

/// Thread-local storage for initial state passing from launch_full_settings_modal
/// This is only used to pass data from the WASM launch function to the root component
thread_local! {
    static INITIAL_STATE: RefCell<Option<(SettingsState, Translations, Icons)>> =
        const { RefCell::new(None) };
    static SETTINGS_SIGNAL: RefCell<Option<Signal<SettingsState>>> =
        const { RefCell::new(None) };
}

/// Store initial state for the settings modal (used by launch_full_settings_modal)
pub fn set_initial_state(settings: SettingsState, translations: Translations, icons: Icons) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((settings, translations, icons));
    });
}

/// Take the initial state (used by SettingsRoot)
pub fn take_initial_state() -> (SettingsState, Translations, Icons) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                SettingsState::default(),
                Translations::default(),
                Icons::default(),
            )
        })
    })
}

/// Store the settings signal for external WASM updates
pub fn store_settings_signal(signal: Signal<SettingsState>) {
    SETTINGS_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

/// Export for provider to use
pub use store_settings_signal as settings_store_settings_signal;
pub use take_initial_state as settings_take_initial_state;

/// Launch the SettingsModal component (legacy)
#[wasm_bindgen]
pub fn launch_settings_modal() {
    let config = dioxus::web::Config::new().rootname("dioxus-settings-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(legacy_settings_modal_root);
}

fn legacy_settings_modal_root() -> Element {
    rsx! {
        SettingsModal {
            open: true,
            initial_settings: "{}".to_string(),
        }
    }
}

/// Launch the full settings modal with provided configuration
///
/// This function is called from TypeScript to initialize and launch the settings modal.
/// It stores the initial state in thread-local storage for the root component to consume.
pub fn launch_full_settings_modal(settings_json: &str, translations_json: &str, icons_json: &str) {
    let settings: SettingsState = serde_json::from_str(settings_json).unwrap_or_default();
    let translations: Translations = serde_json::from_str(translations_json).unwrap_or_default();
    let icons: Icons = serde_json::from_str(icons_json).unwrap_or_default();

    log::info!("Launching full settings modal");
    log::debug!("Settings: {:?}", settings);

    // Store initial state in thread-local storage for SettingsRoot to consume
    set_initial_state(settings, translations, icons);

    let config = dioxus::web::Config::new().rootname("dioxus-settings-modal-root");

    // Launch the root component which will create the provider and context
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(crate::providers::SettingsRoot);
}
