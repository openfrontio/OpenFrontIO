//! TokenLoginModal component
//!
//! A modal that displays during token-based login. Shows a spinner while
//! login is in progress, then a success message with the email address.
//! All login logic is handled by the TypeScript bridge.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use web_sys::CustomEventInit;

/// Register the token login modal component
pub fn register() {
    log::debug!("Registered <dioxus-token-login-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<TokenLoginModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static EMAIL_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct TokenLoginModalState {
    translations: TokenLoginTranslations,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenLoginTranslations {
    pub title: String,
    pub logging_in: String,
    pub success: String,
    pub back: String,
}

/// TokenLoginModal component props
#[derive(Props, Clone, PartialEq)]
pub struct TokenLoginModalProps {
    pub translations: TokenLoginTranslations,
}

/// Emit close event
fn emit_modal_close() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);

    if let Ok(event) = web_sys::CustomEvent::new_with_event_init_dict("dioxus-modal-close", &init) {
        if let Some(root) = document.get_element_by_id("dioxus-token-login-modal-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main TokenLoginModal component
#[component]
pub fn TokenLoginModal(props: TokenLoginModalProps) -> Element {
    let is_open = use_signal(|| false);
    let email = use_signal(|| String::new());

    // Store signals for external updates
    IS_OPEN_SIGNAL.with(|s| *s.borrow_mut() = Some(is_open));
    EMAIL_SIGNAL.with(|s| *s.borrow_mut() = Some(email));

    let on_close = move |_| {
        emit_modal_close();
    };

    if !is_open() {
        return rsx! { div { class: "hidden" } };
    }

    let has_email = !email().is_empty();

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
                class: "w-full max-w-xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden pointer-events-auto flex flex-col",
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
                    class: "flex-1 flex flex-col gap-4 p-6",

                    if has_email {
                        // Success state
                        div {
                            class: "flex items-center gap-4",
                            div {
                                class: "w-12 h-12 rounded-full border border-emerald-400/40 bg-emerald-500/10 flex items-center justify-center",
                                div {
                                    class: "w-2 h-2 bg-emerald-400 rounded-full animate-pulse"
                                }
                            }
                            p {
                                class: "text-base text-white/90",
                                "{props.translations.success} {email()}"
                            }
                        }
                    } else {
                        // Logging in state
                        div {
                            class: "flex items-center gap-4",
                            div {
                                class: "w-12 h-12 rounded-full border border-blue-400/40 bg-blue-500/10 flex items-center justify-center",
                                div {
                                    class: "w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"
                                }
                            }
                            div {
                                class: "flex flex-col gap-2",
                                p {
                                    class: "text-lg font-semibold text-white",
                                    "{props.translations.logging_in}"
                                }
                                div {
                                    class: "h-1 w-full bg-white/10 rounded-full overflow-hidden",
                                    div {
                                        class: "h-full w-1/2 bg-blue-400/80 animate-pulse"
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
fn TokenLoginModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            TokenLoginModal {
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the token login modal component
pub fn launch_token_login_modal(translations_json: &str) {
    log::info!("Launching token login modal");

    let translations: TokenLoginTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(TokenLoginModalState { translations });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-token-login-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(TokenLoginModalRoot);
}

/// Open the modal
pub fn open_token_login_modal() {
    log::debug!("open_token_login_modal called");

    // Reset email when opening
    EMAIL_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(String::new());
        }
    });

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening token login modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_token_login_modal() {
    log::debug!("close_token_login_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing token login modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}

/// Update the email (showing success state)
pub fn update_token_login_email(email: &str) {
    EMAIL_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(email.to_string());
        }
    });
}
