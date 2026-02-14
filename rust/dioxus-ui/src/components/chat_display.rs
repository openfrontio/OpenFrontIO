//! ChatDisplay component
//!
//! Displays in-game chat messages in a collapsible panel.
//! TS bridge filters messages and serializes entries; this component only renders.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<ChatDisplayState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatDisplayState {
    is_visible: bool,
    is_hidden: bool,
    new_events: u32,
    entries: Vec<ChatEntry>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatEntry {
    description: String,
    is_html: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-chat-display> component");
}

fn emit_toggle_hidden() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_CHAT_DISPLAY_TOGGLE),
        Some("component.chat-display"),
        json!({}),
    );
}

#[component]
fn ChatDisplay() -> Element {
    let state = use_signal(ChatDisplayState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_visible {
        return rsx! {};
    }

    if s.is_hidden {
        return rsx! {
            div {
                class: "pointer-events-auto w-fit px-2.5 py-1.25 rounded-md bg-black/60 relative max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw] lg:w-full lg:w-auto",
                button {
                    class: "text-white cursor-pointer pointer-events-auto",
                    onclick: move |_| emit_toggle_hidden(),
                    "Chat"
                    if s.new_events > 0 {
                        span {
                            class: "inline-block px-2 bg-red-500 rounded-xs ml-1",
                            "{s.new_events}"
                        }
                    }
                }
            }
        };
    }

    rsx! {
        div {
            class: "pointer-events-auto rounded-md bg-black/60 relative max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw] lg:w-full lg:w-auto",
            div {
                div {
                    class: "w-full bg-black/80 sticky top-0 px-2.5",
                    button {
                        class: "text-white cursor-pointer pointer-events-auto",
                        onclick: move |_| emit_toggle_hidden(),
                        "Hide"
                    }
                }
                table {
                    class: "w-full border-collapse text-white shadow-lg lg:text-xl text-xs pointer-events-none",
                    tbody {
                        for (i, entry) in s.entries.iter().enumerate() {
                            tr {
                                key: "{i}",
                                class: "border-b border-gray-200/0",
                                td {
                                    class: "lg:p-3 p-1 text-left",
                                    if entry.is_html {
                                        span {
                                            dangerous_inner_html: "{entry.description}",
                                        }
                                    } else {
                                        "{entry.description}"
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

fn ChatDisplayRoot() -> Element {
    rsx! { ChatDisplay {} }
}

pub fn launch_chat_display() {
    log::info!("Launching chat display");
    let config = dioxus::web::Config::new().rootname("dioxus-chat-display-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(ChatDisplayRoot);
}

pub fn update_chat_display(state_json: &str) {
    let new_state: ChatDisplayState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse chat display state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
