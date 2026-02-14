//! Matchmaking Modal component
//!
//! A modal that shows matchmaking status:
//! - Connecting state with spinner
//! - Searching for match state with spinner
//! - Waiting for game state with spinner
//! - ELO display
//! All WebSocket and API logic stays in TypeScript.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the matchmaking modal component
pub fn register() {
    log::debug!("Registered <matchmaking-modal> component");
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingState {
    pub is_visible: bool,
    pub connected: bool,
    pub game_id: Option<String>,
    pub elo: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingTranslations {
    pub title: String,
    pub elo_label: String,
    pub connecting: String,
    pub searching: String,
    pub waiting_for_game: String,
    pub back: String,
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<MatchmakingState>>> =
        const { RefCell::new(None) };
    static INITIAL_STATE: RefCell<Option<(MatchmakingState, MatchmakingTranslations)>> =
        const { RefCell::new(None) };
}

pub fn set_initial_state(state: MatchmakingState, translations: MatchmakingTranslations) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((state, translations));
    });
}

pub fn take_initial_state() -> (MatchmakingState, MatchmakingTranslations) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                MatchmakingState::default(),
                MatchmakingTranslations::default(),
            )
        })
    })
}

pub fn store_state_signal(signal: Signal<MatchmakingState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub use store_state_signal as matchmaking_store_state_signal;
pub use take_initial_state as matchmaking_take_initial_state;

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
                CustomEvent::new_with_event_init_dict("dioxus-matchmaking-close", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct MatchmakingModalProps {
    pub state: MatchmakingState,
    pub translations: MatchmakingTranslations,
}

#[component]
pub fn MatchmakingModal(props: MatchmakingModalProps) -> Element {
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
                class: "relative bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 max-w-md w-full text-white overflow-hidden",
                onclick: move |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center justify-between p-4 border-b border-white/10",
                    button {
                        class: "text-white/60 hover:text-white transition-colors",
                        aria_label: "{translations.back}",
                        onclick: on_close,
                        // Back arrow
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
                    // Spacer for centering
                    div { class: "w-6" }
                }

                // Content
                div {
                    class: "flex-1 flex flex-col items-center justify-center gap-6 p-6",

                    // ELO display
                    p {
                        class: "text-center mt-2 mb-4 text-white/60",
                        "{translations.elo_label}"
                    }

                    // Status spinner
                    {render_status(&current, &translations)}
                }
            }
        }
    }
}

fn render_status(state: &MatchmakingState, translations: &MatchmakingTranslations) -> Element {
    if !state.connected {
        // Connecting
        rsx! {
            div {
                class: "flex flex-col items-center gap-4",
                div {
                    class: "w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin",
                }
                p {
                    class: "text-center text-white/80",
                    "{translations.connecting}"
                }
            }
        }
    } else if state.game_id.is_none() {
        // Searching
        rsx! {
            div {
                class: "flex flex-col items-center gap-4",
                div {
                    class: "w-12 h-12 border-4 border-green-500/30 border-t-green-500 rounded-full animate-spin",
                }
                p {
                    class: "text-center text-white/80",
                    "{translations.searching}"
                }
            }
        }
    } else {
        // Waiting for game
        rsx! {
            div {
                class: "flex flex-col items-center gap-4",
                div {
                    class: "w-12 h-12 border-4 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin",
                }
                p {
                    class: "text-center text-white/80",
                    "{translations.waiting_for_game}"
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

pub fn launch_matchmaking_modal(state_json: &str, translations_json: &str) {
    let state: MatchmakingState = serde_json::from_str(state_json).unwrap_or_default();
    let translations: MatchmakingTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching matchmaking modal");

    set_initial_state(state, translations);

    let config = dioxus::web::Config::new().rootname("dioxus-matchmaking-modal-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(matchmaking_root);
}

fn matchmaking_root() -> Element {
    let (state, translations) = take_initial_state();
    rsx! {
        MatchmakingModal {
            state: state,
            translations: translations,
        }
    }
}

pub fn show_matchmaking_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = true;
        }
    });
}

pub fn hide_matchmaking_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = false;
        }
    });
}

pub fn update_matchmaking_state(state_json: &str) {
    let new_state: MatchmakingState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse matchmaking state: {}", e);
            return;
        }
    };

    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(new_state);
        }
    });
}
