//! Leaderboard component
//!
//! A sortable table showing player rankings with:
//! - Position, name, tiles%, gold, max troops columns
//! - Sortable headers (click to sort)
//! - Row click to navigate to player
//! - Toggle to show top 5 or all players
//!
//! This component uses the Dioxus Context API for state management.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the leaderboard web component
pub fn register() {
    log::debug!("Registered <dioxus-leader-board> component");
}

/// Player entry received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub tiles_percent: f64,
    pub tiles_display: String,
    pub gold: f64,
    pub gold_display: String,
    pub max_troops: f64,
    pub max_troops_display: String,
    pub is_my_player: bool,
    pub is_on_same_team: bool,
}

/// Translations received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardTranslations {
    pub player: String,
    pub owned: String,
    pub gold: String,
    pub max_troops: String,
}

/// Sort state
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SortKey {
    Tiles,
    Gold,
    MaxTroops,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SortOrder {
    Asc,
    Desc,
}

// Minimal thread-local storage for initial state passing from launch_leaderboard
// This is only used to pass data from the WASM launch function to the root component
thread_local! {
    static INITIAL_STATE: RefCell<Option<(Vec<LeaderboardEntry>, LeaderboardTranslations, bool)>> =
        const { RefCell::new(None) };
    static ENTRIES_SIGNAL: RefCell<Option<Signal<Vec<LeaderboardEntry>>>> =
        const { RefCell::new(None) };
}

/// Store initial state for the leaderboard (used by launch_leaderboard)
pub fn set_initial_state(
    entries: Vec<LeaderboardEntry>,
    translations: LeaderboardTranslations,
    show_top_five: bool,
) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((entries, translations, show_top_five));
    });
}

/// Take the initial state (used by LeaderboardRoot)
pub fn take_initial_state() -> (Vec<LeaderboardEntry>, LeaderboardTranslations, bool) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut()
            .take()
            .unwrap_or_else(|| (Vec::new(), LeaderboardTranslations::default(), false))
    })
}

/// Store the entries signal for external WASM updates
pub fn store_entries_signal(signal: Signal<Vec<LeaderboardEntry>>) {
    ENTRIES_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

/// Emit row click event
fn emit_row_click(player_id: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_LEADERBOARD_ROW_CLICK),
        Some("component.leaderboard"),
        json!({ "playerId": player_id }),
    );
}

/// Emit sort change event
fn emit_sort_change(sort_key: SortKey, sort_order: SortOrder) {
    let key_str = match sort_key {
        SortKey::Tiles => "tiles",
        SortKey::Gold => "gold",
        SortKey::MaxTroops => "maxtroops",
    };
    let order_str = match sort_order {
        SortOrder::Asc => "asc",
        SortOrder::Desc => "desc",
    };
    emit_ui_event(
        event_name(event_keys::UI_INGAME_LEADERBOARD_SORT),
        Some("component.leaderboard"),
        json!({
            "sortKey": key_str,
            "sortOrder": order_str,
        }),
    );
}

/// Emit toggle event
fn emit_toggle() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_LEADERBOARD_TOGGLE),
        Some("component.leaderboard"),
        json!({}),
    );
}

/// Leaderboard component props
///
/// Note: This props struct is kept for backward compatibility but
/// the component now primarily uses the Context API.
#[derive(Props, Clone, PartialEq)]
pub struct LeaderboardProps {
    pub entries: Vec<LeaderboardEntry>,
    pub translations: LeaderboardTranslations,
    pub show_top_five: bool,
}

/// Main Leaderboard component
///
/// This component reads its state from the LeaderboardContext provided
/// by the LeaderboardProvider component.
#[component]
pub fn Leaderboard(props: LeaderboardProps) -> Element {
    // Try to get the context first (preferred way)
    // use_context returns the context directly if found, or panics if not found
    // We need to handle this more carefully - check if context exists first
    let has_context = try_use_context::<crate::contexts::LeaderboardContext>().is_some();

    if has_context {
        let context = use_context::<crate::contexts::LeaderboardContext>();
        render_leaderboard_with_context(context)
    } else {
        // Fallback: render with props (for standalone usage without context)
        render_leaderboard_with_props(props)
    }
}
/// Render the leaderboard using context state
fn render_leaderboard_with_context(context: crate::contexts::LeaderboardContext) -> Element {
    let entries = context.entries;
    let translations = context.translations;
    let mut sort_key = context.sort_key;
    let mut sort_order = context.sort_order;
    let mut show_top_five = context.show_top_five;

    // Sort handlers for each column
    let on_sort_tiles = move |_| {
        let key = SortKey::Tiles;
        if sort_key() == key {
            let new_order = if sort_order() == SortOrder::Asc {
                SortOrder::Desc
            } else {
                SortOrder::Asc
            };
            sort_order.set(new_order);
            emit_sort_change(key, new_order);
        } else {
            sort_key.set(key);
            sort_order.set(SortOrder::Desc);
            emit_sort_change(key, SortOrder::Desc);
        }
    };

    let on_sort_gold = move |_| {
        let key = SortKey::Gold;
        if sort_key() == key {
            let new_order = if sort_order() == SortOrder::Asc {
                SortOrder::Desc
            } else {
                SortOrder::Asc
            };
            sort_order.set(new_order);
            emit_sort_change(key, new_order);
        } else {
            sort_key.set(key);
            sort_order.set(SortOrder::Desc);
            emit_sort_change(key, SortOrder::Desc);
        }
    };

    let on_sort_max_troops = move |_| {
        let key = SortKey::MaxTroops;
        if sort_key() == key {
            let new_order = if sort_order() == SortOrder::Asc {
                SortOrder::Desc
            } else {
                SortOrder::Asc
            };
            sort_order.set(new_order);
            emit_sort_change(key, new_order);
        } else {
            sort_key.set(key);
            sort_order.set(SortOrder::Desc);
            emit_sort_change(key, SortOrder::Desc);
        }
    };

    let on_toggle = move |_| {
        show_top_five.set(!show_top_five());
        emit_toggle();
    };

    // Sort indicators
    let tiles_indicator = if sort_key() == SortKey::Tiles {
        if sort_order() == SortOrder::Asc {
            " ⬆️"
        } else {
            " ⬇️"
        }
    } else {
        ""
    };

    let gold_indicator = if sort_key() == SortKey::Gold {
        if sort_order() == SortOrder::Asc {
            " ⬆️"
        } else {
            " ⬇️"
        }
    } else {
        ""
    };

    let max_troops_indicator = if sort_key() == SortKey::MaxTroops {
        if sort_order() == SortOrder::Asc {
            " ⬆️"
        } else {
            " ⬇️"
        }
    } else {
        ""
    };

    rsx! {
        div {
            class: "max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh]",

            div {
                class: "grid bg-gray-800/70 w-full text-xs md:text-xs lg:text-sm",
                style: "grid-template-columns: 30px 100px 70px 55px 105px;",

                // Header row
                div {
                    class: "contents font-bold bg-gray-700/50",

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                        "#"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                        "{translations().player}"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate",
                        onclick: on_sort_tiles,
                        "{translations().owned}{tiles_indicator}"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate",
                        onclick: on_sort_gold,
                        "{translations().gold}{gold_indicator}"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate",
                        onclick: on_sort_max_troops,
                        "{translations().max_troops}{max_troops_indicator}"
                    }
                }

                // Data rows
                for entry in entries() {
                    {
                        let entry_id = entry.id.clone();
                        let row_class = if entry.is_on_same_team {
                            "contents hover:bg-slate-600/60 font-bold cursor-pointer"
                        } else {
                            "contents hover:bg-slate-600/60 cursor-pointer"
                        };

                        rsx! {
                            div {
                                class: "{row_class}",
                                onclick: move |_| emit_row_click(&entry_id),

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.position}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                                    "{entry.name}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.tiles_display}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.gold_display}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.max_troops_display}"
                                }
                            }
                        }
                    }
                }
            }

            button {
                class: "mt-1 px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white mx-auto block",
                onclick: on_toggle,
                if show_top_five() { "+" } else { "-" }
            }
        }
    }
}

/// Render the leaderboard using props (fallback for non-context usage)
fn render_leaderboard_with_props(props: LeaderboardProps) -> Element {
    let mut sort_key = use_signal(|| SortKey::Tiles);
    let mut sort_order = use_signal(|| SortOrder::Desc);
    let mut show_top_five = use_signal(|| props.show_top_five);
    let entries = use_signal(|| props.entries.clone());
    let translations = props.translations.clone();

    // Store the signal for external updates
    ENTRIES_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(entries);
    });

    // Sort handlers for each column
    let on_sort_tiles = move |_| {
        let key = SortKey::Tiles;
        if sort_key() == key {
            let new_order = if sort_order() == SortOrder::Asc {
                SortOrder::Desc
            } else {
                SortOrder::Asc
            };
            sort_order.set(new_order);
            emit_sort_change(key, new_order);
        } else {
            sort_key.set(key);
            sort_order.set(SortOrder::Desc);
            emit_sort_change(key, SortOrder::Desc);
        }
    };

    let on_sort_gold = move |_| {
        let key = SortKey::Gold;
        if sort_key() == key {
            let new_order = if sort_order() == SortOrder::Asc {
                SortOrder::Desc
            } else {
                SortOrder::Asc
            };
            sort_order.set(new_order);
            emit_sort_change(key, new_order);
        } else {
            sort_key.set(key);
            sort_order.set(SortOrder::Desc);
            emit_sort_change(key, SortOrder::Desc);
        }
    };

    let on_sort_max_troops = move |_| {
        let key = SortKey::MaxTroops;
        if sort_key() == key {
            let new_order = if sort_order() == SortOrder::Asc {
                SortOrder::Desc
            } else {
                SortOrder::Asc
            };
            sort_order.set(new_order);
            emit_sort_change(key, new_order);
        } else {
            sort_key.set(key);
            sort_order.set(SortOrder::Desc);
            emit_sort_change(key, SortOrder::Desc);
        }
    };

    let on_toggle = move |_| {
        show_top_five.set(!show_top_five());
        emit_toggle();
    };

    // Sort indicators
    let tiles_indicator = if sort_key() == SortKey::Tiles {
        if sort_order() == SortOrder::Asc {
            " ⬆️"
        } else {
            " ⬇️"
        }
    } else {
        ""
    };

    let gold_indicator = if sort_key() == SortKey::Gold {
        if sort_order() == SortOrder::Asc {
            " ⬆️"
        } else {
            " ⬇️"
        }
    } else {
        ""
    };

    let max_troops_indicator = if sort_key() == SortKey::MaxTroops {
        if sort_order() == SortOrder::Asc {
            " ⬆️"
        } else {
            " ⬇️"
        }
    } else {
        ""
    };

    rsx! {
        div {
            class: "max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh]",

            div {
                class: "grid bg-gray-800/70 w-full text-xs md:text-xs lg:text-sm",
                style: "grid-template-columns: 30px 100px 70px 55px 105px;",

                // Header row
                div {
                    class: "contents font-bold bg-gray-700/50",

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                        "#"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                        "{translations.player}"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate",
                        onclick: on_sort_tiles,
                        "{translations.owned}{tiles_indicator}"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate",
                        onclick: on_sort_gold,
                        "{translations.gold}{gold_indicator}"
                    }

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate",
                        onclick: on_sort_max_troops,
                        "{translations.max_troops}{max_troops_indicator}"
                    }
                }

                // Data rows
                for entry in entries() {
                    {
                        let entry_id = entry.id.clone();
                        let row_class = if entry.is_on_same_team {
                            "contents hover:bg-slate-600/60 font-bold cursor-pointer"
                        } else {
                            "contents hover:bg-slate-600/60 cursor-pointer"
                        };

                        rsx! {
                            div {
                                class: "{row_class}",
                                onclick: move |_| emit_row_click(&entry_id),

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.position}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                                    "{entry.name}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.tiles_display}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.gold_display}"
                                }

                                div {
                                    class: "py-1 md:py-2 text-center border-b border-slate-500",
                                    "{entry.max_troops_display}"
                                }
                            }
                        }
                    }
                }
            }

            button {
                class: "mt-1 px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white mx-auto block",
                onclick: on_toggle,
                if show_top_five() { "+" } else { "-" }
            }
        }
    }
}

/// Launch the leaderboard component
///
/// This function is called from TypeScript to initialize and launch the leaderboard.
/// It stores the initial state in thread-local storage for the root component to consume.
pub fn launch_leaderboard(entries_json: &str, translations_json: &str, show_top_five: bool) {
    let entries: Vec<LeaderboardEntry> = serde_json::from_str(entries_json).unwrap_or_default();
    let translations: LeaderboardTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching leaderboard with {} entries", entries.len());

    // Store initial state in thread-local storage for LeaderboardRoot to consume
    set_initial_state(entries, translations, show_top_five);

    let config = dioxus::web::Config::new().rootname("dioxus-leaderboard-root");

    // Launch the root component which will create the provider and context
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(crate::providers::LeaderboardRoot);
}

/// Update leaderboard entries (called from TypeScript on tick)
///
/// This function updates the entries signal stored in thread-local storage,
/// which triggers a re-render of the leaderboard component.
pub fn update_leaderboard_entries(entries_json: &str) {
    log::debug!(
        "update_leaderboard_entries called with JSON length: {}",
        entries_json.len()
    );

    let entries: Vec<LeaderboardEntry> = match serde_json::from_str(entries_json) {
        Ok(e) => e,
        Err(err) => {
            log::error!("Failed to parse leaderboard entries JSON: {}", err);
            log::error!(
                "JSON (first 500 chars): {}",
                &entries_json[..entries_json.len().min(500)]
            );
            return;
        }
    };

    let count = entries.len();
    log::debug!("Successfully parsed {} entries", count);

    // Update the signal if it exists
    ENTRIES_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Updating leaderboard signal with {} entries", count);
            signal.set(entries);
        } else {
            log::warn!("ENTRIES_SIGNAL is None, cannot update leaderboard");
        }
    });
}
