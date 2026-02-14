//! User Setting Modal component
//!
//! A modal for user preferences and keybind configuration:
//! - Basic settings tab: toggles, sliders, flag selector
//! - Keybinds tab: rebindable keyboard shortcuts
//! - Easter egg settings (hidden)
//! All settings persistence and input validation logic stays in TypeScript.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the user setting modal component
pub fn register() {
    log::debug!("Registered <user-setting-modal> component");
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserSettingState {
    pub is_visible: bool,
    pub active_tab: String, // "basic" or "keybinds"
    pub show_easter_egg: bool,
    pub toggles: Vec<ToggleSetting>,
    pub sliders: Vec<SliderSetting>,
    pub keybinds: Vec<KeybindSetting>,
    pub keybind_sections: Vec<KeybindSection>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToggleSetting {
    pub id: String,
    pub label: String,
    pub description: String,
    pub checked: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SliderSetting {
    pub id: String,
    pub label: String,
    pub description: String,
    pub min: f64,
    pub max: f64,
    pub value: f64,
    pub is_easter: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeybindSetting {
    pub action: String,
    pub label: String,
    pub description: String,
    pub default_key: String,
    pub current_key: String,
    pub display_key: String,
    pub section: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeybindSection {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserSettingTranslations {
    pub title: String,
    pub tab_basic: String,
    pub tab_keybinds: String,
    pub flag_title: String,
    pub flag_button_title: String,
    pub back: String,
    pub press_key: String,
    pub reset: String,
    pub clear: String,
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<UserSettingState>>> =
        const { RefCell::new(None) };
    static INITIAL_STATE: RefCell<Option<(UserSettingState, UserSettingTranslations)>> =
        const { RefCell::new(None) };
}

pub fn set_initial_state(state: UserSettingState, translations: UserSettingTranslations) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((state, translations));
    });
}

pub fn take_initial_state() -> (UserSettingState, UserSettingTranslations) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                UserSettingState::default(),
                UserSettingTranslations::default(),
            )
        })
    })
}

pub fn store_state_signal(signal: Signal<UserSettingState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub use store_state_signal as user_setting_store_state_signal;
pub use take_initial_state as user_setting_take_initial_state;

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

fn emit_close() {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-user-setting-close", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_tab_change(tab: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from_str(tab));
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-user-setting-tab", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_toggle_change(id: &str, checked: bool) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &"id".into(), &JsValue::from_str(id));
            let _ = js_sys::Reflect::set(&obj, &"checked".into(), &JsValue::from_bool(checked));

            let init = CustomEventInit::new();
            init.set_detail(&obj);
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-user-setting-toggle", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_slider_change(id: &str, value: f64) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &"id".into(), &JsValue::from_str(id));
            let _ = js_sys::Reflect::set(&obj, &"value".into(), &JsValue::from_f64(value));

            let init = CustomEventInit::new();
            init.set_detail(&obj);
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-user-setting-slider", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_keybind_change(action: &str, value: &str, key: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &"action".into(), &JsValue::from_str(action));
            let _ = js_sys::Reflect::set(&obj, &"value".into(), &JsValue::from_str(value));
            let _ = js_sys::Reflect::set(&obj, &"key".into(), &JsValue::from_str(key));

            let init = CustomEventInit::new();
            init.set_detail(&obj);
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-user-setting-keybind", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_open_flag_selector() {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-user-setting-open-flag", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/// Toggle setting row
#[component]
fn SettingToggle(toggle: ToggleSetting) -> Element {
    let id = toggle.id.clone();
    let mut checked = use_signal(|| toggle.checked);

    // Keep in sync with external state
    if checked() != toggle.checked {
        checked.set(toggle.checked);
    }

    rsx! {
        div {
            class: "flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4",
            div {
                class: "flex flex-col flex-1 min-w-0 mr-4",
                div {
                    class: "text-white font-bold text-base block mb-1",
                    "{toggle.label}"
                }
                div {
                    class: "text-white/50 text-sm leading-snug",
                    "{toggle.description}"
                }
            }
            button {
                class: if checked() {
                    "relative w-11 h-6 rounded-full bg-blue-500 transition-colors duration-200 cursor-pointer shrink-0"
                } else {
                    "relative w-11 h-6 rounded-full bg-white/20 transition-colors duration-200 cursor-pointer shrink-0"
                },
                onclick: move |_| {
                    let new_val = !checked();
                    checked.set(new_val);
                    emit_toggle_change(&id, new_val);
                },
                div {
                    class: if checked() {
                        "absolute w-5 h-5 rounded-full bg-white top-0.5 left-5.5 transition-all duration-200 shadow"
                    } else {
                        "absolute w-5 h-5 rounded-full bg-white top-0.5 left-0.5 transition-all duration-200 shadow"
                    },
                }
            }
        }
    }
}

/// Slider setting row
#[component]
fn SettingSlider(slider: SliderSetting) -> Element {
    let id = slider.id.clone();
    let mut value = use_signal(|| slider.value);

    // Keep in sync with external state
    if (value() - slider.value).abs() > 0.01 {
        value.set(slider.value);
    }

    let border_class = if slider.is_easter {
        "border-yellow-500/30 bg-yellow-500/5"
    } else {
        "border-white/10 bg-white/5"
    };

    rsx! {
        div {
            class: "flex flex-row items-center justify-between w-full p-4 {border_class} border rounded-xl hover:bg-white/10 transition-all gap-4",
            div {
                class: "flex flex-col flex-1 min-w-0 mr-4",
                div {
                    class: "text-white font-bold text-base block mb-1",
                    "{slider.label}"
                }
                div {
                    class: "text-white/50 text-sm leading-snug",
                    "{slider.description}"
                }
            }
            div {
                class: "flex items-center gap-3 shrink-0",
                input {
                    r#type: "range",
                    min: "{slider.min}",
                    max: "{slider.max}",
                    value: "{value()}",
                    class: "w-32 h-2 appearance-none bg-white/20 rounded-full cursor-pointer accent-blue-500",
                    oninput: move |e: FormEvent| {
                        if let Ok(v) = e.value().parse::<f64>() {
                            value.set(v);
                            emit_slider_change(&id, v);
                        }
                    },
                }
                span {
                    class: "text-white/60 text-sm font-mono min-w-8 text-right",
                    "{value() as i64}"
                }
            }
        }
    }
}

/// Keybind setting row
#[component]
fn SettingKeybindRow(keybind: KeybindSetting, translations: UserSettingTranslations) -> Element {
    let action = keybind.action.clone();
    let action_reset = keybind.action.clone();
    let action_clear = keybind.action.clone();
    let default_key = keybind.default_key.clone();
    let mut is_listening = use_signal(|| false);
    let mut display = use_signal(|| keybind.display_key.clone());

    // Keep in sync with external state
    if !is_listening() && display() != keybind.display_key {
        display.set(keybind.display_key.clone());
    }

    rsx! {
        div {
            class: "flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4",
            div {
                class: "flex flex-col flex-1 min-w-0 mr-4",
                div {
                    class: "text-white font-bold text-base block mb-1",
                    "{keybind.label}"
                }
                div {
                    class: "text-white/50 text-sm leading-snug",
                    "{keybind.description}"
                }
            }
            div {
                class: "flex items-center gap-2 shrink-0",
                // Key display / listen button
                button {
                    class: if is_listening() {
                        "min-w-20 px-3 py-1.5 rounded-lg text-sm font-mono bg-blue-500/30 border border-blue-500/50 text-blue-300 animate-pulse cursor-pointer"
                    } else {
                        "min-w-20 px-3 py-1.5 rounded-lg text-sm font-mono bg-white/10 border border-white/10 text-white/80 hover:bg-white/20 cursor-pointer"
                    },
                    onclick: move |_| {
                        is_listening.set(true);
                    },
                    onkeydown: move |e: KeyboardEvent| {
                        if is_listening() {
                            e.prevent_default();
                            e.stop_propagation();
                            let code = e.code().to_string();
                            let key_str = e.key().to_string();
                            is_listening.set(false);
                            display.set(key_str.clone());
                            emit_keybind_change(&action, &code, &key_str);
                        }
                    },
                    onblur: move |_| {
                        is_listening.set(false);
                    },
                    if is_listening() {
                        "{translations.press_key}"
                    } else if display().is_empty() {
                        "---"
                    } else {
                        "{display()}"
                    }
                }
                // Reset button
                button {
                    class: "px-2 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60 cursor-pointer",
                    title: "{translations.reset}",
                    onclick: move |_| {
                        display.set(default_key.clone());
                        emit_keybind_change(&action_reset, &default_key, &default_key);
                    },
                    dangerous_inner_html: "&#x21BA;",
                }
                // Clear button
                button {
                    class: "px-2 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60 cursor-pointer",
                    title: "{translations.clear}",
                    onclick: move |_| {
                        display.set(String::new());
                        emit_keybind_change(&action_clear, "Null", "");
                    },
                    dangerous_inner_html: "&#x2715;",
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct UserSettingModalProps {
    pub state: UserSettingState,
    pub translations: UserSettingTranslations,
}

#[component]
pub fn UserSettingModal(props: UserSettingModalProps) -> Element {
    let mut state = use_signal(|| props.state.clone());
    let translations = props.translations.clone();

    // Store signal for external updates
    STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(state));

    let on_close = move |_| {
        state.write().is_visible = false;
        emit_close();
    };

    if !state().is_visible {
        return rsx! { div { class: "hidden" } };
    }

    let current = state();

    rsx! {
        // Backdrop
        div {
            class: "fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4",
            onclick: on_close,

            // Modal
            div {
                class: "relative bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden text-white flex flex-col",
                onclick: move |e| e.stop_propagation(),

                // Header
                div {
                    class: "relative flex flex-col border-b border-white/10 pb-4 shrink-0",

                    // Title bar with back button
                    div {
                        class: "flex items-center justify-between p-4",
                        button {
                            class: "text-white/60 hover:text-white transition-colors",
                            aria_label: "{translations.back}",
                            onclick: on_close,
                            svg {
                                xmlns: "http://www.w3.org/2000/svg",
                                class: "h-6 w-6",
                                fill: "none",
                                view_box: "0 0 24 24",
                                stroke: "currentColor",
                                path {
                                    stroke_linecap: "round",
                                    stroke_linejoin: "round",
                                    stroke_width: "2",
                                    d: "M15 19l-7-7 7-7",
                                }
                            }
                        }
                        h2 {
                            class: "text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest",
                            "{translations.title}"
                        }
                        div { class: "w-6" }
                    }

                    // Tab buttons (only visible on md+)
                    div {
                        class: "hidden md:flex items-center gap-2 justify-center mt-4",
                        button {
                            class: if current.active_tab == "basic" {
                                "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                            } else {
                                "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 border border-transparent"
                            },
                            onclick: move |_| emit_tab_change("basic"),
                            "{translations.tab_basic}"
                        }
                        button {
                            class: if current.active_tab == "keybinds" {
                                "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                            } else {
                                "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 border border-transparent"
                            },
                            onclick: move |_| emit_tab_change("keybinds"),
                            "{translations.tab_keybinds}"
                        }
                    }
                }

                // Body
                div {
                    class: "pt-6 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent px-6 pb-6 mr-1",
                    div {
                        class: "flex flex-col gap-2",
                        if current.active_tab == "basic" {
                            {render_basic_settings(&current, &translations)}
                        } else {
                            {render_keybind_settings(&current, &translations)}
                        }
                    }
                }
            }
        }
    }
}

fn render_basic_settings(
    state: &UserSettingState,
    translations: &UserSettingTranslations,
) -> Element {
    rsx! {
        // Flag selector
        div {
            class: "flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4 cursor-pointer",
            role: "button",
            tabindex: "0",
            onclick: move |_| emit_open_flag_selector(),
            div {
                class: "flex flex-col flex-1 min-w-0 mr-4",
                div {
                    class: "text-white font-bold text-base block mb-1",
                    "{translations.flag_title}"
                }
                div {
                    class: "text-white/50 text-sm leading-snug",
                    "{translations.flag_button_title}"
                }
            }
            div {
                class: "relative inline-block w-12 h-8 shrink-0 rounded overflow-hidden border border-white/20 bg-white/10",
            }
        }

        // Toggles
        {state.toggles.iter().map(|toggle| {
            rsx! {
                SettingToggle {
                    key: "{toggle.id}",
                    toggle: toggle.clone(),
                }
            }
        })}

        // Sliders (non-easter)
        {state.sliders.iter().filter(|s| !s.is_easter).map(|slider| {
            rsx! {
                SettingSlider {
                    key: "{slider.id}",
                    slider: slider.clone(),
                }
            }
        })}

        // Easter egg sliders (only shown when unlocked)
        if state.show_easter_egg {
            {state.sliders.iter().filter(|s| s.is_easter).map(|slider| {
                rsx! {
                    SettingSlider {
                        key: "{slider.id}",
                        slider: slider.clone(),
                    }
                }
            })}
        }
    }
}

fn render_keybind_settings(
    state: &UserSettingState,
    translations: &UserSettingTranslations,
) -> Element {
    rsx! {
        {state.keybind_sections.iter().map(|section| {
            let section_keybinds: Vec<_> = state.keybinds.iter()
                .filter(|k| k.section == section.id)
                .cloned()
                .collect();
            rsx! {
                h2 {
                    key: "{section.id}",
                    class: "text-blue-200 text-xl font-bold mt-4 mb-3 border-b border-white/10 pb-2",
                    "{section.title}"
                }
                {section_keybinds.iter().map(|keybind| {
                    rsx! {
                        SettingKeybindRow {
                            key: "{keybind.action}",
                            keybind: keybind.clone(),
                            translations: translations.clone(),
                        }
                    }
                })}
            }
        })}
    }
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

pub fn launch_user_setting_modal(state_json: &str, translations_json: &str) {
    let state: UserSettingState = serde_json::from_str(state_json).unwrap_or_default();
    let translations: UserSettingTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching user setting modal");

    set_initial_state(state, translations);

    let config = dioxus::web::Config::new().rootname("dioxus-user-setting-modal-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(user_setting_root);
}

fn user_setting_root() -> Element {
    let (state, translations) = take_initial_state();
    rsx! {
        UserSettingModal {
            state: state,
            translations: translations,
        }
    }
}

pub fn show_user_setting_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = true;
        }
    });
}

pub fn hide_user_setting_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = false;
        }
    });
}

pub fn update_user_setting_modal(state_json: &str) {
    let new_state: UserSettingState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse user setting state: {}", e);
            return;
        }
    };

    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(new_state);
        }
    });
}
