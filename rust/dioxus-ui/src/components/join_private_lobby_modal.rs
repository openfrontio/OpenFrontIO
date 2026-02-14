//! JoinPrivateLobbyModal component
//!
//! A modal for joining private game lobbies. Displays a lobby ID input field,
//! paste button, and join button. Once joined, shows game config and player list.
//! All API calls and lobby logic are handled by the TypeScript bridge.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the join private lobby modal component
pub fn register() {
    log::debug!("Registered <dioxus-join-private-lobby-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<JoinPrivateLobbyModalState>> = const { RefCell::new(None) };
    static IS_OPEN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static HAS_JOINED_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static LOBBY_ID_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static CONFIG_HTML_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static PLAYERS_HTML_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct JoinPrivateLobbyModalState {
    translations: JoinPrivateLobbyTranslations,
}

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinPrivateLobbyTranslations {
    pub title: String,
    pub enter_id: String,
    pub paste: String,
    pub join_lobby: String,
    pub joined_waiting: String,
    pub back: String,
}

/// JoinPrivateLobbyModal component props
#[derive(Props, Clone, PartialEq)]
pub struct JoinPrivateLobbyModalProps {
    pub translations: JoinPrivateLobbyTranslations,
}

/// Emit event to request joining a lobby
fn emit_join_lobby(lobby_id: &str) {
    emit_ui_event(
        event_name(event_keys::UI_LOBBY_JOIN_PRIVATE_JOIN_LOBBY),
        Some("component.join-private-lobby-modal"),
        json!({ "lobbyId": lobby_id }),
    );
}

/// Emit event to request pasting from clipboard
fn emit_paste_request() {
    emit_ui_event(
        event_name(event_keys::UI_LOBBY_JOIN_PRIVATE_PASTE_REQUEST),
        Some("component.join-private-lobby-modal"),
        json!({}),
    );
}

/// Emit close event
fn emit_modal_close() {
    emit_ui_event(
        event_name(event_keys::UI_LOBBY_JOIN_PRIVATE_CLOSE_REQUEST),
        Some("component.join-private-lobby-modal"),
        json!({}),
    );
}

/// Main JoinPrivateLobbyModal component
#[component]
pub fn JoinPrivateLobbyModal(props: JoinPrivateLobbyModalProps) -> Element {
    let is_open = use_signal(|| false);
    let has_joined = use_signal(|| false);
    let mut lobby_id = use_signal(|| String::new());
    let config_html = use_signal(|| String::new());
    let players_html = use_signal(|| String::new());

    // Store signals for external updates
    IS_OPEN_SIGNAL.with(|s| *s.borrow_mut() = Some(is_open));
    HAS_JOINED_SIGNAL.with(|s| *s.borrow_mut() = Some(has_joined));
    LOBBY_ID_SIGNAL.with(|s| *s.borrow_mut() = Some(lobby_id));
    CONFIG_HTML_SIGNAL.with(|s| *s.borrow_mut() = Some(config_html));
    PLAYERS_HTML_SIGNAL.with(|s| *s.borrow_mut() = Some(players_html));

    let on_close = move |_| {
        emit_modal_close();
    };

    // Handle escape key
    use_effect(move || {
        let is_open_val = is_open();
        if !is_open_val {
            return;
        }
        // Escape key handling is done via global listener
    });

    if !is_open() {
        return rsx! { div { class: "hidden" } };
    }

    let on_join = move |_| {
        let id = lobby_id();
        if !id.trim().is_empty() {
            emit_join_lobby(&id);
        }
    };

    let on_paste = move |_| {
        emit_paste_request();
    };

    let on_keyup = move |e: KeyboardEvent| {
        if e.key() == Key::Enter {
            let id = lobby_id();
            if !id.trim().is_empty() {
                emit_join_lobby(&id);
            }
        }
    };

    rsx! {
        // Backdrop
        div {
            class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]",
            onclick: on_close,
        }
        // Modal
        div {
            class: "fixed inset-4 md:inset-8 lg:inset-16 z-[9999] flex items-center justify-center pointer-events-none",
            div {
                class: "w-full max-w-2xl max-h-full bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden pointer-events-auto flex flex-col select-none",
                onclick: |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center gap-3 p-4 border-b border-white/10 shrink-0",
                    button {
                        class: "w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors",
                        onclick: on_close,
                        "aria-label": "{props.translations.back}",
                        svg {
                            xmlns: "http://www.w3.org/2000/svg",
                            fill: "none",
                            "viewBox": "0 0 24 24",
                            "stroke-width": "2",
                            stroke: "currentColor",
                            class: "w-5 h-5 text-white",
                            path {
                                "stroke-linecap": "round",
                                "stroke-linejoin": "round",
                                d: "M15.75 19.5L8.25 12l7.5-7.5"
                            }
                        }
                    }
                    h2 {
                        class: "text-xl font-bold text-white flex-1",
                        "{props.translations.title}"
                    }
                }

                // Content
                div {
                    class: "flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 mr-1",

                    // Join form (only shown before joining)
                    if !has_joined() {
                        div {
                            class: "flex flex-col gap-3",
                            div {
                                class: "flex gap-2",
                                input {
                                    r#type: "text",
                                    placeholder: "{props.translations.enter_id}",
                                    value: "{lobby_id}",
                                    oninput: move |e| { lobby_id.set(e.value()); },
                                    onkeyup: on_keyup,
                                    class: "flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm tracking-wider",
                                }
                                button {
                                    onclick: on_paste,
                                    class: "px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all group",
                                    title: "{props.translations.paste}",
                                    svg {
                                        class: "text-white/60 group-hover:text-white transition-colors",
                                        stroke: "currentColor",
                                        fill: "currentColor",
                                        "stroke-width": "0",
                                        "viewBox": "0 0 32 32",
                                        height: "18px",
                                        width: "18px",
                                        xmlns: "http://www.w3.org/2000/svg",
                                        path {
                                            d: "M 15 3 C 13.742188 3 12.847656 3.890625 12.40625 5 L 5 5 L 5 28 L 13 28 L 13 30 L 27 30 L 27 14 L 25 14 L 25 5 L 17.59375 5 C 17.152344 3.890625 16.257813 3 15 3 Z M 15 5 C 15.554688 5 16 5.445313 16 6 L 16 7 L 19 7 L 19 9 L 11 9 L 11 7 L 14 7 L 14 6 C 14 5.445313 14.445313 5 15 5 Z M 7 7 L 9 7 L 9 11 L 21 11 L 21 7 L 23 7 L 23 14 L 13 14 L 13 26 L 7 26 Z M 15 16 L 25 16 L 25 28 L 15 28 Z"
                                        }
                                    }
                                }
                            }
                            button {
                                class: "w-full py-3 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40",
                                onclick: on_join,
                                "{props.translations.join_lobby}"
                            }
                        }
                    }

                    // Game config (rendered as HTML from TS bridge)
                    if !config_html().is_empty() {
                        div {
                            dangerous_inner_html: "{config_html()}"
                        }
                    }

                    // Players list (rendered as HTML from TS bridge)
                    if !players_html().is_empty() {
                        div {
                            dangerous_inner_html: "{players_html()}"
                        }
                    }
                }

                // Waiting footer (shown after joining)
                if has_joined() && !players_html().is_empty() {
                    div {
                        class: "p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0",
                        button {
                            class: "w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-blue-900/20",
                            disabled: true,
                            "{props.translations.joined_waiting}"
                        }
                    }
                }
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn JoinPrivateLobbyModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            JoinPrivateLobbyModal {
                translations: state.translations,
            }
        },
        None => rsx! {
            div { class: "hidden" }
        },
    }
}

/// Launch the join private lobby modal component
pub fn launch_join_private_lobby_modal(translations_json: &str) {
    log::info!("Launching join private lobby modal");

    let translations: JoinPrivateLobbyTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            return;
        }
    };

    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(JoinPrivateLobbyModalState { translations });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-join-private-lobby-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(JoinPrivateLobbyModalRoot);
}

/// Open the modal
pub fn open_join_private_lobby_modal() {
    log::debug!("open_join_private_lobby_modal called");

    // Reset state when opening
    HAS_JOINED_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(false);
        }
    });
    LOBBY_ID_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(String::new());
        }
    });
    CONFIG_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(String::new());
        }
    });
    PLAYERS_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(String::new());
        }
    });

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Opening join private lobby modal");
            signal.set(true);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot open modal");
        }
    });
}

/// Close the modal
pub fn close_join_private_lobby_modal() {
    log::debug!("close_join_private_lobby_modal called");

    IS_OPEN_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Closing join private lobby modal");
            signal.set(false);
        } else {
            log::warn!("IS_OPEN_SIGNAL is None, cannot close modal");
        }
    });
}

/// Update the joined state and lobby info
pub fn update_join_private_lobby_joined(has_joined: bool) {
    HAS_JOINED_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(has_joined);
        }
    });
}

/// Update the lobby ID input
pub fn update_join_private_lobby_id(lobby_id: &str) {
    LOBBY_ID_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(lobby_id.to_string());
        }
    });
}

/// Update the game config HTML
pub fn update_join_private_lobby_config_html(html: &str) {
    CONFIG_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(html.to_string());
        }
    });
}

/// Update the players HTML
pub fn update_join_private_lobby_players_html(html: &str) {
    PLAYERS_HTML_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(html.to_string());
        }
    });
}
