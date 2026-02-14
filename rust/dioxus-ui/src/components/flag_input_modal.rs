//! FlagInputModal component
//!
//! A modal for selecting a country flag.
//! Displays a searchable grid of country flags with names.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the flag input modal web component
pub fn register() {
    log::debug!("Registered <dioxus-flag-input-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<FlagInputModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static SEARCH_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct FlagInputModalState {
    countries: Vec<CountryOption>,
    translations: FlagInputModalTranslations,
}

/// Country option data
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CountryOption {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub restricted: bool,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagInputModalTranslations {
    pub title: String,
    pub search_flag: String,
    pub back: String,
}

/// FlagInputModal component props
#[derive(Props, Clone, PartialEq)]
pub struct FlagInputModalProps {
    pub countries: Vec<CountryOption>,
    pub translations: FlagInputModalTranslations,
}

/// Emit custom event when flag is selected
fn emit_flag_selected(flag: &str) {
    use wasm_bindgen::JsValue;
    use web_sys::CustomEventInit;

    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let mut init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);
    init.set_detail(&JsValue::from_str(flag));

    if let Ok(event) = web_sys::CustomEvent::new_with_event_init_dict("dioxus-flag-selected", &init)
    {
        if let Some(root) = document.get_element_by_id("dioxus-flag-input-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Emit close event
fn emit_modal_close() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    if let Ok(event) = web_sys::CustomEvent::new("dioxus-modal-close") {
        if let Some(root) = document.get_element_by_id("dioxus-flag-input-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main FlagInputModal component
#[component]
pub fn FlagInputModal(props: FlagInputModalProps) -> Element {
    let is_open = use_signal(|| false);
    let mut search = use_signal(|| String::new());

    // Store the signals for external updates
    IS_OPEN_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(is_open);
    });
    SEARCH_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(search);
    });

    let on_close = move |_| {
        emit_modal_close();
    };

    if !is_open() {
        return rsx! {
            div { class: "hidden" }
        };
    }

    // Filter countries based on search
    let search_lower = search().to_lowercase();
    let filtered_countries: Vec<_> = props
        .countries
        .iter()
        .filter(|c| {
            !c.restricted
                && (c.name.to_lowercase().contains(&search_lower)
                    || c.code.to_lowercase().contains(&search_lower))
        })
        .cloned()
        .collect();

    rsx! {
        // Backdrop
        div {
            class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]",
            onclick: on_close,
        }
        // Modal
        div {
            class: "fixed inset-4 md:inset-8 lg:inset-16 z-[9999] flex items-center justify-center pointer-events-none",
            div {
                class: "w-full max-w-4xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden pointer-events-auto flex flex-col",
                onclick: |e| e.stop_propagation(),

                // Header with search
                div {
                    class: "relative flex flex-col border-b border-white/10 pb-4 shrink-0",

                    // Title bar
                    div {
                        class: "flex items-center gap-3 p-4",
                        button {
                            class: "w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors",
                            onclick: on_close,
                            "aria-label": "{props.translations.back}",
                            svg {
                                xmlns: "http://www.w3.org/2000/svg",
                                fill: "none",
                                "viewBox": "0 0 24 24",
                                "stroke-width": "2",
                                stroke: "currentColor",
                                class: "w-5 h-5 text-white",
                                path {
                                    "stroke-linecap": "round",
                                    "stroke-linejoin": "round",
                                    d: "M15.75 19.5L8.25 12l7.5-7.5"
                                }
                            }
                        }
                        h2 {
                            class: "text-xl font-bold text-white",
                            "{props.translations.title}"
                        }
                    }

                    // Search input
                    div {
                        class: "flex items-center gap-2 justify-center mt-4 px-4",
                        input {
                            class: "h-12 w-full max-w-md border border-white/10 bg-black/60 rounded-xl shadow-inner text-xl text-center focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all",
                            r#type: "text",
                            placeholder: "{props.translations.search_flag}",
                            value: "{search}",
                            oninput: move |e| {
                                search.set(e.value());
                            }
                        }
                    }
                }

                // Content - scrollable country grid
                div {
                    class: "flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mr-1",
                    div {
                        class: "pt-2 flex flex-wrap justify-center gap-4 min-h-min",
                        for country in filtered_countries.iter() {
                            {
                                let country_code = country.code.clone();
                                let flag_src = format!("/flags/{}.svg", country.code);

                                rsx! {
                                    button {
                                        key: "{country.code}",
                                        class: "group relative flex flex-col items-center gap-2 p-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer w-[100px] sm:w-[120px]",
                                        onclick: move |_| {
                                            emit_flag_selected(&country_code);
                                        },
                                        img {
                                            class: "w-full h-auto rounded shadow-sm group-hover:scale-105 transition-transform duration-200",
                                            src: "{flag_src}",
                                            loading: "lazy",
                                            alt: "{country.name}"
                                        }
                                        span {
                                            class: "text-xs font-bold text-gray-300 group-hover:text-white text-center leading-tight w-full truncate",
                                            "{country.name}"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn FlagInputModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            FlagInputModal {
                countries: state.countries,
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the flag input modal component
pub fn launch_flag_input_modal(countries_json: &str, translations_json: &str) {
    log::info!("Launching flag input modal");

    let countries: Vec<CountryOption> = match serde_json::from_str(countries_json) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to parse countries: {}", e);
            return;
        }
    };

    let translations: FlagInputModalTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    // Store state in thread-local storage
    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(FlagInputModalState {
            countries,
            translations,
        });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-flag-input-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(FlagInputModalRoot);
}

/// Open the modal
pub fn open_flag_input_modal() {
    log::debug!("open_flag_input_modal called");

    // Clear search when opening
    SEARCH_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(String::new());
        }
    });

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening flag input modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_flag_input_modal() {
    log::debug!("close_flag_input_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing flag input modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}
