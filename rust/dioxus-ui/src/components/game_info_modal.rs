//! Game Info Modal component
//!
//! A modal that displays game information after a game ends, including:
//! - Map image and game details (mode, map name, duration, player count)
//! - Ranking controls for sorting by different criteria
//! - Player rows with scores, sorted by the selected ranking type
//! - Sub-components: RankingControls, RankingHeader, PlayerRow

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the game info modal component
pub fn register() {
    log::debug!("Registered <game-info-modal> component");
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameInfoModalState {
    pub is_visible: bool,
    pub is_loading: bool,
    pub rank_type: String,
    pub map_image: Option<String>,
    pub game_mode: String,
    pub game_map: String,
    pub duration: String,
    pub player_count: usize,
    pub has_unusual_thumbnail: bool,
    pub current_username: Option<String>,
    pub players: Vec<PlayerInfo>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub id: String,
    pub raw_username: String,
    pub username: String,
    pub tag: Option<String>,
    pub killed_at: Option<f64>,
    pub conquests: u32,
    pub flag: Option<String>,
    pub winner: bool,
    pub atoms: u32,
    pub hydros: u32,
    pub mirv: u32,
    pub score: f64,
    pub total_gold: f64,
    pub stolen_gold: f64,
    pub naval_trade: f64,
    pub conquered_gold: f64,
    pub train_trade: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameInfoTranslations {
    pub title: String,
    pub no_winner: String,
    pub loading: String,
    pub players_label: String,
    pub duration_label: String,
    pub war: String,
    pub economy: String,
    pub bombs: String,
    pub conquests: String,
    pub trade: String,
    pub pirate: String,
    pub conquered: String,
    pub total_gold: String,
    pub survival_time: String,
    pub num_of_conquests: String,
    pub atoms: String,
    pub hydros: String,
    pub mirv_label: String,
    pub all_gold: String,
    pub train_trade: String,
    pub naval_trade: String,
    pub conquest_gold: String,
    pub stolen_gold: String,
    pub close: String,
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<GameInfoModalState>>> =
        const { RefCell::new(None) };
    static TRANSLATIONS_SIGNAL: RefCell<Option<Signal<GameInfoTranslations>>> =
        const { RefCell::new(None) };
    static INITIAL_STATE: RefCell<Option<(GameInfoModalState, GameInfoTranslations)>> =
        const { RefCell::new(None) };
}

pub fn set_initial_state(state: GameInfoModalState, translations: GameInfoTranslations) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((state, translations));
    });
}

pub fn take_initial_state() -> (GameInfoModalState, GameInfoTranslations) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                GameInfoModalState::default(),
                GameInfoTranslations::default(),
            )
        })
    })
}

pub fn store_state_signal(signal: Signal<GameInfoModalState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub fn store_translations_signal(signal: Signal<GameInfoTranslations>) {
    TRANSLATIONS_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub use store_state_signal as game_info_store_state_signal;
pub use store_translations_signal as game_info_store_translations_signal;
pub use take_initial_state as game_info_take_initial_state;

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
                CustomEvent::new_with_event_init_dict("dioxus-game-info-close", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_sort(rank_type: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from_str(rank_type));
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) = CustomEvent::new_with_event_init_dict("dioxus-game-info-sort", &init)
            {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: format a number compactly
// ---------------------------------------------------------------------------

fn render_number(value: f64) -> String {
    if value.abs() >= 1_000_000.0 {
        format!("{:.1}M", value / 1_000_000.0)
    } else if value.abs() >= 1_000.0 {
        format!("{:.1}K", value / 1_000.0)
    } else {
        format!("{}", value as i64)
    }
}

// ---------------------------------------------------------------------------
// Rank type helpers
// ---------------------------------------------------------------------------

fn is_economy_ranking(rt: &str) -> bool {
    matches!(
        rt,
        "TotalGold" | "StolenGold" | "ConqueredGold" | "NavalTrade" | "TrainTrade"
    )
}

fn is_trade_ranking(rt: &str) -> bool {
    matches!(rt, "NavalTrade" | "TrainTrade")
}

fn is_bomb_ranking(rt: &str) -> bool {
    matches!(rt, "Atoms" | "Hydros" | "MIRV")
}

fn is_war_ranking(rt: &str) -> bool {
    matches!(rt, "Conquests" | "Atoms" | "Hydros" | "MIRV")
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/// Ranking controls - main category buttons and sub-ranking buttons
#[component]
fn RankingControls(rank_type: String, translations: GameInfoTranslations) -> Element {
    let rt = rank_type.clone();

    let render_main_btn = |rtype: &'static str, active: bool, label: String| -> Element {
        let rtype_str = rtype.to_string();
        rsx! {
            button {
                class: if active {
                    "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest hover:text-white hover:bg-white/5 border bg-blue-500/20 text-blue-400 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                } else {
                    "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest hover:text-white hover:bg-white/5 border text-white/40 border-transparent"
                },
                onclick: move |_| emit_sort(&rtype_str),
                "{label}"
            }
        }
    };

    let render_sub_btn = |rtype: &'static str, active: bool, label: String| -> Element {
        let rtype_str = rtype.to_string();
        rsx! {
            button {
                class: if active {
                    "text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/20 px-3 py-1 rounded text-white/60 hover:text-white transition-colors outline-1 outline-white/80"
                } else {
                    "text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/20 px-3 py-1 rounded text-white/60 hover:text-white transition-colors"
                },
                onclick: move |_| emit_sort(&rtype_str),
                "{label}"
            }
        }
    };

    rsx! {
        // Main buttons
        div {
            class: "flex items-end justify-center p-6 pb-2 gap-5",
            {render_main_btn("Lifetime", rt == "Lifetime", translations.duration_label.clone())}
            {render_main_btn("Conquests", is_war_ranking(&rt), translations.war.clone())}
            {render_main_btn("TotalGold", is_economy_ranking(&rt), translations.economy.clone())}
        }

        // War sub-ranking
        if is_war_ranking(&rt) {
            div {
                class: "flex justify-center gap-3 pb-1",
                {render_sub_btn("MIRV", is_bomb_ranking(&rt), translations.bombs.clone())}
                {render_sub_btn("Conquests", rt == "Conquests", translations.conquests.clone())}
            }
        }

        // Economy sub-ranking
        if is_economy_ranking(&rt) {
            div {
                class: "flex justify-center gap-3 pb-1",
                {render_sub_btn("NavalTrade", is_trade_ranking(&rt), translations.trade.clone())}
                {render_sub_btn("StolenGold", rt == "StolenGold", translations.pirate.clone())}
                {render_sub_btn("ConqueredGold", rt == "ConqueredGold", translations.conquered.clone())}
                {render_sub_btn("TotalGold", rt == "TotalGold", translations.total_gold.clone())}
            }
        }
    }
}

/// Ranking header - column label row
#[component]
fn RankingHeader(rank_type: String, translations: GameInfoTranslations) -> Element {
    let rt = rank_type.clone();

    let header_btn = |rtype: &'static str, label: String, active: bool| -> Element {
        let rtype_str = rtype.to_string();
        rsx! {
            button {
                class: if active { "border-b-2 border-b-white" } else { "" },
                onclick: move |_| emit_sort(&rtype_str),
                "{label}"
            }
        }
    };

    rsx! {
        li {
            class: "text-lg border-white/5 bg-white/[0.02] text-white/60 text-xs uppercase tracking-wider relative pt-2 pb-2 pr-5 pl-5 flex justify-between items-center",
            match rt.as_str() {
                "Lifetime" => rsx! { div { class: "w-full", "{translations.survival_time}" } },
                "Conquests" => rsx! { div { class: "w-full", "{translations.num_of_conquests}" } },
                "Atoms" | "Hydros" | "MIRV" => rsx! {
                    div {
                        class: "flex justify-between sm:px-17.5 w-full",
                        {header_btn("Atoms", translations.atoms.clone(), rt == "Atoms")}
                        " / "
                        {header_btn("Hydros", translations.hydros.clone(), rt == "Hydros")}
                        " / "
                        {header_btn("MIRV", translations.mirv_label.clone(), rt == "MIRV")}
                    }
                },
                "TotalGold" => rsx! { div { class: "w-full", "{translations.all_gold}" } },
                "NavalTrade" | "TrainTrade" => rsx! {
                    div {
                        class: "flex justify-between sm:px-17.5 w-full",
                        {header_btn("TrainTrade", translations.train_trade.clone(), rt == "TrainTrade")}
                        " / "
                        {header_btn("NavalTrade", translations.naval_trade.clone(), rt == "NavalTrade")}
                    }
                },
                "ConqueredGold" => rsx! { div { class: "w-full", "{translations.conquest_gold}" } },
                "StolenGold" => rsx! { div { class: "w-full", "{translations.stolen_gold}" } },
                _ => rsx! { div { class: "w-full" } },
            }
        }
    }
}

/// Player row
#[component]
fn PlayerRow(
    player: PlayerInfo,
    rank: usize,
    rank_type: String,
    best_score: f64,
    is_current: bool,
) -> Element {
    let visible_border = player.winner || is_current;
    let border_class = if player.winner {
        "border-yellow-500 border-1 box-content"
    } else if visible_border {
        "border-white/5"
    } else {
        "border-transparent"
    };

    rsx! {
        li {
            class: "bg-black/20 border-b-1 {border_class} relative pt-1 pb-1 pr-2 pl-2 sm:pl-5 sm:pr-5 flex justify-between items-center hover:bg-white/[0.07] transition-colors duration-150 ease-in-out",

            // Rank number
            div {
                class: "font-bold text-right w-7.5 text-lg text-white absolute -left-10",
                "{rank}"
            }

            // Content based on rank type
            {
                match rank_type.as_str() {
                    "Lifetime" | "Conquests" => render_score_bar(&player, &rank_type, best_score),
                    "Atoms" | "Hydros" | "MIRV" => render_bomb_score(&player, &rank_type),
                    "TotalGold" | "ConqueredGold" | "StolenGold" => render_gold_score(&player),
                    "NavalTrade" | "TrainTrade" => render_trade_score(&player, &rank_type),
                    _ => rsx! {},
                }
            }
        }
    }
}

/// Player icon (flag, skull, or default)
fn render_player_icon(player: &PlayerInfo) -> Element {
    if player.killed_at.is_some() {
        rsx! {
            div {
                class: "size-7.5 leading-1.25 shrink-0 text-lg sm:size-10 pt-3 sm:leading-3.75 sm:rounded-[50%] sm:border sm:border-gray-200 text-center sm:bg-slate-500 sm:text-2xl relative",
                dangerous_inner_html: "&#x1F480;",
            }
        }
    } else if let Some(ref flag) = player.flag {
        rsx! {
            img {
                src: "/flags/{flag}.svg",
                class: "min-w-7.5 h-7.5 sm:min-w-10 sm:h-10 shrink-0",
            }
        }
    } else {
        rsx! {
            div {
                class: "size-7.5 leading-1.25 shrink-0 rounded-[50%] sm:size-10 sm:pt-2.5 sm:leading-3.5 border border-gray-200 text-center bg-slate-500",
                img {
                    src: "/images/ProfileIcon.svg",
                    class: "size-5 mt-0.5 sm:size-6.25 sm:-mt-1.25 m-auto",
                }
            }
        }
    }
}

/// Crown icon for winners
fn render_crown(player: &PlayerInfo) -> Element {
    if player.winner {
        rsx! {
            img {
                src: "/images/CrownIcon.svg",
                class: "absolute -top-0.75 left-4 size-3.75 sm:-top-1.75 sm:left-7.5 sm:size-5",
            }
        }
    } else {
        rsx! {}
    }
}

/// Player name with optional clan tag
fn render_player_name(player: &PlayerInfo) -> Element {
    rsx! {
        div {
            class: "flex gap-1 items-center w-50 shrink-0",
            if let Some(ref tag) = player.tag {
                div {
                    class: "px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 font-bold text-xs tracking-wide group-hover:bg-blue-500/20 transition-colors",
                    "{tag}"
                }
            }
            div {
                class: "text-xs sm:text-sm font-bold tracking-wide text-white/80 text-ellipsis w-37.5 shrink-0 overflow-hidden whitespace-nowrap",
                "{player.username}"
            }
        }
    }
}

/// Score bar layout (Lifetime, Conquests)
fn render_score_bar(player: &PlayerInfo, _rank_type: &str, best_score: f64) -> Element {
    let best = if best_score > 0.0 { best_score } else { 1.0 };
    let width = ((player.score / best) * 100.0).clamp(0.0, 100.0);
    let score_display = format!("{}", player.score as i64);

    rsx! {
        div {
            class: "flex gap-3 items-center w-full",
            div { class: "relative",
                {render_player_icon(player)}
                {render_crown(player)}
            }
            div {
                class: "flex flex-col sm:flex-row gap-1 text-left w-full",
                {render_player_name(player)}
                div {
                    class: "w-full pr-2.5 m-auto",
                    div {
                        class: "h-1.75 bg-white/10 w-full",
                        div {
                            class: "h-1.75 bg-blue-500/50",
                            style: "width: {width}%;",
                        }
                    }
                }
            }
        }
        div {
            div {
                class: "font-bold rounded-[50%] size-7.5 leading-[1.6rem] border border-white/10 text-center bg-white/5 text-white/80",
                "{score_display}"
            }
        }
    }
}

/// Bomb score layout (Atoms, Hydros, MIRV)
fn render_bomb_score(player: &PlayerInfo, rank_type: &str) -> Element {
    let render_multi = |value: u32, highlight: bool| -> Element {
        let cls = if highlight {
            "font-bold text-[18px] text-white/80 min-w-7.5 sm:min-w-15 inline-block text-center"
        } else {
            "leading-[24px] text-white/40 min-w-7.5 sm:min-w-15 inline-block text-center"
        };
        let display = render_number(value as f64);
        rsx! { div { class: "{cls}", "{display}" } }
    };

    rsx! {
        div {
            class: "flex gap-3 items-center align-baseline w-full",
            div { class: "relative",
                {render_player_icon(player)}
                {render_crown(player)}
            }
            div {
                class: "flex flex-col sm:flex-row gap-1 text-left w-full",
                {render_player_name(player)}
                div {
                    class: "flex justify-between text-sm sm:pr-20",
                    {render_multi(player.atoms, rank_type == "Atoms")}
                    " / "
                    {render_multi(player.hydros, rank_type == "Hydros")}
                    " / "
                    {render_multi(player.mirv, rank_type == "MIRV")}
                }
            }
        }
    }
}

/// Gold score layout (TotalGold, ConqueredGold, StolenGold)
fn render_gold_score(player: &PlayerInfo) -> Element {
    let display = render_number(player.score);

    rsx! {
        div {
            class: "flex gap-3 items-center",
            div { class: "relative",
                {render_player_icon(player)}
                {render_crown(player)}
            }
            div {
                class: "text-left w-31.25 sm:w-50",
                {render_player_name(player)}
            }
        }
        div {
            class: "flex gap-2",
            div {
                class: "font-bold rounded-md w-15 text-white/80 text-sm sm:w-25 leading-[1.9rem] text-center",
                "{display}"
            }
            img {
                src: "/images/GoldCoinIcon.svg",
                class: "size-3.5 sm:size-5 m-auto",
            }
        }
    }
}

/// Trade score layout (NavalTrade, TrainTrade)
fn render_trade_score(player: &PlayerInfo, rank_type: &str) -> Element {
    let render_multi = |value: f64, highlight: bool| -> Element {
        let cls = if highlight {
            "font-bold text-[18px] text-white/80 min-w-7.5 sm:min-w-15 inline-block text-center"
        } else {
            "leading-[24px] text-white/40 min-w-7.5 sm:min-w-15 inline-block text-center"
        };
        let display = render_number(value);
        rsx! { div { class: "{cls}", "{display}" } }
    };

    rsx! {
        div {
            class: "flex flex-col sm:flex-row gap-1 text-left w-full",
            div {
                class: "flex gap-3 items-center",
                div { class: "relative",
                    {render_player_icon(player)}
                    {render_crown(player)}
                }
                div {
                    class: "text-left w-31.25 sm:w-50",
                    {render_player_name(player)}
                }
            }
            div {
                class: "flex gap-2 justify-between items-center w-full",
                div {
                    class: "rounded-md text-sm leading-[1.9rem] text-center w-full",
                    div {
                        class: "flex justify-between text-sm align-baseline",
                        {render_multi(player.train_trade, rank_type == "TrainTrade")}
                        " / "
                        {render_multi(player.naval_trade, rank_type == "NavalTrade")}
                    }
                }
                img {
                    src: "/images/GoldCoinIcon.svg",
                    class: "w-5 size-3.5 sm:size-5",
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct GameInfoModalProps {
    pub state: GameInfoModalState,
    pub translations: GameInfoTranslations,
}

#[component]
pub fn GameInfoModal(props: GameInfoModalProps) -> Element {
    let mut state = use_signal(|| props.state.clone());
    let translations = use_signal(|| props.translations.clone());

    // Store signals for external updates
    STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(state));
    TRANSLATIONS_SIGNAL.with(|s| *s.borrow_mut() = Some(translations));

    let on_close = move |_| {
        state.write().is_visible = false;
        emit_close();
    };

    let on_backdrop = move |_| {
        state.write().is_visible = false;
        emit_close();
    };

    if !state().is_visible {
        return rsx! { div { class: "hidden" } };
    }

    let current_state = state();
    let current_translations = translations();

    rsx! {
        // Backdrop
        div {
            class: "fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4",
            onclick: on_backdrop,
            onkeydown: move |e: KeyboardEvent| {
                if e.key() == Key::Escape {
                    state.write().is_visible = false;
                    emit_close();
                }
            },

            // Modal
            div {
                class: "relative bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden text-white",
                onclick: move |e| e.stop_propagation(),

                // Header
                div {
                    class: "flex items-center justify-between p-4 border-b border-white/10",
                    h2 {
                        class: "text-xl font-bold uppercase tracking-widest",
                        "{current_translations.title}"
                    }
                    button {
                        class: "flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors",
                        onclick: on_close,
                        dangerous_inner_html: "&#x2715;",
                    }
                }

                // Body
                div {
                    class: "p-4 overflow-y-auto max-h-[calc(90vh-60px)] scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent",

                    if current_state.is_loading {
                        // Loading spinner
                        div {
                            class: "flex flex-col items-center justify-center p-6 text-white",
                            p { class: "mb-2", "{current_translations.loading}" }
                            div {
                                class: "w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin",
                            }
                        }
                    } else if current_state.players.is_empty() {
                        // No players
                        div {
                            class: "flex flex-col items-center justify-center p-6 text-white",
                            p { class: "mb-2", "{current_translations.no_winner}" }
                        }
                    } else {
                        div {
                            class: "flex flex-col items-center text-center mb-4",
                            div {
                                class: "w-75 sm:w-125",

                                // Game info card
                                {render_game_info_card(&current_state, &current_translations)}

                                // Ranking controls
                                RankingControls {
                                    rank_type: current_state.rank_type.clone(),
                                    translations: current_translations.clone(),
                                }

                                // Player list
                                ul {
                                    RankingHeader {
                                        rank_type: current_state.rank_type.clone(),
                                        translations: current_translations.clone(),
                                    }
                                    {
                                        let best_score = current_state.players.first().map(|p| p.score).unwrap_or(0.0);
                                        let rank_type = current_state.rank_type.clone();
                                        let current_username = current_state.current_username.clone();
                                        current_state.players.iter().enumerate().map(move |(i, player)| {
                                            let is_current = current_username.as_deref() == Some(&player.raw_username);
                                            rsx! {
                                                PlayerRow {
                                                    key: "{player.id}",
                                                    player: player.clone(),
                                                    rank: i + 1,
                                                    rank_type: rank_type.clone(),
                                                    best_score: best_score,
                                                    is_current: is_current,
                                                }
                                            }
                                        })
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

/// Render game info card (map image, mode, duration, player count)
fn render_game_info_card(
    state: &GameInfoModalState,
    translations: &GameInfoTranslations,
) -> Element {
    let unusual_class = if state.has_unusual_thumbnail {
        "object-cover object-center"
    } else {
        ""
    };

    rsx! {
        div {
            class: "h-37.5 flex relative justify-between rounded-xl bg-black/20 items-center",
            if let Some(ref map_image) = state.map_image {
                img {
                    src: "{map_image}",
                    class: "absolute place-self-start col-span-full row-span-full h-full rounded-xl mask-[linear-gradient(to_left,transparent,#fff)] {unusual_class}",
                }
            } else {
                div {
                    class: "place-self-start col-span-full row-span-full h-full rounded-xl bg-gray-300",
                }
            }
            div {
                class: "text-right p-3 w-full",
                div {
                    class: "font-normal pl-1 pr-1",
                    span {
                        class: "bg-white text-blue-800 font-normal pl-1 pr-1",
                        "{state.game_mode}"
                    }
                    " "
                    span {
                        class: "font-bold",
                        "{state.game_map}"
                    }
                }
                div { "{state.duration}" }
                div { "{state.player_count} {translations.players_label}" }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

pub fn launch_game_info_modal(state_json: &str, translations_json: &str) {
    let state: GameInfoModalState = serde_json::from_str(state_json).unwrap_or_default();
    let translations: GameInfoTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching game info modal");

    set_initial_state(state, translations);

    let config = dioxus::web::Config::new().rootname("dioxus-game-info-modal-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(game_info_modal_root);
}

fn game_info_modal_root() -> Element {
    let (state, translations) = take_initial_state();
    rsx! {
        GameInfoModal {
            state: state,
            translations: translations,
        }
    }
}

pub fn show_game_info_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = true;
        }
    });
}

pub fn hide_game_info_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.write().is_visible = false;
        }
    });
}

pub fn update_game_info_modal(state_json: &str) {
    let new_state: GameInfoModalState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse game info state: {}", e);
            return;
        }
    };

    STATE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(new_state);
        }
    });
}
