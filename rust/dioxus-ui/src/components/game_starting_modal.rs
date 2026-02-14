//! GameStartingModal component
//!
//! A simple modal that displays credits and code license information
//! while the game is starting.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the game starting modal web component
pub fn register() {
    log::debug!("Registered <dioxus-game-starting-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<GameStartingModalState>> = const { RefCell::new(None) };
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct GameStartingModalState {
    translations: GameStartingModalTranslations,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStartingModalTranslations {
    pub credits: String,
    pub code_license: String,
    pub title: String,
}

/// GameStartingModal component props
#[derive(Props, Clone, PartialEq)]
pub struct GameStartingModalProps {
    pub translations: GameStartingModalTranslations,
}

/// Main GameStartingModal component
#[component]
pub fn GameStartingModal(props: GameStartingModalProps) -> Element {
    let is_visible = use_signal(|| false);

    // Store the signal for external updates
    IS_VISIBLE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(is_visible);
    });

    let backdrop_class = if is_visible() {
        "fixed inset-0 bg-black/30 backdrop-blur-[4px] z-[9998] transition-all duration-300 opacity-100 visible"
    } else {
        "fixed inset-0 bg-black/30 backdrop-blur-[4px] z-[9998] transition-all duration-300 opacity-0 invisible"
    };

    let modal_class = if is_visible() {
        "fixed top-1/2 left-1/2 bg-zinc-800/70 p-6 rounded-xl z-[9999] shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-[5px] text-white w-[300px] text-center transition-all duration-300 -translate-x-1/2 opacity-100 visible -translate-y-1/2"
    } else {
        "fixed top-1/2 left-1/2 bg-zinc-800/70 p-6 rounded-xl z-[9999] shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-[5px] text-white w-[300px] text-center transition-all duration-300 -translate-x-1/2 opacity-0 invisible -translate-y-[48%]"
    };

    rsx! {
        div { class: "{backdrop_class}" }
        div {
            class: "{modal_class}",
            div {
                class: "text-xl mt-5 mb-2.5 px-0",
                "© OpenFront and Contributors"
            }
            a {
                href: "https://github.com/openfrontio/OpenFrontIO/blob/main/CREDITS.md",
                target: "_blank",
                rel: "noopener noreferrer",
                class: "block mt-2.5 mb-4 text-xl text-blue-400 no-underline transition-colors duration-200 hover:text-blue-300 hover:underline",
                "{props.translations.credits}"
            }
            p {
                class: "my-0.5 text-sm",
                "{props.translations.code_license}"
            }
            p {
                class: "text-base my-5 bg-black/30 p-2.5 rounded",
                "{props.translations.title}"
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn GameStartingModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            GameStartingModal {
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the game starting modal component
pub fn launch_game_starting_modal(translations_json: &str) {
    log::info!("Launching game starting modal");

    let translations: GameStartingModalTranslations = match serde_json::from_str(translations_json)
    {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    // Store state in thread-local storage
    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(GameStartingModalState { translations });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-game-starting-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(GameStartingModalRoot);
}

/// Show the modal
pub fn show_game_starting_modal() {
    log::debug!("show_game_starting_modal called");

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Showing game starting modal");
            signal.set(true);
        } else {
            log::warn!("IS_VISIBLE_SIGNAL is None, cannot show modal");
        }
    });
}

/// Hide the modal
pub fn hide_game_starting_modal() {
    log::debug!("hide_game_starting_modal called");

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Hiding game starting modal");
            signal.set(false);
        } else {
            log::warn!("IS_VISIBLE_SIGNAL is None, cannot hide modal");
        }
    });
}
