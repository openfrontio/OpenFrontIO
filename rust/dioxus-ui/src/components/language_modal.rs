//! LanguageModal component
//!
//! A modal for selecting the application language.
//! Displays a grid of language options with flags and native names.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the language modal web component
pub fn register() {
    log::debug!("Registered <dioxus-language-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<LanguageModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct LanguageModalState {
    languages: Vec<LanguageOption>,
    current_lang: String,
    translations: LanguageModalTranslations,
}

/// Language option data
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LanguageOption {
    pub code: String,
    pub svg: String,
    pub native: String,
    pub en: String,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageModalTranslations {
    pub title: String,
    pub back: String,
}

/// LanguageModal component props
#[derive(Props, Clone, PartialEq)]
pub struct LanguageModalProps {
    pub languages: Vec<LanguageOption>,
    pub current_lang: String,
    pub translations: LanguageModalTranslations,
}

/// Emit custom event when language is selected
fn emit_language_selected(lang: &str) {
    use wasm_bindgen::JsValue;
    use web_sys::CustomEventInit;

    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let mut init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);
    init.set_detail(&JsValue::from_str(lang));

    if let Ok(event) =
        web_sys::CustomEvent::new_with_event_init_dict("dioxus-language-selected", &init)
    {
        if let Some(root) = document.get_element_by_id("dioxus-language-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Emit close event
fn emit_modal_close() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    if let Ok(event) = web_sys::CustomEvent::new("dioxus-modal-close") {
        if let Some(root) = document.get_element_by_id("dioxus-language-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main LanguageModal component
#[component]
pub fn LanguageModal(props: LanguageModalProps) -> Element {
    let is_open = use_signal(|| false);

    // Store the signal for external updates
    IS_OPEN_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(is_open);
    });

    let on_close = move |_| {
        emit_modal_close();
    };

    if !is_open() {
        return rsx! {
            div { class: "hidden" }
        };
    }

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
                class: "w-full max-w-4xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden select-none pointer-events-auto flex flex-col",
                onclick: |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center gap-3 p-4 border-b border-white/10",
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

                // Content
                div {
                    class: "flex-1 overflow-y-auto p-2",
                    div {
                        class: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3",
                        for lang in props.languages.iter() {
                            {
                                let is_active = props.current_lang == lang.code;
                                let is_debug = lang.code == "debug";
                                let lang_code = lang.code.clone();

                                let button_class = if is_debug {
                                    "relative group rounded-xl border transition-all duration-200 flex items-center p-3 gap-3 w-full cursor-pointer animate-pulse font-bold text-white border-2 border-dashed border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] bg-gradient-to-r from-red-600 via-yellow-600 via-green-600 via-blue-600 to-purple-600"
                                } else if is_active {
                                    "relative group rounded-xl border transition-all duration-200 flex items-center p-3 gap-3 w-full cursor-pointer bg-blue-500/20 border-blue-500/50"
                                } else {
                                    "relative group rounded-xl border transition-all duration-200 flex items-center p-3 gap-3 w-full cursor-pointer bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                                };

                                let text_class = if is_active {
                                    "text-sm font-bold uppercase tracking-wider whitespace-normal break-words w-full text-left text-white"
                                } else {
                                    "text-sm font-bold uppercase tracking-wider whitespace-normal break-words w-full text-left text-gray-200 group-hover:text-white"
                                };

                                let flag_src = format!("/flags/{}.svg", lang.svg);

                                rsx! {
                                    button {
                                        key: "{lang.code}",
                                        class: "{button_class}",
                                        onclick: move |_| {
                                            emit_language_selected(&lang_code);
                                        },
                                        img {
                                            src: "{flag_src}",
                                            class: "w-8 h-6 object-contain shadow-sm rounded-sm shrink-0",
                                            alt: "{lang.code}"
                                        }
                                        div {
                                            class: "flex flex-col items-start min-w-0",
                                            span {
                                                class: "{text_class}",
                                                "{lang.native}"
                                            }
                                            span {
                                                class: "text-xs text-white/40 uppercase tracking-widest group-hover:text-white/60 transition-colors whitespace-normal break-words w-full text-left",
                                                "{lang.en}"
                                            }
                                        }
                                        if is_active {
                                            div {
                                                class: "ml-auto text-blue-400 shrink-0",
                                                svg {
                                                    xmlns: "http://www.w3.org/2000/svg",
                                                    "viewBox": "0 0 24 24",
                                                    fill: "currentColor",
                                                    class: "w-5 h-5",
                                                    path {
                                                        "fill-rule": "evenodd",
                                                        d: "M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z",
                                                        "clip-rule": "evenodd"
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
        }
    }
}

/// Root component that reads props from thread-local storage
fn LanguageModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            LanguageModal {
                languages: state.languages,
                current_lang: state.current_lang,
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the language modal component
pub fn launch_language_modal(languages_json: &str, current_lang: &str, translations_json: &str) {
    log::info!("Launching language modal with {} languages", current_lang);

    let languages: Vec<LanguageOption> = match serde_json::from_str(languages_json) {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to parse languages: {}", e);
            return;
        }
    };

    let translations: LanguageModalTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    // Store state in thread-local storage
    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(LanguageModalState {
            languages,
            current_lang: current_lang.to_string(),
            translations,
        });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-language-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(LanguageModalRoot);
}

/// Open the modal
pub fn open_language_modal() {
    log::debug!("open_language_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening language modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_language_modal() {
    log::debug!("close_language_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing language modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}
