//! PlayerInfoOverlay component
//!
//! Displays player information when hovering over a tile.
//! Shows player name, troops, gold, unit counts, alliance info, etc.
//! The TS bridge gathers all data and coordinates; this component only renders.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<PlayerInfoOverlayState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerInfoOverlayState {
    is_visible: bool,
    is_active: bool,
    show_details: bool,
    // Content type
    content_type: String, // "player", "unit", "wilderness", "irradiated_wilderness", "none"
    // Wilderness translations
    wilderness_title: String,
    irradiated_title: String,
    // Player info
    player_name: String,
    player_flag: String,
    player_flag_is_custom: bool,
    is_friendly: bool,
    player_type_label: String,
    relation_class: String,
    relation_name: String,
    show_relation: bool,
    // Alliance info
    show_alliance: bool,
    alliance_icon: String,
    alliance_timeout_label: String,
    alliance_expiry_text: String,
    // Player icons
    player_icons: Vec<PlayerIcon>,
    // Troops & gold
    troops_label: String,
    troops: String,
    show_troops: bool,
    max_troops_label: String,
    max_troops: String,
    show_max_troops: bool,
    attacking_troops_label: String,
    attacking_troops: String,
    show_attacking_troops: bool,
    // Troop bar
    green_percent: f64,
    orange_percent: f64,
    // Gold
    gold_label: String,
    gold: String,
    gold_icon: String,
    // Unit counts
    unit_counts: Vec<UnitCount>,
    // Team
    team_label: String,
    team_name: String,
    show_team: bool,
    // Unit info (for water units)
    unit_owner_name: String,
    unit_is_ally: bool,
    unit_type_name: String,
    unit_has_health: bool,
    unit_health_label: String,
    unit_health: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerIcon {
    kind: String, // "emoji" or "image"
    text: String,
    src: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnitCount {
    icon: String,
    alt: String,
    count: String,
    is_disabled: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-player-info-overlay> component");
}

fn emit_toggle_details() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_PLAYER_INFO_TOGGLE_DETAILS),
        Some("component.player-info-overlay"),
        json!({}),
    );
}

#[component]
fn PlayerInfoOverlay() -> Element {
    let state = use_signal(PlayerInfoOverlayState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_active {
        return rsx! {};
    }

    let container_classes = if s.is_visible {
        "opacity-100 visible"
    } else {
        "opacity-0 invisible pointer-events-none"
    };

    rsx! {
        div {
            class: "block lg:flex fixed top-37.5 right-4 w-full z-50 flex-col max-w-45",
            oncontextmenu: |e| e.prevent_default(),
            div {
                class: "bg-gray-800/70 backdrop-blur-xs shadow-xs rounded-lg shadow-lg transition-all duration-300 text-white text-lg md:text-base {container_classes}",

                // Wilderness
                if s.content_type == "wilderness" {
                    div { class: "p-2 font-bold", "{s.wilderness_title}" }
                }
                if s.content_type == "irradiated_wilderness" {
                    div { class: "p-2 font-bold", "{s.irradiated_title}" }
                }

                // Player info
                if s.content_type == "player" {
                    div {
                        class: "p-2",
                        // Player name row
                        button {
                            class: "items-center text-bold text-sm lg:text-lg font-bold mb-1 inline-flex break-all",
                            class: if s.is_friendly { "text-green-500" } else { "text-white" },
                            onclick: move |_| emit_toggle_details(),

                            // Flag
                            if !s.player_flag.is_empty() {
                                if s.player_flag_is_custom {
                                    div {
                                        class: "h-8 mr-1 aspect-3/4 player-flag",
                                        // Custom flags rendered by TS bridge
                                    }
                                } else {
                                    img {
                                        class: "h-8 mr-1 aspect-3/4",
                                        src: "/flags/{s.player_flag}.svg",
                                    }
                                }
                            }

                            span { "{s.player_name}" }

                            // Player icons
                            if !s.player_icons.is_empty() {
                                span {
                                    class: "flex items-center gap-1 ml-1 shrink-0",
                                    for (i, icon) in s.player_icons.iter().enumerate() {
                                        if icon.kind == "emoji" {
                                            span {
                                                key: "{i}",
                                                class: "text-sm shrink-0",
                                                "translate": "no",
                                                "{icon.text}"
                                            }
                                        } else if icon.kind == "image" {
                                            img {
                                                key: "{i}",
                                                src: "{icon.src}",
                                                alt: "",
                                                class: "w-4 h-4 shrink-0",
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Collapsible details
                        if s.show_details {
                            // Team
                            if s.show_team {
                                div {
                                    class: "text-sm",
                                    "{s.team_label}: {s.team_name}"
                                }
                            }

                            // Player type & relation
                            div {
                                class: "flex text-sm",
                                "{s.player_type_label} "
                                if s.show_relation {
                                    span {
                                        class: "ml-auto mr-0 {s.relation_class}",
                                        "{s.relation_name}"
                                    }
                                }
                                if s.show_alliance {
                                    span {
                                        class: "flex gap-2 ml-auto mr-0 text-sm font-bold",
                                        img {
                                            src: "{s.alliance_icon}",
                                            alt: "{s.alliance_timeout_label}",
                                            width: "20",
                                            height: "20",
                                            class: "align-middle",
                                        }
                                        "{s.alliance_expiry_text}"
                                    }
                                }
                            }

                            // Troops
                            if s.show_troops {
                                div {
                                    class: "flex gap-2 text-sm",
                                    "translate": "no",
                                    "{s.troops_label}"
                                    span {
                                        class: "ml-auto mr-0 font-bold",
                                        "{s.troops}"
                                    }
                                }
                            }

                            // Max troops
                            if s.show_max_troops {
                                div {
                                    class: "flex gap-2 text-sm",
                                    "translate": "no",
                                    "{s.max_troops_label}"
                                    span {
                                        class: "ml-auto mr-0 font-bold",
                                        "{s.max_troops}"
                                    }
                                }
                            }

                            // Attacking troops
                            if s.show_attacking_troops {
                                div {
                                    class: "flex gap-2 text-sm",
                                    "translate": "no",
                                    "{s.attacking_troops_label}"
                                    span {
                                        class: "ml-auto mr-0 text-red-400 font-bold",
                                        "{s.attacking_troops}"
                                    }
                                }
                            }

                            // Troop bar
                            div {
                                class: "w-full mt-2 mb-2 h-5 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden",
                                div {
                                    class: "h-full flex",
                                    if s.green_percent > 0.0 {
                                        div {
                                            class: "h-full bg-green-500 transition-[width] duration-200",
                                            style: "width: {s.green_percent}%;",
                                        }
                                    }
                                    if s.orange_percent > 0.0 {
                                        div {
                                            class: "h-full bg-orange-400 transition-[width] duration-200",
                                            style: "width: {s.orange_percent}%;",
                                        }
                                    }
                                }
                            }

                            // Gold
                            div {
                                class: "flex p-1 mb-1 mt-1 w-full border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm",
                                "translate": "no",
                                img {
                                    src: "{s.gold_icon}",
                                    alt: "{s.gold_label}",
                                    width: "15",
                                    height: "15",
                                    class: "align-middle",
                                }
                                span {
                                    class: "w-full text-center",
                                    "{s.gold}"
                                }
                            }

                            // Unit counts
                            div {
                                class: "flex flex-wrap max-w-3xl gap-1",
                                for (i, uc) in s.unit_counts.iter().enumerate() {
                                    if !uc.is_disabled {
                                        div {
                                            key: "{i}",
                                            class: "flex p-1 w-[calc(50%-0.13rem)] border rounded-md border-gray-500 items-center gap-2 text-sm",
                                            "translate": "no",
                                            img {
                                                src: "{uc.icon}",
                                                width: "20",
                                                height: "20",
                                                alt: "{uc.alt}",
                                                class: "align-middle",
                                            }
                                            span {
                                                class: "w-full text-right p-1",
                                                "{uc.count}"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Unit info (water units)
                if s.content_type == "unit" {
                    div {
                        class: "p-2",
                        div {
                            class: "font-bold mb-1",
                            class: if s.unit_is_ally { "text-green-500" } else { "text-white" },
                            "{s.unit_owner_name}"
                        }
                        div {
                            class: "mt-1",
                            div { class: "text-sm opacity-80", "{s.unit_type_name}" }
                            if s.unit_has_health {
                                div {
                                    class: "text-sm",
                                    "{s.unit_health_label}: {s.unit_health}"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn PlayerInfoOverlayRoot() -> Element {
    rsx! { PlayerInfoOverlay {} }
}

pub fn launch_player_info_overlay() {
    log::info!("Launching player info overlay");
    let config = dioxus::web::Config::new().rootname("dioxus-player-info-overlay-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(PlayerInfoOverlayRoot);
}

pub fn update_player_info_overlay(state_json: &str) {
    let new_state: PlayerInfoOverlayState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse player info overlay state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
