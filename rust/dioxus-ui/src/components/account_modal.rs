//! AccountModal component
//!
//! A modal for account management. Shows login options (Discord, email magic link)
//! when not logged in, and account info, stats, and recent games when logged in.
//! All API calls and auth logic are handled by the TypeScript bridge,
//! which passes rendered HTML content to this component.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use web_sys::CustomEventInit;

/// Register the account modal component
pub fn register() {
    log::debug!("Registered <dioxus-account-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<AccountModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static IS_LOADING_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static CONTENT_HTML_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static HEADER_RIGHT_HTML_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct AccountModalState {
    translations: AccountModalTranslations,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountModalTranslations {
    pub title: String,
    pub back: String,
    pub fetching_account: String,
}

/// AccountModal component props
#[derive(Props, Clone, PartialEq)]
pub struct AccountModalProps {
    pub translations: AccountModalTranslations,
}

/// Emit close event
fn emit_modal_close() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);

    if let Ok(event) = web_sys::CustomEvent::new_with_event_init_dict("dioxus-modal-close", &init) {
        if let Some(root) = document.get_element_by_id("dioxus-account-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Emit action event (discord-login, email-submit, logout, view-game)
fn emit_action(action: &str, detail: &str) {
    use wasm_bindgen::JsValue;

    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let mut init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);
    init.set_detail(&JsValue::from_str(detail));

    let event_name = format!("dioxus-account-{}", action);
    if let Ok(event) = web_sys::CustomEvent::new_with_event_init_dict(&event_name, &init) {
        if let Some(root) = document.get_element_by_id("dioxus-account-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main AccountModal component
#[component]
pub fn AccountModal(props: AccountModalProps) -> Element {
    let is_open = use_signal(|| false);
    let is_loading = use_signal(|| false);
    let content_html = use_signal(|| String::new());
    let header_right_html = use_signal(|| String::new());

    // Store signals for external updates
    IS_OPEN_SIGNAL.with(|s| *s.borrow_mut() = Some(is_open));
    IS_LOADING_SIGNAL.with(|s| *s.borrow_mut() = Some(is_loading));
    CONTENT_HTML_SIGNAL.with(|s| *s.borrow_mut() = Some(content_html));
    HEADER_RIGHT_HTML_SIGNAL.with(|s| *s.borrow_mut() = Some(header_right_html));

    let on_close = move |_| {
        emit_modal_close();
    };

    if !is_open() {
        return rsx! { div { class: "hidden" } };
    }

    if is_loading() {
        return rsx! {
            // Backdrop
            div {
                class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]",
                onclick: on_close,
            }
            div {
                class: "fixed inset-4 md:inset-8 lg:inset-16 z-[9999] flex items-center justify-center pointer-events-none",
                div {
                    class: "flex flex-col items-center justify-center p-12 text-white bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 min-h-[400px] pointer-events-auto",
                    onclick: |e| e.stop_propagation(),
                    div {
                        class: "w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"
                    }
                    p {
                        class: "text-white/60 font-medium tracking-wide animate-pulse",
                        "{props.translations.fetching_account}"
                    }
                }
            }
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
                class: "w-full max-w-3xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden pointer-events-auto flex flex-col",
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
                        class: "text-xl font-bold text-white flex-1",
                        "{props.translations.title}"
                    }
                    if !header_right_html().is_empty() {
                        div {
                            dangerous_inner_html: "{header_right_html()}"
                        }
                    }
                }

                // Content - rendered as HTML from TS bridge
                div {
                    class: "flex-1 overflow-y-auto custom-scrollbar mr-1",

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
fn AccountModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            AccountModal {
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the account modal component
pub fn launch_account_modal(translations_json: &str) {
    log::info!("Launching account modal");

    let translations: AccountModalTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(AccountModalState { translations });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-account-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(AccountModalRoot);
}

/// Open the modal
pub fn open_account_modal() {
    log::debug!("open_account_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening account modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_account_modal() {
    log::debug!("close_account_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing account modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}

/// Set loading state
pub fn update_account_modal_loading(loading: bool) {
    IS_LOADING_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(loading);
        }
    });
}

/// Update the content HTML
pub fn update_account_modal_content(html: &str) {
    CONTENT_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(html.to_string());
        }
    });
}

/// Update the header right content HTML
pub fn update_account_modal_header_right(html: &str) {
    HEADER_RIGHT_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(html.to_string());
        }
    });
}
