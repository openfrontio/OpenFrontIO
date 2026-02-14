//! Stats Modal (Clan Leaderboard) component
//!
//! A modal that displays clan leaderboard statistics:
//! - Sortable table by rank, games, wins, losses, ratio
//! - Loading, error, and empty states
//! - Date range display
//! All API/fetch logic stays in TypeScript.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the stats modal component
pub fn register() {
    log::debug!("Registered <stats-modal> component");
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsModalState {
    pub is_visible: bool,
    pub is_loading: bool,
    pub error: Option<String>,
    pub date_range: Option<String>,
    pub sort_by: String,
    pub sort_order: String,
    pub clans: Vec<ClanEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClanEntry {
    pub clan_tag: String,
    pub games: u32,
    pub weighted_wins: f64,
    pub weighted_losses: f64,
    pub weighted_wl_ratio: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsModalTranslations {
    pub clan_stats: String,
    pub loading: String,
    pub error_text: String,
    pub try_again: String,
    pub no_data_yet: String,
    pub no_stats: String,
    pub rank: String,
    pub clan: String,
    pub games: String,
    pub win_score: String,
    pub win_score_tooltip: String,
    pub loss_score: String,
    pub loss_score_tooltip: String,
    pub win_loss_ratio: String,
    pub ratio: String,
    pub close: String,
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<StatsModalState>>> =
        const { RefCell::new(None) };
    static INITIAL_STATE: RefCell<Option<(StatsModalState, StatsModalTranslations)>> =
        const { RefCell::new(None) };
}

pub fn set_initial_state(state: StatsModalState, translations: StatsModalTranslations) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((state, translations));
    });
}

pub fn take_initial_state() -> (StatsModalState, StatsModalTranslations) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                StatsModalState::default(),
                StatsModalTranslations::default(),
            )
        })
    })
}

pub fn store_state_signal(signal: Signal<StatsModalState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub use store_state_signal as stats_modal_store_state_signal;
pub use take_initial_state as stats_modal_take_initial_state;

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

fn emit_close() {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-stats-modal-close", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_sort(column: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from_str(column));
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-stats-modal-sort", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_retry() {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) =
                CustomEvent::new_with_event_init_dict("dioxus-stats-modal-retry", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct StatsModalProps {
    pub state: StatsModalState,
    pub translations: StatsModalTranslations,
}

#[component]
pub fn StatsModal(props: StatsModalProps) -> Element {
    let mut state = use_signal(|| props.state.clone());
    let translations = props.translations.clone();

    // Store signal for external updates
    STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(state));

    let on_close = move |_| {
        state.write().is_visible = false;
        emit_close();
    };

    if !state().is_visible {
        return rsx! { div { class: "hidden" } };
    }

    let current = state();

    rsx! {
        // Backdrop
        div {
            class: "fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4",
            onclick: on_close,

            // Modal
            div {
                class: "relative bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 max-w-4xl w-full max-h-[90vh] overflow-hidden text-white",
                onclick: move |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center justify-between p-4 border-b border-white/10",
                    div {
                        class: "flex flex-wrap items-center gap-2",
                        button {
                            class: "text-white/60 hover:text-white transition-colors",
                            aria_label: "{translations.close}",
                            onclick: on_close,
                            svg {
                                xmlns: "http://www.w3.org/2000/svg",
                                class: "h-6 w-6",
                                fill: "none",
                                view_box: "0 0 24 24",
                                stroke: "currentColor",
                                path {
                                    stroke_linecap: "round",
                                    stroke_linejoin: "round",
                                    stroke_width: "2",
                                    d: "M15 19l-7-7 7-7",
                                }
                            }
                        }
                        span {
                            class: "text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest",
                            "{translations.clan_stats}"
                        }
                        if let Some(ref date_range) = current.date_range {
                            span {
                                class: "text-sm font-normal text-white/40 ml-2 break-words",
                                "({date_range})"
                            }
                        }
                    }
                }

                // Body
                div {
                    class: "flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent px-6 pb-6 mr-1",
                    {render_body(&current, &translations)}
                }
            }
        }
    }
}

fn render_body(state: &StatsModalState, translations: &StatsModalTranslations) -> Element {
    if state.is_loading {
        return rsx! {
            div {
                class: "flex flex-col items-center justify-center p-12 text-white h-full",
                div {
                    class: "w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-6",
                }
                p {
                    class: "text-blue-200/80 text-sm font-bold tracking-[0.2em] uppercase",
                    "{translations.loading}"
                }
            }
        };
    }

    if let Some(ref error) = state.error {
        return rsx! {
            div {
                class: "flex flex-col items-center justify-center p-12 text-white h-full",
                div {
                    class: "bg-red-500/10 p-6 rounded-full mb-6 border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)]",
                    svg {
                        xmlns: "http://www.w3.org/2000/svg",
                        class: "h-12 w-12 text-red-500",
                        fill: "none",
                        view_box: "0 0 24 24",
                        stroke: "currentColor",
                        path {
                            stroke_linecap: "round",
                            stroke_linejoin: "round",
                            stroke_width: "1.5",
                            d: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
                        }
                    }
                }
                p {
                    class: "mb-8 text-center text-red-100/80 max-w-xs font-medium",
                    "{error}"
                }
                button {
                    class: "px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-200 rounded-xl text-sm font-bold uppercase tracking-wider transition-all cursor-pointer hover:shadow-lg hover:shadow-red-500/10 active:scale-95",
                    onclick: move |_| emit_retry(),
                    "{translations.try_again}"
                }
            }
        };
    }

    if state.clans.is_empty() {
        return rsx! {
            div {
                class: "p-12 text-center text-white/40 flex flex-col items-center h-full justify-center",
                div {
                    class: "bg-white/5 p-6 rounded-full mb-6 border border-white/5",
                    svg {
                        xmlns: "http://www.w3.org/2000/svg",
                        class: "h-16 w-16 text-white/20",
                        fill: "none",
                        view_box: "0 0 24 24",
                        stroke: "currentColor",
                        path {
                            stroke_linecap: "round",
                            stroke_linejoin: "round",
                            stroke_width: "1",
                            d: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
                        }
                    }
                }
                h3 {
                    class: "text-xl font-bold text-white/60 mb-2",
                    "{translations.no_data_yet}"
                }
                p {
                    class: "text-white/30 text-sm max-w-[200px]",
                    "{translations.no_stats}"
                }
            }
        };
    }

    let max_games = state
        .clans
        .iter()
        .map(|c| c.games)
        .max()
        .unwrap_or(1)
        .max(1);
    let sort_by = state.sort_by.clone();
    let sort_order = state.sort_order.clone();

    let sort_indicator = |col: &str| -> Element {
        if sort_by == col {
            if sort_order == "asc" {
                rsx! { span { class: "text-blue-400", dangerous_inner_html: "&#x2191;" } }
            } else {
                rsx! { span { class: "text-blue-400", dangerous_inner_html: "&#x2193;" } }
            }
        } else {
            rsx! { span { class: "text-white/20", dangerous_inner_html: "&#x2195;" } }
        }
    };

    rsx! {
        div {
            class: "w-full pt-6",
            div {
                class: "overflow-x-auto rounded-xl border border-white/5 bg-black/20",
                table {
                    class: "w-full text-sm border-collapse",
                    thead {
                        tr {
                            class: "text-white/40 text-xs uppercase tracking-wider border-b border-white/5 bg-white/[0.02]",
                            th { class: "py-4 px-4 text-center font-bold w-16", "{translations.rank}" }
                            th { class: "py-4 px-4 text-left font-bold", "{translations.clan}" }
                            th {
                                class: "py-4 px-4 text-right font-bold w-32 cursor-pointer hover:text-white/60 transition-colors select-none",
                                onclick: move |_| emit_sort("games"),
                                div {
                                    class: "flex items-center justify-end gap-1",
                                    "{translations.games}"
                                    {sort_indicator("games")}
                                }
                            }
                            th {
                                class: "py-4 px-4 text-right font-bold hidden md:table-cell cursor-pointer hover:text-white/60 transition-colors select-none",
                                title: "{translations.win_score_tooltip}",
                                onclick: move |_| emit_sort("wins"),
                                div {
                                    class: "flex items-center justify-end gap-1",
                                    "{translations.win_score}"
                                    {sort_indicator("wins")}
                                }
                            }
                            th {
                                class: "py-4 px-4 text-right font-bold hidden md:table-cell cursor-pointer hover:text-white/60 transition-colors select-none",
                                title: "{translations.loss_score_tooltip}",
                                onclick: move |_| emit_sort("losses"),
                                div {
                                    class: "flex items-center justify-end gap-1",
                                    "{translations.loss_score}"
                                    {sort_indicator("losses")}
                                }
                            }
                            th {
                                class: "py-4 px-4 text-right font-bold pr-6 cursor-pointer hover:text-white/60 transition-colors select-none",
                                onclick: move |_| emit_sort("ratio"),
                                div {
                                    class: "flex items-center justify-end gap-1",
                                    "{translations.win_loss_ratio}"
                                    {sort_indicator("ratio")}
                                }
                            }
                        }
                    }
                    tbody {
                        {state.clans.iter().enumerate().map(|(index, clan)| {
                            let rank_color = match index {
                                0 => "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20",
                                1 => "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20",
                                2 => "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20",
                                _ => "text-white/40 bg-white/5",
                            };
                            let rank_icon = match index {
                                0 => "\u{1F451}".to_string(), // crown
                                1 => "\u{1F948}".to_string(), // silver medal
                                2 => "\u{1F949}".to_string(), // bronze medal
                                _ => format!("{}", index + 1),
                            };
                            let bar_width = (clan.games as f64 / max_games as f64) * 100.0;
                            let ratio_class = if clan.weighted_wl_ratio >= 1.0 {
                                "text-green-400"
                            } else {
                                "text-red-400"
                            };

                            rsx! {
                                tr {
                                    key: "{clan.clan_tag}",
                                    class: "border-b border-white/5 hover:bg-white/[0.07] transition-colors group",
                                    td {
                                        class: "py-3 px-4 text-center",
                                        div {
                                            class: "w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg {rank_color}",
                                            "{rank_icon}"
                                        }
                                    }
                                    td {
                                        class: "py-3 px-4",
                                        div {
                                            class: "flex items-center gap-3",
                                            div {
                                                class: "px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 font-bold text-xs tracking-wide group-hover:bg-blue-500/20 transition-colors",
                                                "{clan.clan_tag}"
                                            }
                                        }
                                    }
                                    td {
                                        class: "py-3 px-4 text-right",
                                        div {
                                            class: "flex flex-col items-end gap-1",
                                            span {
                                                class: "text-white font-mono font-medium",
                                                "{clan.games}"
                                            }
                                            div {
                                                class: "w-24 h-1 bg-white/10 rounded-full overflow-hidden",
                                                div {
                                                    class: "h-full bg-blue-500/50 rounded-full",
                                                    style: "width: {bar_width}%",
                                                }
                                            }
                                        }
                                    }
                                    td {
                                        class: "py-3 px-4 text-right font-mono text-green-400/90 hidden md:table-cell",
                                        "{clan.weighted_wins}"
                                    }
                                    td {
                                        class: "py-3 px-4 text-right font-mono text-red-400/90 hidden md:table-cell",
                                        "{clan.weighted_losses}"
                                    }
                                    td {
                                        class: "py-3 px-4 text-right pr-6",
                                        div {
                                            class: "inline-flex flex-col items-end",
                                            span {
                                                class: "font-mono font-bold {ratio_class}",
                                                "{clan.weighted_wl_ratio}"
                                            }
                                            span {
                                                class: "text-[10px] uppercase text-white/30 font-bold tracking-wider",
                                                "{translations.ratio}"
                                            }
                                        }
                                    }
                                }
                            }
                        })}
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

pub fn launch_stats_modal(state_json: &str, translations_json: &str) {
    let state: StatsModalState = serde_json::from_str(state_json).unwrap_or_default();
    let translations: StatsModalTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching stats modal");

    set_initial_state(state, translations);

    let config = dioxus::web::Config::new().rootname("dioxus-stats-modal-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(stats_modal_root);
}

fn stats_modal_root() -> Element {
    let (state, translations) = take_initial_state();
    rsx! {
        StatsModal {
            state: state,
            translations: translations,
        }
    }
}

pub fn show_stats_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = true;
        }
    });
}

pub fn hide_stats_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = false;
        }
    });
}

pub fn update_stats_modal(state_json: &str) {
    let new_state: StatsModalState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse stats modal state: {}", e);
            return;
        }
    };

    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(new_state);
        }
    });
}
