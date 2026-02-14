//! EventsDisplay component
//!
//! Displays game events, incoming/outgoing attacks, boats, and betrayal debuff timers
//! in a collapsible panel on the bottom-right. The TS bridge processes all game updates,
//! filters, and serializes event entries; this component only renders.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<EventsDisplayState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsDisplayState {
    is_visible: bool,
    is_hidden: bool,
    new_events: u32,
    // Gold animation
    latest_gold_amount: Option<String>,
    gold_animating: bool,
    // Filter icons
    sword_icon: String,
    nuke_icon: String,
    donate_gold_icon: String,
    alliance_icon: String,
    chat_icon: String,
    // Filter states (true = filtered out)
    attack_filtered: bool,
    nuke_filtered: bool,
    trade_filtered: bool,
    alliance_filtered: bool,
    chat_filtered: bool,
    // Events
    events: Vec<EventEntry>,
    // Incoming attacks
    incoming_attacks: Vec<AttackEntry>,
    // Outgoing attacks
    outgoing_attacks: Vec<AttackEntry>,
    // Outgoing land attacks
    outgoing_land_attacks: Vec<AttackEntry>,
    // Boats
    outgoing_boats: Vec<BoatEntry>,
    // Betrayal debuff
    show_betrayal_debuff: bool,
    betrayal_debuff_text: String,
    // Translations
    hide_label: String,
    retreating_label: String,
    retaliate_label: String,
    wilderness_label: String,
    boat_label: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventEntry {
    description: String,
    is_html: bool,
    css_class: String,
    has_focus: bool,
    focus_id: Option<u32>,
    has_unit_focus: bool,
    unit_id: Option<u32>,
    buttons: Vec<EventButton>,
    index: u32,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventButton {
    text: String,
    btn_class: String, // "green", "blue", "gray"
    action_id: String,
    prevent_close: bool,
    event_index: u32,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttackEntry {
    id: String,
    troops: String,
    target_name: String,
    retreating: bool,
    attacker_id: Option<u32>,
    is_incoming: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoatEntry {
    id: u32,
    troops: String,
    retreating: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-events-display> component");
}

fn emit_no_payload(event_key: &str) {
    emit_ui_event(
        event_name(event_key),
        Some("component.events-display"),
        json!({}),
    );
}

fn emit_payload(event_key: &str, payload: serde_json::Value) {
    emit_ui_event(
        event_name(event_key),
        Some("component.events-display"),
        payload,
    );
}

const GOLD_BOUNCE_STYLE: &str = r#"
@keyframes goldBounce {
    0% { transform: scale(1); }
    30% { transform: scale(1.3); }
    50% { transform: scale(1.1); }
    70% { transform: scale(1.2); }
    100% { transform: scale(1); }
}
"#;

#[component]
fn EventsDisplay() -> Element {
    let state = use_signal(EventsDisplayState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_visible {
        return rsx! {
            style { {GOLD_BOUNCE_STYLE} }
        };
    }

    // Hidden toggle mode
    if s.is_hidden {
        return rsx! {
            style { {GOLD_BOUNCE_STYLE} }
            div {
                class: "relative w-fit lg:bottom-4 lg:right-4 z-50",
                button {
                    class: "text-white cursor-pointer pointer-events-auto w-fit p-2 lg:p-3 rounded-lg bg-gray-800/70 backdrop-blur-sm",
                    onclick: move |_| emit_no_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_TOGGLE_HIDDEN),
                    "Events"
                    if s.new_events > 0 {
                        span {
                            class: "inline-block px-2 bg-red-500 rounded-lg text-sm ml-1",
                            "{s.new_events}"
                        }
                    }
                }
            }
        };
    }

    let has_content = !s.events.is_empty()
        || !s.incoming_attacks.is_empty()
        || !s.outgoing_attacks.is_empty()
        || !s.outgoing_land_attacks.is_empty()
        || !s.outgoing_boats.is_empty()
        || s.show_betrayal_debuff;

    rsx! {
        style { {GOLD_BOUNCE_STYLE} }
        div {
            class: "relative w-full sm:bottom-4 sm:right-4 z-50 sm:w-96 backdrop-blur-sm",

            // Button bar
            div {
                class: "w-full p-2 lg:p-3 bg-gray-800/70 rounded-t-lg",
                div {
                    class: "flex justify-between items-center",
                    // Filter toggles
                    div {
                        class: "flex gap-4",
                        {render_filter_btn(&s.sword_icon, s.attack_filtered, "attack")}
                        {render_filter_btn(&s.nuke_icon, s.nuke_filtered, "nuke")}
                        {render_filter_btn(&s.donate_gold_icon, s.trade_filtered, "trade")}
                        {render_filter_btn(&s.alliance_icon, s.alliance_filtered, "alliance")}
                        {render_filter_btn(&s.chat_icon, s.chat_filtered, "chat")}
                    }
                    div {
                        class: "flex items-center gap-3",
                        // Gold amount
                        if let Some(ref gold) = s.latest_gold_amount {
                            span {
                                class: "text-green-400 font-semibold transition-all duration-300",
                                class: if s.gold_animating { "animate-pulse scale-110" } else { "scale-100" },
                                style: if s.gold_animating { "animation: goldBounce 0.6s ease-out" } else { "animation: none" },
                                "+{gold}"
                            }
                        }
                        button {
                            class: "text-white cursor-pointer pointer-events-auto",
                            onclick: move |_| emit_no_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_TOGGLE_HIDDEN),
                            "{s.hide_label}"
                        }
                    }
                }
            }

            // Content area
            div {
                class: "bg-gray-800/70 max-h-[30vh] overflow-y-auto w-full h-full sm:rounded-b-lg events-container",
                div {
                    table {
                        class: "w-full max-h-none border-collapse text-white shadow-lg lg:text-base text-md md:text-xs pointer-events-auto",
                        tbody {
                            // Events
                            for entry in s.events.iter() {
                                tr {
                                    key: "{entry.index}",
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 text-left {entry.css_class}",
                                        // Clickable description
                                        if entry.has_focus {
                                            button {
                                                class: "text-left",
                                                onclick: {
                                                    let fid = entry.focus_id.unwrap_or(0);
                                                    move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_FOCUS_PLAYER, json!({ "playerId": fid }))
                                                },
                                                if entry.is_html {
                                                    span { dangerous_inner_html: "{entry.description}" }
                                                } else {
                                                    "{entry.description}"
                                                }
                                            }
                                        } else if entry.has_unit_focus {
                                            button {
                                                class: "text-left",
                                                onclick: {
                                                    let uid = entry.unit_id.unwrap_or(0);
                                                    move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_FOCUS_UNIT, json!({ "unitId": uid }))
                                                },
                                                if entry.is_html {
                                                    span { dangerous_inner_html: "{entry.description}" }
                                                } else {
                                                    "{entry.description}"
                                                }
                                            }
                                        } else {
                                            if entry.is_html {
                                                span { dangerous_inner_html: "{entry.description}" }
                                            } else {
                                                "{entry.description}"
                                            }
                                        }

                                        // Event buttons
                                        if !entry.buttons.is_empty() {
                                            div {
                                                class: "flex flex-wrap gap-1.5 mt-1",
                                                for btn in entry.buttons.iter() {
                                                    button {
                                                        class: format!(
                                                            "inline-block px-3 py-1 text-white rounded-sm text-md md:text-sm cursor-pointer transition-colors duration-300 {}",
                                                            match btn.btn_class.as_str() {
                                                                "blue" => "bg-blue-500 hover:bg-blue-600",
                                                                "gray" => "bg-gray-500 hover:bg-gray-600",
                                                                _ => "bg-green-600 hover:bg-green-700",
                                                            }
                                                        ),
                                                        onclick: {
                                                            let action = btn.action_id.clone();
                                                            move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_BUTTON_CLICK, json!({ "actionId": action }))
                                                        },
                                                        "{btn.text}"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Incoming attacks
                            if !s.incoming_attacks.is_empty() {
                                tr {
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 text-left",
                                        div {
                                            class: "flex flex-wrap gap-y-1 gap-x-2",
                                            for atk in s.incoming_attacks.iter() {
                                                div {
                                                    key: "{atk.id}",
                                                    class: "inline-flex items-center gap-1",
                                                    button {
                                                        class: "text-left text-red-400",
                                                        "translate": "no",
                                                        onclick: {
                                                            let aid = atk.id.clone();
                                                            move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_ATTACK_CLICK, json!({ "attackId": aid }))
                                                        },
                                                        "{atk.troops} {atk.target_name}"
                                                        if atk.retreating {
                                                            " ({s.retreating_label}...)"
                                                        }
                                                    }
                                                    if !atk.retreating {
                                                        button {
                                                            class: "inline-block px-3 py-1 text-white rounded-sm text-md md:text-sm cursor-pointer transition-colors duration-300 bg-red-600 hover:bg-red-700",
                                                            onclick: {
                                                                let aid = atk.id.clone();
                                                                move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_RETALIATE, json!({ "attackId": aid }))
                                                            },
                                                            "{s.retaliate_label}"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Betrayal debuff timer
                            if s.show_betrayal_debuff {
                                tr {
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 text-left",
                                        button {
                                            class: "text-left text-yellow-400",
                                            "translate": "no",
                                            "{s.betrayal_debuff_text}"
                                        }
                                    }
                                }
                            }

                            // Outgoing attacks
                            if !s.outgoing_attacks.is_empty() {
                                tr {
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 text-left",
                                        div {
                                            class: "flex flex-wrap gap-y-1 gap-x-2",
                                            for atk in s.outgoing_attacks.iter() {
                                                div {
                                                    key: "{atk.id}",
                                                    class: "inline-flex items-center gap-1",
                                                    button {
                                                        class: "text-left text-blue-400",
                                                        "translate": "no",
                                                        onclick: {
                                                            let aid = atk.id.clone();
                                                            move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_ATTACK_CLICK, json!({ "attackId": aid }))
                                                        },
                                                        "{atk.troops} {atk.target_name}"
                                                    }
                                                    if !atk.retreating {
                                                        button {
                                                            class: "text-left shrink-0",
                                                            onclick: {
                                                                let aid = atk.id.clone();
                                                                move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_CANCEL_ATTACK, json!({ "attackId": aid }))
                                                            },
                                                            "\u{274C}"
                                                        }
                                                    } else {
                                                        span {
                                                            class: "shrink-0 text-blue-400",
                                                            "({s.retreating_label}...)"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Outgoing land attacks
                            if !s.outgoing_land_attacks.is_empty() {
                                tr {
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 text-left",
                                        div {
                                            class: "flex flex-wrap gap-y-1 gap-x-2",
                                            for atk in s.outgoing_land_attacks.iter() {
                                                div {
                                                    key: "{atk.id}",
                                                    class: "inline-flex items-center gap-1",
                                                    button {
                                                        class: "text-left text-gray-400",
                                                        "translate": "no",
                                                        "{atk.troops} {s.wilderness_label}"
                                                    }
                                                    if !atk.retreating {
                                                        button {
                                                            class: "text-left shrink-0",
                                                            onclick: {
                                                                let aid = atk.id.clone();
                                                                move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_CANCEL_ATTACK, json!({ "attackId": aid }))
                                                            },
                                                            "\u{274C}"
                                                        }
                                                    } else {
                                                        span {
                                                            class: "shrink-0 text-blue-400",
                                                            "({s.retreating_label}...)"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Boats
                            if !s.outgoing_boats.is_empty() {
                                tr {
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 text-left",
                                        div {
                                            class: "flex flex-wrap gap-y-1 gap-x-2",
                                            for boat in s.outgoing_boats.iter() {
                                                div {
                                                    key: "{boat.id}",
                                                    class: "inline-flex items-center gap-1",
                                                    button {
                                                        class: "text-left text-blue-400",
                                                        "translate": "no",
                                                        onclick: {
                                                            let bid = boat.id;
                                                            move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_FOCUS_BOAT, json!({ "boatId": bid }))
                                                        },
                                                        "{s.boat_label}: {boat.troops}"
                                                    }
                                                    if !boat.retreating {
                                                        button {
                                                            class: "text-left shrink-0",
                                                            onclick: {
                                                                let bid = boat.id;
                                                                move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_CANCEL_BOAT, json!({ "boatId": bid }))
                                                            },
                                                            "\u{274C}"
                                                        }
                                                    } else {
                                                        span {
                                                            class: "shrink-0 text-blue-400",
                                                            "({s.retreating_label}...)"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Empty row when nothing to show
                            if !has_content {
                                tr {
                                    td {
                                        class: "lg:px-2 lg:py-1 p-1 min-w-72 text-left",
                                        "\u{00A0}"
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

fn render_filter_btn(icon_src: &str, is_filtered: bool, category: &str) -> Element {
    let cat = category.to_string();
    let style = if is_filtered {
        "filter: grayscale(1) opacity(0.5);"
    } else {
        ""
    };
    rsx! {
        button {
            class: "cursor-pointer pointer-events-auto",
            onclick: move |_| emit_payload(event_keys::UI_INGAME_EVENTS_DISPLAY_TOGGLE_FILTER, json!({ "category": cat })),
            img {
                src: icon_src,
                class: "h-5",
                style: style,
            }
        }
    }
}

fn EventsDisplayRoot() -> Element {
    rsx! { EventsDisplay {} }
}

pub fn launch_events_display() {
    log::info!("Launching events display");
    let config = dioxus::web::Config::new().rootname("dioxus-events-display-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(EventsDisplayRoot);
}

pub fn update_events_display(state_json: &str) {
    let new_state: EventsDisplayState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse events display state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
