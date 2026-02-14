//! ReplayPanel component
//!
//! A panel with speed buttons for controlling replay or singleplayer game speed.
//! Displays 4 speed options: ×0.5, ×1, ×2, Max (translated).

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<ReplayPanelState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ReplayPanelState {
    is_visible: bool,
    label: String,
    selected_speed: u8,
    speed_labels: Vec<String>,
}

pub fn register() {
    log::debug!("Registered <dioxus-replay-panel> component");
}

fn dispatch_speed_event(index: u8) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_REPLAY_PANEL_SPEED),
        Some("component.replay-panel"),
        json!({ "index": index }),
    );
}

#[component]
fn ReplayPanel() -> Element {
    let state = use_signal(ReplayPanelState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_visible {
        return rsx! {};
    }

    rsx! {
        div {
            class: "p-2 bg-gray-800/70 backdrop-blur-xs shadow-xs rounded-lg",
            oncontextmenu: move |e| e.prevent_default(),

            label {
                class: "block mb-2 text-white",
                translate: "no",
                "{s.label}"
            }

            div {
                class: "grid grid-cols-4 gap-2",
                for (i, speed_label) in s.speed_labels.iter().enumerate() {
                    {
                        let idx = i as u8;
                        let is_selected = idx == s.selected_speed;
                        let base_class = "py-0.5 px-1 text-sm text-white rounded-sm border transition border-gray-500 hover:border-gray-200";
                        let class = if is_selected {
                            format!("{base_class} bg-blue-400")
                        } else {
                            base_class.to_string()
                        };

                        rsx! {
                            button {
                                key: "{i}",
                                class: "{class}",
                                onclick: move |_| {
                                    dispatch_speed_event(idx);
                                },
                                "{speed_label}"
                            }
                        }
                    }
                }
            }
        }
    }
}

fn ReplayPanelRoot() -> Element {
    rsx! { ReplayPanel {} }
}

pub fn launch_replay_panel() {
    log::info!("Launching replay panel");
    let config = dioxus::web::Config::new().rootname("dioxus-replay-panel-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(ReplayPanelRoot);
}

pub fn update_replay_panel(state_json: &str) {
    let new_state: ReplayPanelState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse replay panel state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
