//! Territory Patterns Modal component
//!
//! A modal that displays pattern and color cosmetics:
//! - Pattern grid with purchasable and owned patterns
//! - "My Skins" toggle filter
//! - Color swatch grid
//! - Tab navigation (patterns vs colors - currently disabled)
//! All cosmetics fetching and purchase logic stays in TypeScript.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the territory patterns modal component
pub fn register() {
    log::debug!("Registered <territory-patterns-modal> component");
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerritoryPatternsState {
    pub is_visible: bool,
    pub active_tab: String, // "patterns" or "colors"
    pub show_only_owned: bool,
    pub is_logged_in: bool,
    pub patterns: Vec<PatternButtonData>,
    pub colors: Vec<String>, // hex codes
    pub selected_pattern_name: Option<String>,
    pub selected_color: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PatternButtonData {
    pub id: String,
    pub name: Option<String>,
    pub color_palette_name: Option<String>,
    pub preview_url: Option<String>,
    pub primary_color: Option<String>,
    pub secondary_color: Option<String>,
    pub requires_purchase: bool,
    pub is_selected: bool,
    pub is_default: bool,
    pub price: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerritoryPatternsTranslations {
    pub title: String,
    pub colors: String,
    pub not_logged_in: String,
    pub show_only_owned: String,
    pub all_owned: String,
    pub pattern_default: String,
    pub back: String,
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<TerritoryPatternsState>>> =
        const { RefCell::new(None) };
    static INITIAL_STATE: RefCell<Option<(TerritoryPatternsState, TerritoryPatternsTranslations)>> =
        const { RefCell::new(None) };
}

pub fn set_initial_state(
    state: TerritoryPatternsState,
    translations: TerritoryPatternsTranslations,
) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((state, translations));
    });
}

pub fn take_initial_state() -> (TerritoryPatternsState, TerritoryPatternsTranslations) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                TerritoryPatternsState::default(),
                TerritoryPatternsTranslations::default(),
            )
        })
    })
}

pub fn store_state_signal(signal: Signal<TerritoryPatternsState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub use store_state_signal as territory_patterns_store_state_signal;
pub use take_initial_state as territory_patterns_take_initial_state;

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
                CustomEvent::new_with_event_init_dict("dioxus-territory-patterns-close", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_select_pattern(pattern_id: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from_str(pattern_id));
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-territory-patterns-select", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_purchase_pattern(pattern_id: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from_str(pattern_id));
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-territory-patterns-purchase", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_select_color(hex: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from_str(hex));
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) = CustomEvent::new_with_event_init_dict(
                "dioxus-territory-patterns-select-color",
                &init,
            ) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_toggle_owned() {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) = CustomEvent::new_with_event_init_dict(
                "dioxus-territory-patterns-toggle-owned",
                &init,
            ) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct TerritoryPatternsModalProps {
    pub state: TerritoryPatternsState,
    pub translations: TerritoryPatternsTranslations,
}

#[component]
pub fn TerritoryPatternsModal(props: TerritoryPatternsModalProps) -> Element {
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
                class: "relative bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 max-w-3xl w-full max-h-[90vh] overflow-hidden text-white",
                onclick: move |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center justify-between p-4 border-b border-white/10",
                    div {
                        class: "flex items-center gap-2",
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
                    }
                    if !current.is_logged_in {
                        div {
                            class: "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30",
                            "{translations.not_logged_in}"
                        }
                    }
                }

                // Body
                div {
                    class: "overflow-y-auto pr-2 custom-scrollbar mr-1 max-h-[calc(90vh-80px)]",

                    if current.active_tab == "patterns" {
                        {render_pattern_grid(&current, &translations)}
                    } else {
                        {render_color_grid(&current)}
                    }
                }
            }
        }
    }
}

fn render_pattern_grid(
    state: &TerritoryPatternsState,
    translations: &TerritoryPatternsTranslations,
) -> Element {
    rsx! {
        div {
            class: "flex flex-col",

            // My Skins button (only shown when logged in)
            if state.is_logged_in {
                div {
                    class: "pt-4 flex justify-center",
                    button {
                        class: if state.show_only_owned {
                            "px-4 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-wider border mb-4 bg-blue-500/20 text-blue-400 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                        } else {
                            "px-4 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-wider border mb-4 bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"
                        },
                        onclick: move |_| emit_toggle_owned(),
                        "{translations.show_only_owned}"
                    }
                }
            }

            // Pattern buttons or empty message
            if !state.show_only_owned && state.patterns.is_empty() {
                div {
                    class: "text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8",
                    "{translations.all_owned}"
                }
            } else {
                div {
                    class: "flex flex-wrap gap-4 p-2 justify-center items-stretch content-start",
                    {state.patterns.iter().map(|pattern| {
                        let pattern_id = pattern.id.clone();
                        let pattern_id_purchase = pattern.id.clone();
                        let is_selected = pattern.is_selected;
                        let requires_purchase = pattern.requires_purchase;

                        rsx! {
                            div {
                                key: "{pattern.id}",
                                class: if is_selected {
                                    "relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl border-2 border-blue-500 cursor-pointer transition-all duration-200 hover:scale-105 shadow-[0_0_15px_rgba(59,130,246,0.3)] overflow-hidden"
                                } else {
                                    "relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl border-2 border-white/10 cursor-pointer transition-all duration-200 hover:scale-105 hover:border-white/30 overflow-hidden"
                                },
                                onclick: move |_| {
                                    if requires_purchase {
                                        emit_purchase_pattern(&pattern_id_purchase);
                                    } else {
                                        emit_select_pattern(&pattern_id);
                                    }
                                },

                                // Pattern preview
                                if let Some(ref url) = pattern.preview_url {
                                    img {
                                        src: "{url}",
                                        class: "w-full h-full object-cover",
                                    }
                                } else if let (Some(ref primary), Some(ref secondary)) = (&pattern.primary_color, &pattern.secondary_color) {
                                    div {
                                        class: "w-full h-full",
                                        style: "background: linear-gradient(135deg, {primary}, {secondary});",
                                    }
                                } else if pattern.is_default {
                                    div {
                                        class: "w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center",
                                        span {
                                            class: "text-white/60 text-xs font-bold uppercase",
                                            "{translations.pattern_default}"
                                        }
                                    }
                                } else {
                                    div {
                                        class: "w-full h-full bg-gradient-to-br from-gray-600 to-gray-800",
                                    }
                                }

                                // Purchase overlay
                                if pattern.requires_purchase {
                                    div {
                                        class: "absolute inset-0 bg-black/40 flex items-end justify-center pb-1",
                                        if let Some(ref price) = pattern.price {
                                            span {
                                                class: "text-xs font-bold text-white bg-purple-600/80 px-2 py-0.5 rounded",
                                                "{price}"
                                            }
                                        }
                                    }
                                }

                                // Selection checkmark
                                if is_selected {
                                    div {
                                        class: "absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center",
                                        svg {
                                            xmlns: "http://www.w3.org/2000/svg",
                                            class: "h-3 w-3 text-white",
                                            fill: "none",
                                            view_box: "0 0 24 24",
                                            stroke: "currentColor",
                                            path {
                                                stroke_linecap: "round",
                                                stroke_linejoin: "round",
                                                stroke_width: "3",
                                                d: "M5 13l4 4L19 7",
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    })}
                }
            }
        }
    }
}

fn render_color_grid(state: &TerritoryPatternsState) -> Element {
    rsx! {
        div {
            class: "flex flex-wrap gap-3 p-2 justify-center items-center",
            {state.colors.iter().map(|hex| {
                let hex_clone = hex.clone();
                rsx! {
                    div {
                        key: "{hex}",
                        class: "w-12 h-12 rounded-xl border-2 border-white/10 cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:border-white relative group",
                        style: "background-color: {hex};",
                        title: "{hex}",
                        onclick: move |_| emit_select_color(&hex_clone),
                        div {
                            class: "absolute inset-0 rounded-xl ring-2 ring-inset ring-black/20",
                        }
                    }
                }
            })}
        }
    }
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

pub fn launch_territory_patterns_modal(state_json: &str, translations_json: &str) {
    let state: TerritoryPatternsState = serde_json::from_str(state_json).unwrap_or_default();
    let translations: TerritoryPatternsTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching territory patterns modal");

    set_initial_state(state, translations);

    let config = dioxus::web::Config::new().rootname("dioxus-territory-patterns-modal-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(territory_patterns_root);
}

fn territory_patterns_root() -> Element {
    let (state, translations) = take_initial_state();
    rsx! {
        TerritoryPatternsModal {
            state: state,
            translations: translations,
        }
    }
}

pub fn show_territory_patterns_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = true;
        }
    });
}

pub fn hide_territory_patterns_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = false;
        }
    });
}

pub fn update_territory_patterns_modal(state_json: &str) {
    let new_state: TerritoryPatternsState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse territory patterns state: {}", e);
            return;
        }
    };

    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(new_state);
        }
    });
}
