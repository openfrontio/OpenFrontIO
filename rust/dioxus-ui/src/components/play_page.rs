//! PlayPage component
//!
//! The main play/lobby page that contains:
//! - Header/identity section with username, flag, pattern inputs
//! - Hamburger menu button (mobile)
//! - Public lobby card
//! - Custom game buttons (solo, create, join)
//! - Matchmaking buttons
//!
//! Navigation and routing stay in the TS bridge; this handles rendering.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use web_sys::{CustomEvent, CustomEventInit};

thread_local! {
    static STATE: RefCell<Option<Signal<PlayPageState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayPageState {
    is_visible: bool,
    /// i18n text for the "Custom Games" header
    host_label: String,
    /// i18n text for solo button
    solo_text: String,
    /// i18n text for create button
    create_text: String,
    /// i18n text for join button
    join_text: String,
    /// i18n text for ranked play button
    play_ranked_text: String,
    /// i18n text for ranked play description
    play_ranked_desc: String,
    /// i18n text for login required
    login_required_text: String,
    /// Whether the user is logged in (show ranked vs login-required)
    is_logged_in: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-play-page> component");
}

fn emit_event(name: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) = CustomEvent::new_with_event_init_dict(name, &init) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

#[component]
fn PlayPage() -> Element {
    let state = use_signal(PlayPageState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let current = state();

    if !current.is_visible {
        return rsx! {};
    }

    rsx! {
        div {
            id: "page-play",
            class: "flex flex-col gap-2 w-full max-w-6xl mx-auto px-0 sm:px-4 transition-all duration-300 my-auto min-h-0",

            // Slot for token-login (TS manages this)
            div { id: "dioxus-play-page-token-login-slot", class: "absolute" }

            // Header / Identity Section
            div {
                class: "grid grid-cols-1 lg:grid-cols-12 gap-2 lg:gap-6 w-full",

                // Left: hamburger + username + pattern (mobile)
                div {
                    class: "lg:col-span-9 flex flex-row flex-nowrap gap-x-2 h-[60px] items-center bg-slate-900/80 backdrop-blur-md p-3 rounded-xl relative z-20 text-sm sm:text-base shrink-0",

                    // Hamburger (mobile only)
                    div {
                        class: "h-[40px] sm:h-[50px] shrink-0 aspect-[4/3] flex items-center justify-center lg:hidden",
                        button {
                            id: "hamburger-btn",
                            class: "lg:hidden flex w-full h-full bg-slate-800/40 text-white/90 hover:bg-slate-700/40 p-0 rounded-md items-center justify-center cursor-pointer transition-all duration-200",
                            "aria-expanded": "false",
                            "aria-controls": "sidebar-menu",
                            "aria-haspopup": "dialog",
                            onclick: move |_| emit_event("dioxus-play-page-hamburger"),
                            svg {
                                xmlns: "http://www.w3.org/2000/svg",
                                fill: "none",
                                view_box: "0 0 24 24",
                                stroke_width: "1.5",
                                stroke: "currentColor",
                                class: "w-8 h-8",
                                path {
                                    stroke_linecap: "round",
                                    stroke_linejoin: "round",
                                    d: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
                                }
                            }
                        }
                    }

                    // Username slot
                    div {
                        class: "flex-1 min-w-0 h-[40px] sm:h-[50px] flex items-center",
                        div { id: "dioxus-play-page-username-slot", class: "relative w-full h-full block text-ellipsis overflow-hidden whitespace-nowrap" }
                    }

                    // Pattern button (mobile - inside bar)
                    div {
                        id: "dioxus-play-page-pattern-mobile-slot",
                        class: "aspect-square h-[50px] sm:h-[50px] lg:hidden shrink-0",
                    }
                }

                // Right: pattern & flag (desktop only)
                div {
                    class: "hidden lg:flex lg:col-span-3",
                    div {
                        class: "w-full h-[60px] flex gap-2",
                        div { id: "dioxus-play-page-pattern-desktop-slot", class: "flex-1 h-full" }
                        div { id: "dioxus-play-page-flag-desktop-slot", class: "flex-1 h-full" }
                    }
                }
            }

            // Primary Game Actions Area
            div {
                class: "grid grid-cols-1 lg:grid-cols-12 gap-6 w-full",

                // Left: public lobby
                div {
                    class: "lg:col-span-9 flex flex-col gap-6 min-w-0",
                    div { id: "dioxus-play-page-public-lobby-slot", class: "block w-full transition-all duration-[50ms]" }
                }

                // Right: custom games
                div {
                    class: "lg:col-span-3",
                    div {
                        class: "group relative isolate flex flex-col w-full h-40 lg:h-96 overflow-hidden rounded-2xl transition-all duration-300",
                        div {
                            class: "h-full flex flex-col bg-slate-900/40 backdrop-blur-sm rounded-2xl overflow-hidden",
                            div {
                                class: "py-2 bg-blue-900/20 text-center text-sm font-bold text-gray-300 uppercase tracking-widest",
                                "{current.host_label}"
                            }
                            div {
                                class: "flex-1 p-2 flex flex-row lg:flex-col gap-2",
                                // Solo button
                                button {
                                    id: "single-player",
                                    class: "flex-1 transition-transform bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg cursor-pointer",
                                    onclick: move |_| emit_event("dioxus-play-page-solo"),
                                    "{current.solo_text}"
                                }
                                // Create lobby button
                                button {
                                    id: "host-lobby-button",
                                    class: "flex-1 opacity-90 hover:opacity-100 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg cursor-pointer",
                                    onclick: move |_| emit_event("dioxus-play-page-create"),
                                    "{current.create_text}"
                                }
                                // Join private lobby button
                                button {
                                    id: "join-private-lobby-button",
                                    class: "flex-1 opacity-90 hover:opacity-100 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg cursor-pointer",
                                    onclick: move |_| emit_event("dioxus-play-page-join"),
                                    "{current.join_text}"
                                }
                            }
                        }
                    }
                }

                // Matchmaking buttons (full width)
                div {
                    class: "lg:col-span-12 flex flex-col gap-6",

                    // Not logged in button
                    if !current.is_logged_in {
                        button {
                            id: "matchmaking-button-logged-out",
                            class: "w-full h-20 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest rounded-xl transition-all duration-200 flex flex-col items-center justify-center overflow-hidden relative cursor-pointer",
                            onclick: move |_| emit_event("dioxus-play-page-matchmaking-logged-out"),
                            span {
                                class: "relative z-10 text-2xl",
                                "{current.login_required_text}"
                            }
                        }
                    }

                    // Logged in button
                    if current.is_logged_in {
                        button {
                            id: "matchmaking-button",
                            class: "w-full h-20 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest rounded-xl transition-all duration-200 flex flex-col items-center justify-center group overflow-hidden relative cursor-pointer",
                            onclick: move |_| emit_event("dioxus-play-page-matchmaking"),
                            span {
                                class: "relative z-10 text-2xl",
                                "{current.play_ranked_text}"
                            }
                            span {
                                class: "relative z-10 text-xs font-medium text-purple-100 opacity-90 group-hover:opacity-100 transition-opacity",
                                "{current.play_ranked_desc}"
                            }
                        }
                    }
                }
            }
        }
    }
}

fn PlayPageRoot() -> Element {
    rsx! { PlayPage {} }
}

pub fn launch_play_page() {
    log::info!("Launching play page");
    let config = dioxus::web::Config::new().rootname("dioxus-play-page-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(PlayPageRoot);
}

pub fn update_play_page(state_json: &str) {
    let new_state: PlayPageState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse play page state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
