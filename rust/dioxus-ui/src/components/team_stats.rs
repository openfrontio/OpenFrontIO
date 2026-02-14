//! TeamStats component
//!
//! A table showing team aggregated data with:
//! - Team name, score %, gold, max troops columns (default view)
//! - Team name, launchers, SAMs, warships, cities columns (units view)
//! - Toggle button to switch between views
//!
//! This component uses the Dioxus Context API for state management.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the team_stats web component
pub fn register() {
    log::debug!("Registered <dioxus-team-stats> component");
}

/// Team entry received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatsEntry {
    pub team_name: String,
    pub is_my_team: bool,
    pub total_score_str: String,
    pub total_gold: String,
    pub total_max_troops: String,
    pub total_sams: String,
    pub total_launchers: String,
    pub total_war_ships: String,
    pub total_cities: String,
    pub total_score_sort: f64,
}

/// Translations received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatsTranslations {
    pub team: String,
    pub owned: String,
    pub gold: String,
    pub max_troops: String,
    pub launchers: String,
    pub sams: String,
    pub warships: String,
    pub cities: String,
    pub show_units: String,
    pub show_control: String,
}

// Minimal thread-local storage for initial state passing from launch_team_stats
// This is only used to pass data from the WASM launch function to the root component
thread_local! {
    static INITIAL_STATE: RefCell<Option<(Vec<TeamStatsEntry>, TeamStatsTranslations)>> =
        const { RefCell::new(None) };
    static ENTRIES_SIGNAL: RefCell<Option<Signal<Vec<TeamStatsEntry>>>> =
        const { RefCell::new(None) };
}

/// Store initial state for the team stats (used by launch_team_stats)
pub fn set_initial_state(entries: Vec<TeamStatsEntry>, translations: TeamStatsTranslations) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((entries, translations));
    });
}

/// Take the initial state (used by TeamStatsRoot)
pub fn take_initial_state() -> (Vec<TeamStatsEntry>, TeamStatsTranslations) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut()
            .take()
            .unwrap_or_else(|| (Vec::new(), TeamStatsTranslations::default()))
    })
}

/// Store the entries signal for external WASM updates
pub fn store_entries_signal(signal: Signal<Vec<TeamStatsEntry>>) {
    ENTRIES_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

/// TeamStats component props
///
/// Note: This props struct is kept for backward compatibility but
/// the component now primarily uses the Context API.
#[derive(Props, Clone, PartialEq)]
pub struct TeamStatsProps {
    #[props(default)]
    pub entries: Vec<TeamStatsEntry>,
    #[props(default)]
    pub translations: TeamStatsTranslations,
}

/// Main TeamStats component
///
/// This component reads its state from the TeamStatsContext provided
/// by the TeamStatsProvider component.
#[component]
pub fn TeamStats(props: TeamStatsProps) -> Element {
    // Try to get the context first (preferred way)
    // use_context returns the context directly, and will panic if not found
    // So we need to check if context exists using try_use_context
    let has_context = try_use_context::<crate::contexts::TeamStatsContext>().is_some();

    if has_context {
        let context = use_context::<crate::contexts::TeamStatsContext>();
        render_team_stats_with_context(context)
    } else {
        // Fallback: render with props (for standalone usage without context)
        render_team_stats_with_props(props)
    }
}

/// Render the team stats using context state
fn render_team_stats_with_context(context: crate::contexts::TeamStatsContext) -> Element {
    let entries = context.entries;
    let translations = context.translations;
    let mut show_units = context.show_units;

    let on_toggle = move |_| {
        show_units.set(!show_units());
    };

    rsx! {
        div {
            class: "max-h-[30vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm",
            oncontextmenu: move |e| e.prevent_default(),

            div {
                class: "grid bg-gray-800/70 w-full text-xs md:text-xs lg:text-sm",
                style: if show_units() { "grid-template-columns: 80px 50px 50px 50px 50px;" } else { "grid-template-columns: 80px 70px 55px 75px;" },

                // Header row
                div {
                    class: "contents font-bold bg-gray-700/50",

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                        "{translations().team}"
                    }

                    if show_units() {
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().launchers}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().sams}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().warships}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().cities}"
                        }
                    } else {
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().owned}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().gold}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations().max_troops}"
                        }
                    }
                }

                // Data rows
                for entry in entries() {
                    {
                        let row_class = if entry.is_my_team {
                            "contents hover:bg-slate-600/60 font-bold"
                        } else {
                            "contents hover:bg-slate-600/60"
                        };

                        if show_units() {
                            rsx! {
                                div {
                                    class: "{row_class}",

                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                                        "{entry.team_name}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_launchers}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_sams}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_war_ships}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_cities}"
                                    }
                                }
                            }
                        } else {
                            rsx! {
                                div {
                                    class: "{row_class}",

                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                                        "{entry.team_name}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_score_str}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_gold}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_max_troops}"
                                    }
                                }
                            }
                        }
                    }
                }
            }

            button {
                class: "mt-1 px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white mx-auto block",
                onclick: on_toggle,
                if show_units() {
                    "{translations().show_control}"
                } else {
                    "{translations().show_units}"
                }
            }
        }
    }
}

/// Render the team stats using props (fallback for non-context usage)
fn render_team_stats_with_props(props: TeamStatsProps) -> Element {
    let mut show_units = use_signal(|| false);
    let entries = use_signal(|| props.entries.clone());
    let translations = props.translations.clone();

    // Store the signal for external updates
    ENTRIES_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(entries);
    });

    let on_toggle = move |_| {
        show_units.set(!show_units());
    };

    rsx! {
        div {
            class: "max-h-[30vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm",
            oncontextmenu: move |e| e.prevent_default(),

            div {
                class: "grid bg-gray-800/70 w-full text-xs md:text-xs lg:text-sm",
                style: if show_units() { "grid-template-columns: 80px 50px 50px 50px 50px;" } else { "grid-template-columns: 80px 70px 55px 75px;" },

                // Header row
                div {
                    class: "contents font-bold bg-gray-700/50",

                    div {
                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                        "{translations.team}"
                    }

                    if show_units() {
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.launchers}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.sams}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.warships}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.cities}"
                        }
                    } else {
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.owned}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.gold}"
                        }
                        div {
                            class: "py-1 md:py-2 text-center border-b border-slate-500",
                            "{translations.max_troops}"
                        }
                    }
                }

                // Data rows
                for entry in entries() {
                    {
                        let row_class = if entry.is_my_team {
                            "contents hover:bg-slate-600/60 font-bold"
                        } else {
                            "contents hover:bg-slate-600/60"
                        };

                        if show_units() {
                            rsx! {
                                div {
                                    class: "{row_class}",

                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                                        "{entry.team_name}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_launchers}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_sams}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_war_ships}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_cities}"
                                    }
                                }
                            }
                        } else {
                            rsx! {
                                div {
                                    class: "{row_class}",

                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500 truncate",
                                        "{entry.team_name}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_score_str}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_gold}"
                                    }
                                    div {
                                        class: "py-1 md:py-2 text-center border-b border-slate-500",
                                        "{entry.total_max_troops}"
                                    }
                                }
                            }
                        }
                    }
                }
            }

            button {
                class: "mt-1 px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white mx-auto block",
                onclick: on_toggle,
                if show_units() {
                    "{translations.show_control}"
                } else {
                    "{translations.show_units}"
                }
            }
        }
    }
}

/// Launch the team stats component
///
/// This function is called from TypeScript to initialize and launch the team stats.
/// It stores the initial state in thread-local storage for the root component to consume.
pub fn launch_team_stats(entries_json: &str, translations_json: &str) {
    let entries: Vec<TeamStatsEntry> = serde_json::from_str(entries_json).unwrap_or_default();
    let translations: TeamStatsTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching team stats with {} entries", entries.len());

    // Store initial state in thread-local storage for TeamStatsRoot to consume
    set_initial_state(entries, translations);

    let config = dioxus::web::Config::new().rootname("dioxus-team-stats-root");

    // Launch the root component which will create the provider and context
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(crate::providers::TeamStatsRoot);
}

/// Update team stats entries (called from TypeScript on tick)
///
/// This function updates the entries signal stored in thread-local storage,
/// which triggers a re-render of the team stats component.
pub fn update_team_stats_entries(entries_json: &str) {
    log::debug!(
        "update_team_stats_entries called with JSON length: {}",
        entries_json.len()
    );

    let entries: Vec<TeamStatsEntry> = match serde_json::from_str(entries_json) {
        Ok(e) => e,
        Err(err) => {
            log::error!("Failed to parse team stats entries JSON: {}", err);
            log::error!(
                "JSON (first 500 chars): {}",
                &entries_json[..entries_json.len().min(500)]
            );
            return;
        }
    };

    let count = entries.len();
    log::debug!("Successfully parsed {} team stats entries", count);

    // Update the signal if it exists
    ENTRIES_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            log::info!("Updating team stats signal with {} entries", count);
            signal.set(entries);
        } else {
            log::warn!("ENTRIES_SIGNAL is None, cannot update team stats");
        }
    });
}
