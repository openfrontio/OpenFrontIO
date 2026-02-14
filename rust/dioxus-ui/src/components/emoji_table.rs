//! EmojiTable component
//!
//! An emoji picker modal that displays a grid of emojis.
//! When an emoji is clicked, it dispatches a custom event with the emoji index.
//! Backdrop clicks and close button dispatch a close event.

use dioxus::prelude::*;
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the emoji table web component
pub fn register() {
    log::debug!("Registered <dioxus-emoji-table> component");
}

// ── Internal state ───────────────────────────────────────────────

#[derive(Clone, Default)]
struct EmojiTableState {
    is_visible: bool,
    emojis: Vec<String>,
}

// ── Thread-local signals ─────────────────────────────────────────

thread_local! {
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static EMOJIS_SIGNAL: RefCell<Option<Signal<Vec<String>>>> = const { RefCell::new(None) };
    static INIT_STATE: RefCell<Option<EmojiTableInitState>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct EmojiTableInitState {
    emojis: Vec<String>,
}

// ── Event helpers ────────────────────────────────────────────────

fn emit_select(index: usize) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_EMOJI_TABLE_SELECT),
        Some("component.emoji-table"),
        json!({ "index": index }),
    );
}

fn emit_close() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_EMOJI_TABLE_CLOSE),
        Some("component.emoji-table"),
        json!({}),
    );
}

// ── Component ────────────────────────────────────────────────────

#[component]
pub fn EmojiTable() -> Element {
    let is_visible = use_signal(|| false);
    let mut emojis = use_signal(|| Vec::<String>::new());

    // Store signals in thread-locals for WASM API access
    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));
    EMOJIS_SIGNAL.with(|s| *s.borrow_mut() = Some(emojis));

    // Initialize emojis from init state on first render
    let init_emojis = INIT_STATE.with(|s| s.borrow().as_ref().map(|state| state.emojis.clone()));
    if let Some(init) = init_emojis {
        if emojis().is_empty() && !init.is_empty() {
            emojis.set(init);
        }
    }

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    let current_emojis = emojis();

    rsx! {
        // Full-screen backdrop
        div {
            class: "fixed inset-0 bg-black/15 backdrop-brightness-110 flex items-start sm:items-center justify-center z-[10002] pt-4 sm:pt-0",
            onclick: move |_| {
                emit_close();
            },

            div {
                class: "relative",

                // Close button
                button {
                    class: "absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center bg-zinc-700 hover:bg-red-500 text-white rounded-full shadow-sm transition-colors z-[10004]",
                    onclick: move |e| {
                        e.stop_propagation();
                        emit_close();
                    },
                    "\u{2715}"
                }

                // Emoji grid container
                div {
                    class: "bg-zinc-900/95 p-2 sm:p-3 rounded-[10px] z-[10003] shadow-2xl shadow-black/50 ring-1 ring-white/5 w-[calc(100vw-32px)] sm:w-100 max-h-[calc(100vh-60px)] overflow-y-auto",
                    oncontextmenu: move |e| {
                        e.prevent_default();
                    },
                    onclick: move |e| {
                        e.stop_propagation();
                    },

                    // Grid
                    div {
                        class: "grid grid-cols-5 gap-1 sm:gap-2",

                        for (i, emoji) in current_emojis.iter().enumerate() {
                            button {
                                key: "{i}",
                                class: "flex items-center justify-center cursor-pointer aspect-square border border-solid border-zinc-600 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-3xl sm:text-4xl transition-transform duration-300 hover:scale-110 active:scale-95",
                                onclick: {
                                    let idx = i;
                                    move |e| {
                                        e.stop_propagation();
                                        emit_select(idx);
                                    }
                                },
                                "{emoji}"
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Root wrapper ─────────────────────────────────────────────────

fn EmojiTableRoot() -> Element {
    rsx! {
        EmojiTable {}
    }
}

// ── WASM exports ─────────────────────────────────────────────────

pub fn launch_emoji_table(emojis_json: &str) {
    log::info!("Launching emoji table");
    let emojis: Vec<String> = match serde_json::from_str(emojis_json) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse emoji list: {}", e);
            Vec::new()
        }
    };
    INIT_STATE.with(|s| {
        *s.borrow_mut() = Some(EmojiTableInitState { emojis });
    });
    let config = dioxus::web::Config::new().rootname("dioxus-emoji-table-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(EmojiTableRoot);
}

pub fn show_emoji_table() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(true);
        }
    });
}

pub fn hide_emoji_table() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(false);
        }
    });
}
