//! ControlPanel component
//!
//! Displays player stats (troops, gold) and an attack ratio slider.
//! The slider dispatches a CustomEvent so the TypeScript bridge can update game state.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<ControlPanelState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPanelState {
    is_visible: bool,
    troops: String,
    max_troops: String,
    troop_rate: String,
    troop_rate_increasing: bool,
    gold: String,
    attack_ratio: f64,
    attack_troops: String,
    troops_label: String,
    gold_label: String,
    attack_ratio_label: String,
}

pub fn register() {
    log::debug!("Registered <dioxus-control-panel> component");
}

fn emit_ratio_change(ratio: i32) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_CONTROL_PANEL_RATIO_CHANGE),
        Some("component.control-panel"),
        json!({ "ratio": ratio }),
    );
}

const SLIDER_STYLE: &str = r#"
input[type="range"].cp-attack-ratio {
    -webkit-appearance: none;
    background: transparent;
    outline: none;
}
input[type="range"].cp-attack-ratio::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: white;
    border-width: 2px;
    border-style: solid;
    border-color: rgb(239 68 68);
    border-radius: 50%;
    cursor: pointer;
}
input[type="range"].cp-attack-ratio::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: white;
    border-width: 2px;
    border-style: solid;
    border-color: rgb(239 68 68);
    border-radius: 50%;
    cursor: pointer;
}
"#;

#[component]
fn ControlPanel() -> Element {
    let state = use_signal(ControlPanelState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_visible {
        return rsx! {
            style { {SLIDER_STYLE} }
            div { class: "hidden" }
        };
    }

    let ratio_percent = (s.attack_ratio * 100.0).round() as i32;
    let fill_width = format!("{}%", ratio_percent);

    rsx! {
        style { {SLIDER_STYLE} }
        div {
            class: "pointer-events-auto w-full sm:max-w-[320px] text-sm sm:text-base bg-gray-800/70 p-2 pr-3 sm:p-4 shadow-lg sm:rounded-lg backdrop-blur-sm",
            oncontextmenu: |e| e.prevent_default(),

            // Stats block
            div {
                class: "block bg-black/30 text-white mb-4 p-2 rounded-sm",

                // Troops row
                div {
                    class: "flex justify-between mb-1",
                    span {
                        class: "font-bold",
                        "{s.troops_label}:"
                    }
                    span {
                        "translate": "no",
                        "{s.troops} / {s.max_troops} "
                        span {
                            class: if s.troop_rate_increasing { "text-green-500" } else { "text-yellow-500" },
                            "translate": "no",
                            "(+{s.troop_rate})"
                        }
                    }
                }

                // Gold row
                div {
                    class: "flex justify-between",
                    span {
                        class: "font-bold",
                        "{s.gold_label}:"
                    }
                    span {
                        "translate": "no",
                        "{s.gold}"
                    }
                }
            }

            // Attack ratio slider
            div {
                class: "relative mb-0 sm:mb-4",

                label {
                    class: "block text-white mb-1",
                    "{s.attack_ratio_label} : "
                    span {
                        class: "inline-flex items-center gap-1 [unicode-bidi:isolate]",
                        dir: "ltr",
                        "translate": "no",
                        span { "{ratio_percent}%" }
                        span { "({s.attack_troops})" }
                    }
                }

                div {
                    class: "relative h-8",

                    // Background track
                    div {
                        class: "absolute left-0 right-0 top-3 h-2 bg-white/20 rounded-sm",
                    }

                    // Fill track
                    div {
                        class: "absolute left-0 top-3 h-2 bg-red-500/60 rounded-sm transition-all duration-300",
                        style: "width: {fill_width};",
                    }

                    // Range input
                    input {
                        id: "attack-ratio",
                        r#type: "range",
                        min: "1",
                        max: "100",
                        value: "{ratio_percent}",
                        class: "absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer cp-attack-ratio",
                        style: "width: 100%;",
                        oninput: move |e| {
                            if let Ok(val) = e.value().parse::<i32>() {
                                emit_ratio_change(val);
                            }
                        },
                    }
                }
            }
        }
    }
}

fn ControlPanelRoot() -> Element {
    rsx! { ControlPanel {} }
}

pub fn launch_control_panel() {
    log::info!("Launching control panel");
    let config = dioxus::web::Config::new().rootname("dioxus-control-panel-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(ControlPanelRoot);
}

pub fn update_control_panel(state_json: &str) {
    let new_state: ControlPanelState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse control panel state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
