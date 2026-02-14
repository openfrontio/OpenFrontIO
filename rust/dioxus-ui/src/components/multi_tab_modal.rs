//! MultiTabModal component
//!
//! A modal that displays when multiple tabs are detected.
//! Shows a countdown timer, fake IP, and device fingerprint.
//! Emits a runtime event when countdown ends.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::Window;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the multi-tab modal web component
pub fn register() {
    log::debug!("Registered <dioxus-multi-tab-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<MultiTabModalState>> = const { RefCell::new(None) };
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static COUNTDOWN_SIGNAL: RefCell<Option<Signal<u32>>> = const { RefCell::new(None) };
    static DURATION_SIGNAL: RefCell<Option<Signal<u32>>> = const { RefCell::new(None) };
    static INTERVAL_HANDLE: RefCell<Option<i32>> = const { RefCell::new(None) };
}

/// State for the multi-tab modal
#[derive(Clone)]
pub struct MultiTabModalState {
    pub translations: MultiTabTranslations,
    pub fake_ip: String,
    pub device_fingerprint: String,
    pub reported: bool,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiTabTranslations {
    pub warning: String,
    pub detected: String,
    pub please_wait: String,
    pub seconds: String,
    pub explanation: String,
}

impl Default for MultiTabTranslations {
    fn default() -> Self {
        Self {
            warning: "Multi-Tab Warning".to_string(),
            detected: "Multiple tabs detected. This violates our terms of service.".to_string(),
            please_wait: "Please wait".to_string(),
            seconds: "seconds".to_string(),
            explanation: "We have detected that you have multiple tabs of this game open. This is against our rules to ensure fair play.".to_string(),
        }
    }
}

/// MultiTabModal component props
#[derive(Props, Clone, PartialEq)]
pub struct MultiTabModalProps {
    pub translations: MultiTabTranslations,
    pub fake_ip: String,
    pub device_fingerprint: String,
    pub reported: bool,
}

/// Emit penalty complete event
fn emit_penalty_complete() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_MULTI_TAB_PENALTY_COMPLETE),
        Some("component.multi-tab-modal"),
        json!({}),
    );
}

/// Clear existing interval
fn clear_interval() {
    INTERVAL_HANDLE.with(|handle| {
        if let Some(h) = handle.take() {
            if let Some(window) = web_sys::window() {
                let _ = window.clear_interval_with_handle(h);
            }
        }
    });
}

/// Set up countdown interval
fn setup_countdown_interval(
    mut is_visible: Signal<bool>,
    mut countdown: Signal<u32>,
    window: &Window,
) {
    // Clear any existing interval
    clear_interval();

    let closure = Closure::wrap(Box::new(move || {
        let mut is_visible = is_visible;
        let mut countdown = countdown;
        if is_visible() {
            let current = countdown();
            if current > 0 {
                countdown.set(current - 1);
            }
            if countdown() == 0 {
                emit_penalty_complete();
                is_visible.set(false);
            }
        }
    }) as Box<dyn FnMut()>);

    let handle = window.set_interval_with_callback_and_timeout_and_arguments_0(
        closure.as_ref().unchecked_ref(),
        1000,
    );

    // Store the handle and keep the closure alive
    INTERVAL_HANDLE.with(|h| {
        *h.borrow_mut() = handle.ok();
    });
    closure.forget();
}

/// Main MultiTabModal component
#[component]
pub fn MultiTabModal(props: MultiTabModalProps) -> Element {
    let mut is_visible = use_signal(|| false);
    let mut countdown = use_signal(|| 5u32);
    let duration = use_signal(|| 5000u32);

    // Store signals for external updates
    IS_VISIBLE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(is_visible);
    });
    COUNTDOWN_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(countdown);
    });
    DURATION_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(duration);
    });

    // Set up interval when component mounts
    use_effect(move || {
        if let Some(window) = web_sys::window() {
            setup_countdown_interval(is_visible, countdown, &window);
        }

        // Cleanup on unmount
        clear_interval();
    });

    // Reset countdown when visibility changes to true
    use_effect(move || {
        if is_visible() {
            let new_countdown = (duration() / 1000).max(1);
            countdown.set(new_countdown);
        }
    });

    let progress_percent = if duration() > 0 {
        (countdown() as f64 / (duration() / 1000) as f64) * 100.0
    } else {
        0.0
    };

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    rsx! {
        div {
            class: "fixed inset-0 z-50 overflow-auto bg-red-500/20 flex items-center justify-center",
            div {
                class: "relative p-6 bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full m-4 transition-all transform",
                div {
                    class: "flex items-center justify-between mb-4",
                    h2 {
                        class: "text-2xl font-bold text-red-600 dark:text-red-400",
                        "{props.translations.warning}"
                    }
                    div {
                        class: "px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse",
                        "RECORDING"
                    }
                }

                p {
                    class: "mb-4 text-gray-800 dark:text-gray-200",
                    "{props.translations.detected}"
                }

                div {
                    class: "mb-4 p-3 bg-gray-100 dark:bg-gray-900 rounded-md text-sm font-mono",
                    div {
                        class: "flex justify-between mb-1",
                        span {
                            class: "text-gray-500 dark:text-gray-400",
                            "IP:"
                        }
                        span {
                            class: "text-red-600 dark:text-red-400",
                            "{props.fake_ip}"
                        }
                    }
                    div {
                        class: "flex justify-between mb-1",
                        span {
                            class: "text-gray-500 dark:text-gray-400",
                            "Device Fingerprint:"
                        }
                        span {
                            class: "text-red-600 dark:text-red-400",
                            "{props.device_fingerprint}"
                        }
                    }
                    div {
                        class: "flex justify-between",
                        span {
                            class: "text-gray-500 dark:text-gray-400",
                            "Reported:"
                        }
                        span {
                            class: "text-red-600 dark:text-red-400",
                            if props.reported { "TRUE" } else { "FALSE" }
                        }
                    }
                }

                p {
                    class: "mb-4 text-gray-800 dark:text-gray-200",
                    "{props.translations.please_wait} ",
                    span {
                        class: "font-bold text-xl",
                        "{countdown()}"
                    },
                    " {props.translations.seconds}"
                }

                div {
                    class: "w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-4",
                    div {
                        class: "bg-red-600 dark:bg-red-500 h-2.5 rounded-full transition-all duration-1000 ease-linear",
                        style: "width: {progress_percent}%",
                    }
                }

                p {
                    class: "text-sm text-gray-600 dark:text-gray-400",
                    "{props.translations.explanation}"
                }

                p {
                    class: "mt-3 text-xs text-red-500 font-semibold",
                    "Repeated violations may result in permanent account suspension."
                }
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn MultiTabModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            MultiTabModal {
                translations: state.translations,
                fake_ip: state.fake_ip,
                device_fingerprint: state.device_fingerprint,
                reported: state.reported,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the multi-tab modal component
pub fn launch_multi_tab_modal(translations_json: &str) {
    log::info!("Launching multi-tab modal");

    let translations: MultiTabTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            MultiTabTranslations::default()
        }
    };

    // Generate fake data
    let fake_ip = generate_fake_ip();
    let device_fingerprint = generate_device_fingerprint();

    // Store state in thread-local storage
    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(MultiTabModalState {
            translations,
            fake_ip,
            device_fingerprint,
            reported: true,
        });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-multi-tab-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(MultiTabModalRoot);
}

/// Show the modal with a specified duration
pub fn show_multi_tab_modal(duration_ms: u32) {
    log::debug!("show_multi_tab_modal called with duration: {}", duration_ms);

    COUNTDOWN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            let countdown = (duration_ms / 1000).max(1);
            log::info!("Setting countdown to {}", countdown);
            signal.set(countdown);
        }
    });

    DURATION_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Setting duration to {}", duration_ms);
            signal.set(duration_ms);
        }
    });

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Showing multi-tab modal");
            signal.set(true);
        } else {
            log::warn!("IS_VISIBLE_SIGNAL is None, cannot show modal");
        }
    });
}

/// Hide the modal
pub fn hide_multi_tab_modal() {
    log::debug!("hide_multi_tab_modal called");

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Hiding multi-tab modal");
            signal.set(false);
        } else {
            log::warn!("IS_VISIBLE_SIGNAL is None, cannot hide modal");
        }
    });
}

/// Generate fake IP in format xxx.xxx.xxx.xxx
fn generate_fake_ip() -> String {
    use js_sys::Math;
    let octets: Vec<String> = (0..4)
        .map(|_| (Math::floor(Math::random() * 255.0) as u32).to_string())
        .collect();
    octets.join(".")
}

/// Generate fake device fingerprint (32 character hex)
fn generate_device_fingerprint() -> String {
    use js_sys::Math;
    let hex_chars = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
    ];
    (0..32)
        .map(|_| {
            let idx = Math::floor(Math::random() * 16.0) as usize;
            hex_chars[idx.min(15)]
        })
        .collect()
}
