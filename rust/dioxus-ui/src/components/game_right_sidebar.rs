//! GameRightSidebar component
//!
//! A toolbar in the top-right corner of the game screen with:
//! - Timer display (count up or countdown with red warning)
//! - Replay (fast-forward) button
//! - Pause/play button
//! - Settings (gear) button
//! - Exit (door) button

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<GameRightSidebarState>>> = const { RefCell::new(None) };
}

/// State received from TypeScript on every tick
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameRightSidebarState {
    is_visible: bool,
    timer_text: String,
    timer_red: bool,
    show_replay_button: bool,
    show_pause_button: bool,
    is_paused: bool,
    // Icon URLs
    settings_icon: String,
    exit_icon: String,
    fast_forward_icon: String,
    pause_icon: String,
    play_icon: String,
}

/// Register the game right sidebar component
pub fn register() {
    log::debug!("Registered <dioxus-game-right-sidebar> component");
}

/// Emit a simple custom event with no detail
fn emit_event(event_key: &str) {
    emit_ui_event(
        event_name(event_key),
        Some("component.game-right-sidebar"),
        json!({}),
    );
}

#[component]
fn GameRightSidebar() -> Element {
    let state = use_signal(GameRightSidebarState::default);

    STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(state));

    let current = state();

    let visibility_class = if current.is_visible {
        "translate-x-0"
    } else {
        "translate-x-full"
    };

    let timer_class = if current.timer_red {
        "text-red-400"
    } else {
        ""
    };

    let on_replay_click = move |_| {
        emit_event(event_keys::UI_INGAME_GAME_RIGHT_SIDEBAR_REPLAY);
    };

    let on_pause_click = move |_| {
        emit_event(event_keys::UI_INGAME_GAME_RIGHT_SIDEBAR_PAUSE);
    };

    let on_settings_click = move |_| {
        emit_event(event_keys::UI_INGAME_GAME_RIGHT_SIDEBAR_SETTINGS);
    };

    let on_exit_click = move |_| {
        emit_event(event_keys::UI_INGAME_GAME_RIGHT_SIDEBAR_EXIT);
    };

    rsx! {
        aside {
            class: "w-fit flex flex-row items-center gap-3 py-2 px-3 bg-gray-800/70 backdrop-blur-xs shadow-xs rounded-lg transition-transform duration-300 ease-out transform text-white {visibility_class}",
            oncontextmenu: move |e| e.prevent_default(),

            // Timer display
            div {
                class: "{timer_class}",
                "{current.timer_text}"
            }

            // Replay (fast-forward) button
            if current.show_replay_button {
                div {
                    class: "cursor-pointer",
                    onclick: on_replay_click,
                    img {
                        src: "{current.fast_forward_icon}",
                        alt: "replay",
                        width: "20",
                        height: "20",
                    }
                }
            }

            // Pause/play button
            if current.show_pause_button {
                div {
                    class: "cursor-pointer",
                    onclick: on_pause_click,
                    img {
                        src: if current.is_paused { "{current.play_icon}" } else { "{current.pause_icon}" },
                        alt: "play/pause",
                        width: "20",
                        height: "20",
                    }
                }
            }

            // Settings button
            div {
                class: "cursor-pointer",
                onclick: on_settings_click,
                img {
                    src: "{current.settings_icon}",
                    alt: "settings",
                    width: "20",
                    height: "20",
                }
            }

            // Exit button
            div {
                class: "cursor-pointer",
                onclick: on_exit_click,
                img {
                    src: "{current.exit_icon}",
                    alt: "exit",
                    width: "20",
                    height: "20",
                }
            }
        }
    }
}

fn GameRightSidebarRoot() -> Element {
    rsx! { GameRightSidebar {} }
}

pub fn launch_game_right_sidebar() {
    log::info!("Launching game right sidebar");
    let config = dioxus::web::Config::new().rootname("dioxus-game-right-sidebar-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(GameRightSidebarRoot);
}

pub fn update_game_right_sidebar(state_json: &str) {
    let new_state: GameRightSidebarState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse game right sidebar state: {}", e);
            return;
        }
    };
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
