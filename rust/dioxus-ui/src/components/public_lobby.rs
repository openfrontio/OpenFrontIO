//! PublicLobby component
//!
//! Displays available public games as a card with map image, mode, timer,
//! player count, and modifier badges. Users click to join/leave.
//! The lobby data and WebSocket management remain in TypeScript.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the public lobby component
pub fn register() {
    log::debug!("Registered <dioxus-public-lobby> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<PublicLobbyState>> = const { RefCell::new(None) };
    static LOBBY_DATA_SIGNAL: RefCell<Option<Signal<PublicLobbyData>>> = const { RefCell::new(None) };
    static JOINING_STATE_SIGNAL: RefCell<Option<Signal<JoiningState>>> = const { RefCell::new(None) };
}

// ============================================================================
// Data types
// ============================================================================

#[derive(Clone)]
struct PublicLobbyState {
    translations: PublicLobbyTranslations,
}

/// Translations from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicLobbyTranslations {
    pub join: String,
    pub started: String,
    pub starting_game: String,
    pub waiting_for_players: String,
    pub ffa: String,
    pub teams: String,
    pub teams_hvn: String,
    pub players_per_team: String,
}

/// Data for the current lobby to display
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicLobbyData {
    pub game_id: String,
    pub map_name: String,
    pub map_image_url: String,
    pub mode_label: String,
    pub time_display: String,
    pub time_remaining: i32,
    pub num_clients: u32,
    pub max_players: u32,
    pub modifier_labels: Vec<String>,
    pub is_visible: bool,
}

/// State for the joining animation
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JoiningState {
    pub is_joining: bool,
    pub is_highlighted: bool,
    pub dot_index: u8,
    pub is_starting: bool,
}

/// PublicLobby component props
#[derive(Props, Clone, PartialEq)]
pub struct PublicLobbyProps {
    pub translations: PublicLobbyTranslations,
}

// ============================================================================
// Event emitters
// ============================================================================

fn emit_custom_event(event_key: &str, payload: Value) {
    emit_ui_event(
        event_name(event_key),
        Some("component.public-lobby"),
        payload,
    );
}

fn emit_lobby_click(game_id: &str) {
    emit_custom_event(event_keys::UI_LOBBY_PUBLIC_CLICK, json!({ "gameId": game_id }));
}

// ============================================================================
// Main component
// ============================================================================

/// Main PublicLobby component
#[component]
pub fn PublicLobby(props: PublicLobbyProps) -> Element {
    let lobby_data = use_signal(PublicLobbyData::default);
    let joining_state = use_signal(JoiningState::default);

    // Store signals for external updates
    LOBBY_DATA_SIGNAL.with(|s| *s.borrow_mut() = Some(lobby_data));
    JOINING_STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(joining_state));

    let data = lobby_data();
    let join_state = joining_state();

    if !data.is_visible {
        return rsx! { div { class: "hidden" } };
    }

    let game_id = data.game_id.clone();
    let is_highlighted = join_state.is_highlighted;
    let is_joining = join_state.is_joining;
    let is_starting = join_state.is_starting;

    let highlight_class = if is_highlighted {
        "ring-2 ring-blue-600 scale-[1.01] opacity-70"
    } else {
        "hover:scale-[1.01]"
    };

    // Generate dot animation
    let dots: String = (0..3u8)
        .map(|i| {
            if i == join_state.dot_index {
                '\u{2022}'
            } else {
                '\u{00B7}'
            }
        })
        .collect();

    rsx! {
        button {
            class: "group relative isolate flex flex-col w-full h-80 lg:h-96 overflow-hidden rounded-2xl transition-all duration-200 bg-[#3d7bab] active:scale-[0.98] {highlight_class}",
            onclick: {
                let gid = game_id.clone();
                move |_| emit_lobby_click(&gid)
            },

            div {
                class: "font-sans w-full h-full flex flex-col",

                // Map image area
                div {
                    class: "flex-1 w-full relative overflow-hidden",
                    if !data.map_image_url.is_empty() {
                        img {
                            src: "{data.map_image_url}",
                            alt: "{data.map_name}",
                            class: "absolute inset-0 w-full h-full object-cover object-center z-10"
                        }
                    }
                    // Vignette overlay
                    div { class: "pointer-events-none absolute inset-0 z-20" }
                }

                // Mode badge in top left
                if !data.mode_label.is_empty() {
                    span {
                        class: "absolute top-4 left-4 px-4 py-1 rounded font-bold text-sm lg:text-base uppercase tracking-widest z-30 bg-slate-800 text-white ring-1 ring-white/10 shadow-sm",
                        "{data.mode_label}"
                    }
                }

                // Timer in top right
                if data.time_remaining > 0 {
                    span {
                        class: "absolute top-4 right-4 px-4 py-1 rounded font-bold text-sm lg:text-base tracking-widest z-30 bg-blue-600 text-white",
                        "{data.time_display}"
                    }
                } else {
                    span {
                        class: "absolute top-4 right-4 px-4 py-1 rounded font-bold text-sm lg:text-base uppercase tracking-widest z-30 bg-green-600 text-white",
                        "{props.translations.started}"
                    }
                }

                // Content banner
                div {
                    class: "absolute bottom-0 left-0 right-0 z-20",

                    // Modifier badges
                    if !data.modifier_labels.is_empty() {
                        div {
                            class: "absolute -top-8 left-4 z-30 flex gap-2 flex-wrap",
                            for label in data.modifier_labels.iter() {
                                span {
                                    class: "px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide bg-purple-600 text-white",
                                    "{label}"
                                }
                            }
                        }
                    }

                    // Gradient overlay
                    div {
                        class: "absolute inset-0 bg-gradient-to-b from-black/60 to-black/90 pointer-events-none"
                    }

                    div {
                        class: "relative p-6 flex flex-col gap-2 text-left",

                        // Status row
                        div {
                            class: "flex items-center justify-between w-full",

                            div {
                                class: "text-base uppercase tracking-widest text-white",
                                if is_joining {
                                    if is_starting {
                                        span {
                                            class: "text-green-400 animate-pulse",
                                            "{props.translations.starting_game}"
                                        }
                                    } else {
                                        span {
                                            class: "text-orange-400",
                                            "{props.translations.waiting_for_players} {dots}"
                                        }
                                    }
                                } else {
                                    "{props.translations.join}"
                                }
                            }

                            // Player count
                            div {
                                class: "flex items-center gap-2 text-white z-30",
                                span {
                                    class: "text-base font-bold uppercase tracking-widest",
                                    "{data.num_clients}/{data.max_players}"
                                }
                                svg {
                                    class: "w-5 h-5 text-white",
                                    fill: "currentColor",
                                    view_box: "0 0 20 20",
                                    path {
                                        d: "M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                                    }
                                }
                            }
                        }

                        // Map name
                        div {
                            class: "text-2xl lg:text-3xl font-bold text-white leading-none uppercase tracking-widest w-full",
                            "{data.map_name}"
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// Root component and WASM exports
// ============================================================================

fn PublicLobbyRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            PublicLobby {
                translations: state.translations,
            }
        },
        None => rsx! { div { class: "hidden" } },
    }
}

/// Launch the public lobby component
pub fn launch_public_lobby(translations_json: &str) {
    log::info!("Launching public lobby");

    let translations: PublicLobbyTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(PublicLobbyState { translations });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-public-lobby-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(PublicLobbyRoot);
}

/// Update lobby data
pub fn update_public_lobby_data(data_json: &str) {
    if let Ok(data) = serde_json::from_str::<PublicLobbyData>(data_json) {
        LOBBY_DATA_SIGNAL.with(|s| {
            if let Some(mut signal) = s.borrow().clone() {
                signal.set(data);
            }
        });
    }
}

/// Update joining state
pub fn update_public_lobby_joining(state_json: &str) {
    if let Ok(state) = serde_json::from_str::<JoiningState>(state_json) {
        JOINING_STATE_SIGNAL.with(|s| {
            if let Some(mut signal) = s.borrow().clone() {
                signal.set(state);
            }
        });
    }
}
