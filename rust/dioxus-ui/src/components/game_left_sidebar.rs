//! GameLeftSidebar component
//!
//! A left sidebar with leaderboard/team stats toggle buttons.
//! Contains:
//! - Optional team label showing the player's team
//! - Toggle buttons for leaderboard and team stats panels
//! - Container divs for leaderboard and team stats children (managed by TS)

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<GameLeftSidebarState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameLeftSidebarState {
    is_visible: bool,
    is_leaderboard_show: bool,
    is_team_leaderboard_show: bool,
    is_team_game: bool,
    player_team_label_visible: bool,
    your_team_text: String,
    player_team_name: String,
    player_team_color: String,
    // Icon URLs
    leaderboard_regular_icon: String,
    leaderboard_solid_icon: String,
    team_regular_icon: String,
    team_solid_icon: String,
}

pub fn register() {
    log::debug!("Registered <dioxus-game-left-sidebar> component");
}

fn emit_event(event_key: &str) {
    emit_ui_event(
        event_name(event_key),
        Some("component.game-left-sidebar"),
        json!({}),
    );
}

#[component]
fn GameLeftSidebar() -> Element {
    let state = use_signal(GameLeftSidebarState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    let aside_class = if s.is_visible {
        "fixed top-4 left-4 z-1000 flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-slate-800/40 backdrop-blur-xs shadow-xs rounded-lg transition-transform duration-300 ease-out transform translate-x-0"
    } else {
        "fixed top-4 left-4 z-1000 flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-slate-800/40 backdrop-blur-xs shadow-xs rounded-lg transition-transform duration-300 ease-out transform hidden"
    };

    let toggle_bar_class = if s.is_leaderboard_show || s.is_team_leaderboard_show {
        "flex items-center gap-2 text-white mb-2"
    } else {
        "flex items-center gap-2 text-white"
    };

    let leaderboard_icon = if s.is_leaderboard_show {
        s.leaderboard_solid_icon.clone()
    } else {
        s.leaderboard_regular_icon.clone()
    };

    let team_icon = if s.is_team_leaderboard_show {
        s.team_solid_icon.clone()
    } else {
        s.team_regular_icon.clone()
    };

    rsx! {
        aside {
            class: "{aside_class}",

            // Optional team label
            if s.player_team_label_visible {
                div {
                    class: "flex items-center w-full h-8 lg:h-10 text-white py-1 lg:p-2",
                    oncontextmenu: move |e| e.prevent_default(),
                    "{s.your_team_text}"
                    span {
                        style: "color: {s.player_team_color};",
                        "\u{00a0}{s.player_team_name} \u{29BF}"
                    }
                }
            }

            // Toggle button bar
            div {
                class: "{toggle_bar_class}",

                // Leaderboard toggle
                div {
                    class: "cursor-pointer",
                    onclick: move |_| {
                        emit_event(event_keys::UI_INGAME_GAME_LEFT_SIDEBAR_TOGGLE_LEADERBOARD);
                    },
                    img {
                        src: "{leaderboard_icon}",
                        alt: "leaderboardIcon",
                        width: "20",
                        height: "20",
                    }
                }

                // Team toggle (only in team mode)
                if s.is_team_game {
                    div {
                        class: "cursor-pointer",
                        onclick: move |_| {
                            emit_event(event_keys::UI_INGAME_GAME_LEFT_SIDEBAR_TOGGLE_TEAM);
                        },
                        img {
                            src: "{team_icon}",
                            alt: "teamIcon",
                            width: "20",
                            height: "20",
                        }
                    }
                }
            }

            // Container divs for leaderboard and team stats children
            div {
                class: "block lg:flex flex-wrap gap-2",
                div { id: "leaderboard-container" }
                div { id: "team-stats-container", class: "flex-1" }
            }
        }
    }
}

fn GameLeftSidebarRoot() -> Element {
    rsx! { GameLeftSidebar {} }
}

pub fn launch_game_left_sidebar() {
    log::info!("Launching game left sidebar");
    let config = dioxus::web::Config::new().rootname("dioxus-game-left-sidebar-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(GameLeftSidebarRoot);
}

pub fn update_game_left_sidebar(state_json: &str) {
    let new_state: GameLeftSidebarState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse game left sidebar state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
