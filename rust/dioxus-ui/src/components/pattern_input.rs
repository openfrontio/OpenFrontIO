//! PatternInput component
//!
//! A button that displays the currently selected territory pattern.
//! When clicked, emits an event to open the pattern/skin store.
//! Shows a loading spinner while cosmetics are loading.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the pattern input component
pub fn register() {
    log::debug!("Registered <dioxus-pattern-input> component");
}

// Thread-local storage for component state
thread_local! {
    static PREVIEW_URL_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static SHOW_SELECT_LABEL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static IS_LOADING: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static TRANSLATIONS_SIGNAL: RefCell<Option<Signal<PatternInputTranslations>>> = const { RefCell::new(None) };
}

/// Translations for the pattern input
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternInputTranslations {
    pub title: String,
    pub select_skin: String,
}

/// Emit click event to open the pattern store
fn emit_pattern_input_click() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    if let Ok(event) = web_sys::CustomEvent::new("dioxus-pattern-input-click") {
        if let Some(root) = document.get_element_by_id("dioxus-pattern-input-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main PatternInput component
#[component]
fn PatternInput() -> Element {
    let preview_url = use_signal(String::new);
    let show_select_label = use_signal(|| false);
    let is_loading = use_signal(|| true);
    let translations = use_signal(PatternInputTranslations::default);

    PREVIEW_URL_SIGNAL.with(|s| *s.borrow_mut() = Some(preview_url));
    SHOW_SELECT_LABEL.with(|s| *s.borrow_mut() = Some(show_select_label));
    IS_LOADING.with(|s| *s.borrow_mut() = Some(is_loading));
    TRANSLATIONS_SIGNAL.with(|s| *s.borrow_mut() = Some(translations));

    let t = translations();
    let url = preview_url();
    let is_default = url.is_empty();
    let show_select = show_select_label() && is_default;

    // Loading state
    if is_loading() {
        return rsx! {
            button {
                class: "pattern-btn m-0 border-0 !p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 bg-slate-900/80 rounded-lg overflow-hidden",
                disabled: true,
                span {
                    class: "w-6 h-6 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin",
                }
            }
        };
    }

    rsx! {
        button {
            class: "pattern-btn m-0 border-0 !p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-slate-900/80 hover:bg-slate-800/80 active:bg-slate-800/90 rounded-lg overflow-hidden",
            title: "{t.title}",
            onclick: move |_| {
                emit_pattern_input_click();
            },

            // Pattern preview - rendered by the TS bridge via DOM manipulation
            if !show_select {
                span {
                    id: "dioxus-pattern-preview-container",
                    class: "w-full h-full overflow-hidden flex items-center justify-center [&>img]:object-cover [&>img]:w-full [&>img]:h-full",
                }
            }

            // Select label
            if show_select {
                span {
                    class: "text-[10px] font-black text-white/40 uppercase leading-none break-words w-full text-center px-1",
                    "{t.select_skin}"
                }
            }
        }
    }
}

/// Root component
fn PatternInputRoot() -> Element {
    rsx! { PatternInput {} }
}

/// Launch the pattern input component
pub fn launch_pattern_input(translations_json: &str) {
    log::info!("Launching pattern input");

    let config = dioxus::web::Config::new().rootname("dioxus-pattern-input-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(PatternInputRoot);

    // Set initial translations after launch
    update_pattern_input_translations(translations_json);
}

/// Update the preview image URL (data URL or path)
pub fn update_pattern_input_preview(preview_url: &str) {
    PREVIEW_URL_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(preview_url.to_string());
        }
    });
}

/// Update the show_select_label property
pub fn update_pattern_input_show_select_label(show: bool) {
    SHOW_SELECT_LABEL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(show);
        }
    });
}

/// Update loading state
pub fn update_pattern_input_loading(loading: bool) {
    IS_LOADING.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(loading);
        }
    });
}

/// Update translations
pub fn update_pattern_input_translations(translations_json: &str) {
    let translations: PatternInputTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse pattern input translations: {}", e);
            return;
        }
    };

    TRANSLATIONS_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(translations);
        }
    });
}
