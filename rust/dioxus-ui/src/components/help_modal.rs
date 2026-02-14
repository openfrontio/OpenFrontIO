//! HelpModal component
//!
//! A large modal displaying game instructions including hotkeys table,
//! UI interface guide with images, radial menu descriptions, build menu
//! table, and player icon explanations.
//! All content is passed as rendered HTML from the TypeScript bridge
//! to keep the Rust component simple and translatable.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use web_sys::CustomEventInit;

/// Register the help modal component
pub fn register() {
    log::debug!("Registered <dioxus-help-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<HelpModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static CONTENT_HTML_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct HelpModalState {
    translations: HelpModalTranslations,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpModalTranslations {
    pub title: String,
    pub back: String,
}

/// HelpModal component props
#[derive(Props, Clone, PartialEq)]
pub struct HelpModalProps {
    pub translations: HelpModalTranslations,
}

/// Emit close event
fn emit_modal_close() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);

    if let Ok(event) = web_sys::CustomEvent::new_with_event_init_dict("dioxus-modal-close", &init) {
        if let Some(root) = document.get_element_by_id("dioxus-help-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main HelpModal component
#[component]
pub fn HelpModal(props: HelpModalProps) -> Element {
    let is_open = use_signal(|| false);
    let content_html = use_signal(|| String::new());

    // Store signals for external updates
    IS_OPEN_SIGNAL.with(|s| *s.borrow_mut() = Some(is_open));
    CONTENT_HTML_SIGNAL.with(|s| *s.borrow_mut() = Some(content_html));

    let on_close = move |_| {
        emit_modal_close();
    };

    if !is_open() {
        return rsx! { div { class: "hidden" } };
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
                class: "w-full max-w-5xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden pointer-events-auto flex flex-col",
                onclick: |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center gap-3 p-4 border-b border-white/10 shrink-0",
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

                // Content - rendered as HTML from TS bridge
                div {
                    class: "prose prose-invert prose-sm max-w-none overflow-y-auto px-6 py-3 mr-1
                        [&_a]:text-blue-400 [&_a:hover]:text-blue-300 transition-colors
                        [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-white [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-2
                        [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-200
                        [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-100
                        [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1
                        [&_li]:text-gray-300 [&_li]:leading-relaxed
                        [&_p]:text-gray-300 [&_p]:mb-3 [&_strong]:text-white [&_strong]:font-bold
                        scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent",

                    if !content_html().is_empty() {
                        div {
                            dangerous_inner_html: "{content_html()}"
                        }
                    }
                }
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn HelpModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            HelpModal {
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the help modal component
pub fn launch_help_modal(translations_json: &str) {
    log::info!("Launching help modal");

    let translations: HelpModalTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(HelpModalState { translations });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-help-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(HelpModalRoot);
}

/// Open the modal
pub fn open_help_modal() {
    log::debug!("open_help_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening help modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_help_modal() {
    log::debug!("close_help_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing help modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}

/// Update the content HTML
pub fn update_help_modal_content(html: &str) {
    CONTENT_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(html.to_string());
        }
    });
}
