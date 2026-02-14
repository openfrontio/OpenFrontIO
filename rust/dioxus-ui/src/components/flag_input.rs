//! FlagInput component
//!
//! A button that displays the currently selected flag.
//! When clicked, emits an event to open the flag selector modal.
//! When no flag is selected and show_select_label is true, shows a "Select Flag" label.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the flag input component
pub fn register() {
    log::debug!("Registered <dioxus-flag-input> component");
}

// Thread-local storage for component state
thread_local! {
    static FLAG_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static SHOW_SELECT_LABEL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static TRANSLATIONS_SIGNAL: RefCell<Option<Signal<FlagInputTranslations>>> = const { RefCell::new(None) };
}

/// Translations for the flag input
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagInputTranslations {
    pub title: String,
    pub button_title: String,
}

/// Emit click event to open the flag modal
fn emit_flag_input_click() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    if let Ok(event) = web_sys::CustomEvent::new("dioxus-flag-input-click") {
        if let Some(root) = document.get_element_by_id("dioxus-flag-input-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main FlagInput component
#[component]
fn FlagInput() -> Element {
    let flag = use_signal(String::new);
    let show_select_label = use_signal(|| false);
    let translations = use_signal(FlagInputTranslations::default);

    FLAG_SIGNAL.with(|s| *s.borrow_mut() = Some(flag));
    SHOW_SELECT_LABEL.with(|s| *s.borrow_mut() = Some(show_select_label));
    TRANSLATIONS_SIGNAL.with(|s| *s.borrow_mut() = Some(translations));

    let current_flag = flag();
    let is_default = current_flag.is_empty() || current_flag == "xx";
    let show_select = show_select_label() && is_default;
    let t = translations();

    let button_title = if show_select {
        t.title.clone()
    } else {
        t.button_title.clone()
    };

    let is_custom_flag = current_flag.starts_with('!');

    // Build the flag image source
    let flag_src = if current_flag.is_empty() {
        "/flags/xx.svg".to_string()
    } else if is_custom_flag {
        // Custom flags are handled by the TS side via DOM manipulation
        String::new()
    } else {
        format!("/flags/{}.svg", current_flag)
    };

    rsx! {
        button {
            class: "flag-btn p-0! m-0 border-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-slate-900/80 hover:bg-slate-800/80 active:bg-slate-800/90 rounded-lg overflow-hidden",
            title: "{button_title}",
            onclick: move |_| {
                emit_flag_input_click();
            },

            // Flag preview
            if !show_select {
                if is_custom_flag {
                    // Custom flags: render a container for TS-side DOM manipulation
                    span {
                        id: "dioxus-flag-preview-custom",
                        class: "w-full h-full overflow-hidden",
                    }
                } else {
                    span {
                        class: "w-full h-full overflow-hidden",
                        img {
                            src: "{flag_src}",
                            class: "w-full h-full object-cover drop-shadow",
                            onerror: move |_| {
                                // Fallback handled by TS bridge
                            },
                        }
                    }
                }
            }

            // Select label
            if show_select {
                span {
                    class: "text-[10px] font-black text-white/40 uppercase leading-none break-words w-full text-center px-1",
                    "{t.title}"
                }
            }
        }
    }
}

/// Root component
fn FlagInputRoot() -> Element {
    rsx! { FlagInput {} }
}

/// Launch the flag input component
pub fn launch_flag_input(translations_json: &str) {
    log::info!("Launching flag input");

    let config = dioxus::web::Config::new().rootname("dioxus-flag-input-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(FlagInputRoot);

    // Set translations after launch
    update_flag_input_translations(translations_json);
}

/// Update the displayed flag
pub fn update_flag_input(flag: &str) {
    FLAG_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(flag.to_string());
        }
    });
}

/// Update the show_select_label property
pub fn update_flag_input_show_select_label(show: bool) {
    SHOW_SELECT_LABEL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(show);
        }
    });
}

/// Update translations
pub fn update_flag_input_translations(translations_json: &str) {
    let translations: FlagInputTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse flag input translations: {}", e);
            return;
        }
    };

    TRANSLATIONS_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(translations);
        }
    });
}
