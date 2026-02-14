//! SinglePlayerModal component
//!
//! A modal for configuring and starting single-player games.
//! Features: map selection grid, difficulty picker, game mode selector,
//! team count, option toggles, sliders, unit enables, and start button.
//! Shares many UI patterns with HostLobbyModal.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the single player modal component
pub fn register() {
    log::debug!("Registered <dioxus-single-player-modal> component");
}

// Thread-local storage for component state
thread_local! {
    static MODAL_STATE: RefCell<Option<SinglePlayerModalState>> = const { RefCell::new(None) };
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static FORM_STATE_SIGNAL: RefCell<Option<Signal<SinglePlayerFormState>>> = const { RefCell::new(None) };
    static ACHIEVEMENTS_SIGNAL: RefCell<Option<Signal<AchievementsData>>> = const { RefCell::new(None) };
}

// ============================================================================
// Data types
// ============================================================================

#[derive(Clone)]
struct SinglePlayerModalState {
    translations: SinglePlayerTranslations,
    maps: Vec<MapCategory>,
    difficulties: Vec<DifficultyOption>,
    unit_options: Vec<UnitOption>,
    team_count_options: Vec<TeamCountOption>,
}

/// Translations from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SinglePlayerTranslations {
    pub title: String,
    pub map_title: String,
    pub difficulty_title: String,
    pub mode_title: String,
    pub options_title: String,
    pub enables_title: String,
    pub team_count_title: String,
    pub ffa: String,
    pub teams: String,
    pub bots_label: String,
    pub bots_disabled: String,
    pub disable_nations: String,
    pub instant_build: String,
    pub random_spawn: String,
    pub infinite_gold: String,
    pub infinite_troops: String,
    pub compact_map: String,
    pub max_timer: String,
    pub max_timer_placeholder: String,
    pub gold_multiplier: String,
    pub gold_multiplier_placeholder: String,
    pub starting_gold: String,
    pub starting_gold_placeholder: String,
    pub start: String,
    pub back: String,
    pub special: String,
    pub random_map: String,
    pub sign_in_for_achievements: String,
    pub toggle_achievements: String,
}

/// A map category with its maps
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCategory {
    pub key: String,
    pub label: String,
    pub maps: Vec<MapOption>,
}

/// A single map option
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapOption {
    pub key: String,
    pub value: String,
    pub label: String,
    pub image_url: String,
}

/// A difficulty option
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DifficultyOption {
    pub key: String,
    pub value: String,
    pub label: String,
    pub icon_url: String,
}

/// A unit type option for enable/disable
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitOption {
    pub unit_type: String,
    pub label: String,
}

/// A team count option
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamCountOption {
    pub value: String,
    pub label: String,
    pub is_string: bool,
}

/// Form state for the single player modal
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SinglePlayerFormState {
    pub selected_map: String,
    pub selected_difficulty: String,
    pub game_mode: String,
    pub team_count: String,
    pub use_random_map: bool,
    pub disable_nations: bool,
    pub bots: u32,
    pub infinite_gold: bool,
    pub infinite_troops: bool,
    pub compact_map: bool,
    pub max_timer: bool,
    pub max_timer_value: Option<u32>,
    pub instant_build: bool,
    pub random_spawn: bool,
    pub gold_multiplier: bool,
    pub gold_multiplier_value: Option<f64>,
    pub starting_gold: bool,
    pub starting_gold_value: Option<u64>,
    pub disabled_units: Vec<String>,
    pub show_achievements: bool,
    pub has_linked_account: bool,
    pub is_hvn_team_mode: bool,
}

impl Default for SinglePlayerFormState {
    fn default() -> Self {
        Self {
            selected_map: "World".to_string(),
            selected_difficulty: "Easy".to_string(),
            game_mode: "Free For All".to_string(),
            team_count: "2".to_string(),
            use_random_map: false,
            disable_nations: false,
            bots: 400,
            infinite_gold: false,
            infinite_troops: false,
            compact_map: false,
            max_timer: false,
            max_timer_value: None,
            instant_build: false,
            random_spawn: false,
            gold_multiplier: false,
            gold_multiplier_value: None,
            starting_gold: false,
            starting_gold_value: None,
            disabled_units: Vec::new(),
            show_achievements: false,
            has_linked_account: false,
            is_hvn_team_mode: false,
        }
    }
}

/// Achievements data
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AchievementsData {
    pub map_wins: Vec<MapWinEntry>,
}

/// A map win entry for achievements
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapWinEntry {
    pub map_value: String,
    pub difficulties: Vec<String>,
}

/// SinglePlayerModal component props
#[derive(Props, Clone, PartialEq)]
pub struct SinglePlayerModalProps {
    pub translations: SinglePlayerTranslations,
    pub maps: Vec<MapCategory>,
    pub difficulties: Vec<DifficultyOption>,
    pub unit_options: Vec<UnitOption>,
    pub team_count_options: Vec<TeamCountOption>,
}

// ============================================================================
// Event emitters
// ============================================================================

fn emit_custom_event(name: &str, detail: JsValue) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_detail(&detail);
            init.set_bubbles(true);
            init.set_composed(true);

            if let Ok(event) = CustomEvent::new_with_event_init_dict(name, &init) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

fn emit_close() {
    emit_custom_event("single-player-modal-close", JsValue::NULL);
}

fn emit_start_game(form_json: &str) {
    emit_custom_event("single-player-modal-start", JsValue::from_str(form_json));
}

fn emit_form_change(form_json: &str) {
    emit_custom_event(
        "single-player-modal-form-change",
        JsValue::from_str(form_json),
    );
}

// ============================================================================
// Sub-components
// ============================================================================

/// Section header with icon
#[component]
fn SectionHeader(title: String, color_class: String) -> Element {
    rsx! {
        div {
            class: "flex items-center gap-4 pb-2 border-b border-white/10",
            div {
                class: "w-8 h-8 rounded-lg flex items-center justify-center {color_class}",
                div { class: "w-5 h-5" }
            }
            h3 {
                class: "text-lg font-bold text-white uppercase tracking-wider",
                "{title}"
            }
        }
    }
}

/// Option toggle button
#[component]
fn OptionToggle(label: String, checked: bool, on_click: EventHandler<()>) -> Element {
    let classes = if checked {
        "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 h-full min-h-[100px] w-full cursor-pointer bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
    } else {
        "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 h-full min-h-[100px] w-full cursor-pointer bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"
    };

    let text_class = if checked {
        "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words text-white"
    } else {
        "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words text-white/60"
    };

    rsx! {
        button {
            class: "{classes}",
            onclick: move |_| on_click.call(()),
            div {
                class: "{text_class}",
                "{label}"
            }
        }
    }
}

/// Toggle with input card
#[component]
fn ToggleInputCard(
    label: String,
    checked: bool,
    placeholder: String,
    value: String,
    min: String,
    max: String,
    step: String,
    on_toggle: EventHandler<()>,
    on_input: EventHandler<String>,
) -> Element {
    let card_classes = if checked {
        "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 h-full min-h-[100px] w-full cursor-pointer bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
    } else {
        "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 h-full min-h-[100px] w-full cursor-pointer bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"
    };

    let text_class = if checked {
        "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words text-white"
    } else {
        "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words text-white/60"
    };

    rsx! {
        div {
            class: "{card_classes}",
            onclick: move |_| on_toggle.call(()),
            div {
                class: "{text_class}",
                "{label}"
            }
            if checked {
                input {
                    r#type: "number",
                    class: "w-full mt-2 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-center text-sm focus:outline-none focus:border-blue-400",
                    placeholder: "{placeholder}",
                    value: "{value}",
                    min: "{min}",
                    max: "{max}",
                    step: "{step}",
                    onclick: move |e: MouseEvent| e.stop_propagation(),
                    oninput: move |e: FormEvent| on_input.call(e.value()),
                }
            }
        }
    }
}

/// Unit enable/disable button
#[component]
fn UnitToggle(label: String, enabled: bool, on_click: EventHandler<()>) -> Element {
    let classes = if enabled {
        "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 min-h-[100px] w-full cursor-pointer bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
    } else {
        "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 min-h-[100px] w-full cursor-pointer bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"
    };

    let text_class = if enabled {
        "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words text-white"
    } else {
        "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words text-white/60"
    };

    rsx! {
        button {
            class: "{classes}",
            onclick: move |_| on_click.call(()),
            div {
                class: "{text_class}",
                "{label}"
            }
        }
    }
}

// ============================================================================
// Main component
// ============================================================================

/// Main SinglePlayerModal component
#[component]
pub fn SinglePlayerModal(props: SinglePlayerModalProps) -> Element {
    let mut is_visible = use_signal(|| false);
    let mut form_state = use_signal(SinglePlayerFormState::default);
    let achievements = use_signal(AchievementsData::default);

    // Store signals for external updates
    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));
    FORM_STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(form_state));
    ACHIEVEMENTS_SIGNAL.with(|s| *s.borrow_mut() = Some(achievements));

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    let current_form = form_state();
    let is_team_mode = current_form.game_mode == "Team";

    // Close handler
    let on_close = move |_| {
        is_visible.set(false);
        emit_close();
    };

    // Escape key handler
    let on_keydown = move |e: KeyboardEvent| {
        if e.key() == Key::Escape {
            is_visible.set(false);
            emit_close();
        }
    };

    // Map selection
    let mut on_map_select = {
        move |map_value: String| {
            let mut fs = form_state();
            fs.selected_map = map_value;
            fs.use_random_map = false;
            form_state.set(fs.clone());
            if let Ok(json) = serde_json::to_string(&fs) {
                emit_form_change(&json);
            }
        }
    };

    // Random map
    let on_random_map = {
        move |_| {
            let mut fs = form_state();
            fs.use_random_map = true;
            form_state.set(fs.clone());
            if let Ok(json) = serde_json::to_string(&fs) {
                emit_form_change(&json);
            }
        }
    };

    // Difficulty selection
    let mut on_difficulty_select = {
        move |diff_value: String| {
            let mut fs = form_state();
            fs.selected_difficulty = diff_value;
            form_state.set(fs.clone());
            if let Ok(json) = serde_json::to_string(&fs) {
                emit_form_change(&json);
            }
        }
    };

    // Game mode selection
    let mut on_mode_select = {
        move |mode: String| {
            let mut fs = form_state();
            fs.game_mode = mode;
            form_state.set(fs.clone());
            if let Ok(json) = serde_json::to_string(&fs) {
                emit_form_change(&json);
            }
        }
    };

    // Team count selection
    let mut on_team_count_select = {
        move |tc: String| {
            let mut fs = form_state();
            fs.team_count = tc;
            fs.is_hvn_team_mode = fs.game_mode == "Team" && fs.team_count == "Humans Vs Nations";
            form_state.set(fs.clone());
            if let Ok(json) = serde_json::to_string(&fs) {
                emit_form_change(&json);
            }
        }
    };

    // Start game
    let on_start = {
        move |_| {
            let fs = form_state();
            if let Ok(json) = serde_json::to_string(&fs) {
                emit_start_game(&json);
            }
        }
    };

    rsx! {
        div {
            class: "fixed inset-0 z-[9999] flex items-center justify-center",
            tabindex: "0",
            onkeydown: on_keydown,

            // Backdrop
            div {
                class: "absolute inset-0 bg-black/70 backdrop-blur-sm",
                onclick: on_close,
            }

            // Modal content
            div {
                class: "relative w-full h-full max-w-6xl max-h-[95vh] mx-4 flex flex-col",
                onclick: move |e| e.stop_propagation(),

                div {
                    class: "h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden",

                    // Header
                    div {
                        class: "flex items-center justify-between p-4 border-b border-white/10 shrink-0",

                        div {
                            class: "flex items-center gap-3",
                            button {
                                class: "flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white",
                                onclick: on_close,
                                span { class: "text-lg", "<" }
                            }
                            h2 {
                                class: "text-xl font-bold text-white uppercase tracking-wider",
                                "{props.translations.title}"
                            }
                        }

                        // Achievement toggle or sign-in banner
                        if current_form.has_linked_account {
                            button {
                                class: if current_form.show_achievements {
                                    "flex items-center gap-2 px-3 py-2 rounded-xl border bg-yellow-500/10 border-yellow-500/30 text-yellow-400 transition-all shrink-0"
                                } else {
                                    "flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all shrink-0 text-white/60"
                                },
                                onclick: move |_| {
                                    let mut fs = form_state();
                                    fs.show_achievements = !fs.show_achievements;
                                    form_state.set(fs.clone());
                                    if let Ok(json) = serde_json::to_string(&fs) {
                                        emit_form_change(&json);
                                    }
                                },
                                span {
                                    class: "text-xs font-bold uppercase tracking-wider whitespace-nowrap",
                                    "{props.translations.toggle_achievements}"
                                }
                            }
                        } else {
                            div {
                                class: "px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0",
                                "{props.translations.sign_in_for_achievements}"
                            }
                        }
                    }

                    // Scrollable content
                    div {
                        class: "flex-1 overflow-y-auto px-6 pb-6 mr-1",
                        div {
                            class: "max-w-5xl mx-auto space-y-6 pt-4",

                            // Map Selection
                            div {
                                class: "space-y-6",
                                SectionHeader { title: props.translations.map_title.clone(), color_class: "bg-blue-500/20 text-blue-400".to_string() }

                                div {
                                    class: "space-y-8",
                                    for category in props.maps.iter() {
                                        div {
                                            class: "w-full",
                                            h4 {
                                                class: "text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2",
                                                "{category.label}"
                                            }
                                            div {
                                                class: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4",
                                                for map in category.maps.iter() {
                                                    {
                                                        let map_value = map.value.clone();
                                                        let map_label = map.label.clone();
                                                        let map_image = map.image_url.clone();
                                                        let is_selected = !current_form.use_random_map && current_form.selected_map == map_value;
                                                        let map_wins = achievements().map_wins.iter()
                                                            .find(|w| w.map_value == map_value)
                                                            .map(|w| w.difficulties.clone())
                                                            .unwrap_or_default();

                                                        rsx! {
                                                            button {
                                                                class: if is_selected {
                                                                    "relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)] cursor-pointer active:scale-95"
                                                                } else {
                                                                    "relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 cursor-pointer active:scale-95"
                                                                },
                                                                onclick: {
                                                                    let mv = map_value.clone();
                                                                    move |_| on_map_select(mv.clone())
                                                                },
                                                                div {
                                                                    class: "aspect-[2/1] w-full relative overflow-hidden bg-black/20",
                                                                    if !map_image.is_empty() {
                                                                        img {
                                                                            src: "{map_image}",
                                                                            alt: "{map_label}",
                                                                            class: "w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                                                                        }
                                                                    }
                                                                }
                                                                div {
                                                                    class: "p-3 text-center border-t border-white/5",
                                                                    div {
                                                                        class: "text-xs font-bold text-white uppercase tracking-wider break-words",
                                                                        "{map_label}"
                                                                    }
                                                                    // Achievement medals
                                                                    if current_form.show_achievements && !map_wins.is_empty() {
                                                                        div {
                                                                            class: "flex justify-center gap-1 mt-1",
                                                                            for _d in map_wins.iter() {
                                                                                span {
                                                                                    class: "w-3 h-3 rounded-full bg-yellow-400"
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
                                        }
                                    }

                                    // Random Map
                                    div {
                                        class: "w-full",
                                        h4 {
                                            class: "text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2",
                                            "{props.translations.special}"
                                        }
                                        div {
                                            class: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4",
                                            button {
                                                class: if current_form.use_random_map {
                                                    "relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                                                } else {
                                                    "relative group rounded-xl border transition-all duration-200 overflow-hidden flex flex-col items-stretch bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                                                },
                                                onclick: on_random_map,
                                                div {
                                                    class: "aspect-[2/1] w-full relative overflow-hidden bg-black/20",
                                                }
                                                div {
                                                    class: "p-3 text-center border-t border-white/5",
                                                    div {
                                                        class: "text-xs font-bold text-white uppercase tracking-wider break-words",
                                                        "{props.translations.random_map}"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Difficulty Selection
                            div {
                                class: "space-y-6",
                                SectionHeader { title: props.translations.difficulty_title.clone(), color_class: "bg-green-500/20 text-green-400".to_string() }

                                div {
                                    class: "grid grid-cols-2 md:grid-cols-4 gap-4",
                                    for diff in props.difficulties.iter() {
                                        {
                                            let diff_value = diff.value.clone();
                                            let diff_label = diff.label.clone();
                                            let diff_icon = diff.icon_url.clone();
                                            let is_selected = current_form.selected_difficulty == diff_value;
                                            let is_disabled = current_form.disable_nations;

                                            rsx! {
                                                button {
                                                    class: if is_disabled {
                                                        "relative group rounded-xl border transition-all duration-200 w-full overflow-hidden flex flex-col items-center p-4 gap-3 opacity-30 cursor-not-allowed grayscale bg-white/5 border-white/5"
                                                    } else if is_selected {
                                                        "relative group rounded-xl border transition-all duration-200 w-full overflow-hidden flex flex-col items-center p-4 gap-3 bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                                                    } else {
                                                        "relative group rounded-xl border transition-all duration-200 w-full overflow-hidden flex flex-col items-center p-4 gap-3 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                                                    },
                                                    disabled: is_disabled,
                                                    onclick: {
                                                        let dv = diff_value.clone();
                                                        move |_| {
                                                            if !is_disabled {
                                                                on_difficulty_select(dv.clone());
                                                            }
                                                        }
                                                    },
                                                    if !diff_icon.is_empty() {
                                                        img {
                                                            src: "{diff_icon}",
                                                            alt: "{diff_label}",
                                                            class: "w-8 h-8"
                                                        }
                                                    }
                                                    div {
                                                        class: "text-xs font-bold text-white uppercase tracking-wider text-center w-full mt-1 break-words",
                                                        "{diff_label}"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Game Mode Selection
                            div {
                                class: "space-y-6",
                                SectionHeader { title: props.translations.mode_title.clone(), color_class: "bg-purple-500/20 text-purple-400".to_string() }

                                div {
                                    class: "grid grid-cols-2 gap-4",
                                    {
                                        let ffa_selected = current_form.game_mode == "Free For All";
                                        rsx! {
                                            button {
                                                class: if ffa_selected {
                                                    "w-full py-6 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                                                } else {
                                                    "w-full py-6 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                                                },
                                                onclick: move |_| on_mode_select("Free For All".to_string()),
                                                div {
                                                    class: "text-sm font-bold text-white uppercase tracking-widest break-words",
                                                    "{props.translations.ffa}"
                                                }
                                            }
                                        }
                                    }
                                    {
                                        let team_selected = current_form.game_mode == "Team";
                                        rsx! {
                                            button {
                                                class: if team_selected {
                                                    "w-full py-6 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                                                } else {
                                                    "w-full py-6 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                                                },
                                                onclick: move |_| on_mode_select("Team".to_string()),
                                                div {
                                                    class: "text-sm font-bold text-white uppercase tracking-widest break-words",
                                                    "{props.translations.teams}"
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Team Count (only if team mode)
                            if is_team_mode {
                                div {
                                    class: "space-y-6",
                                    div {
                                        class: "text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2",
                                        "{props.translations.team_count_title}"
                                    }
                                    div {
                                        class: "grid grid-cols-2 md:grid-cols-5 gap-3",
                                        for tc_opt in props.team_count_options.iter() {
                                            {
                                                let tc_value = tc_opt.value.clone();
                                                let tc_label = tc_opt.label.clone();
                                                let is_selected = current_form.team_count == tc_value;

                                                rsx! {
                                                    button {
                                                        class: if is_selected {
                                                            "w-full px-4 py-3 rounded-xl border transition-all duration-200 flex items-center justify-center bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                                                        } else {
                                                            "w-full px-4 py-3 rounded-xl border transition-all duration-200 flex items-center justify-center bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                                                        },
                                                        onclick: {
                                                            let tcv = tc_value.clone();
                                                            move |_| on_team_count_select(tcv.clone())
                                                        },
                                                        div {
                                                            class: "text-xs font-bold text-white uppercase tracking-wider text-center break-words",
                                                            "{tc_label}"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Game Options
                            div {
                                class: "space-y-6",
                                SectionHeader { title: props.translations.options_title.clone(), color_class: "bg-orange-500/20 text-orange-400".to_string() }

                                div {
                                    class: "grid grid-cols-2 lg:grid-cols-4 gap-4",

                                    // Bots slider
                                    div {
                                        class: if current_form.bots > 0 {
                                            "col-span-2 rounded-xl p-4 flex flex-col justify-center min-h-[100px] border transition-all duration-200 bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                                        } else {
                                            "col-span-2 rounded-xl p-4 flex flex-col justify-center min-h-[100px] border transition-all duration-200 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"
                                        },
                                        div {
                                            class: "flex justify-between items-center mb-2",
                                            span {
                                                class: "text-xs uppercase font-bold tracking-wider text-white",
                                                if current_form.bots > 0 {
                                                    "{props.translations.bots_label}: {current_form.bots}"
                                                } else {
                                                    "{props.translations.bots_disabled}"
                                                }
                                            }
                                        }
                                        input {
                                            r#type: "range",
                                            min: "0",
                                            max: "400",
                                            step: "1",
                                            value: "{current_form.bots}",
                                            class: "w-full accent-blue-500",
                                            oninput: move |e: FormEvent| {
                                                if let Ok(val) = e.value().parse::<u32>() {
                                                    let mut fs = form_state();
                                                    fs.bots = val;
                                                    form_state.set(fs.clone());
                                                    if let Ok(json) = serde_json::to_string(&fs) {
                                                        emit_form_change(&json);
                                                    }
                                                }
                                            },
                                        }
                                    }

                                    // Disable nations toggle (hidden for HvN)
                                    if !current_form.is_hvn_team_mode {
                                        OptionToggle {
                                            label: props.translations.disable_nations.clone(),
                                            checked: current_form.disable_nations,
                                            on_click: move |_| {
                                                let mut fs = form_state();
                                                fs.disable_nations = !fs.disable_nations;
                                                form_state.set(fs.clone());
                                                if let Ok(json) = serde_json::to_string(&fs) {
                                                    emit_form_change(&json);
                                                }
                                            },
                                        }
                                    }

                                    OptionToggle {
                                        label: props.translations.instant_build.clone(),
                                        checked: current_form.instant_build,
                                        on_click: move |_| {
                                            let mut fs = form_state();
                                            fs.instant_build = !fs.instant_build;
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    OptionToggle {
                                        label: props.translations.random_spawn.clone(),
                                        checked: current_form.random_spawn,
                                        on_click: move |_| {
                                            let mut fs = form_state();
                                            fs.random_spawn = !fs.random_spawn;
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    OptionToggle {
                                        label: props.translations.infinite_gold.clone(),
                                        checked: current_form.infinite_gold,
                                        on_click: move |_| {
                                            let mut fs = form_state();
                                            fs.infinite_gold = !fs.infinite_gold;
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    OptionToggle {
                                        label: props.translations.infinite_troops.clone(),
                                        checked: current_form.infinite_troops,
                                        on_click: move |_| {
                                            let mut fs = form_state();
                                            fs.infinite_troops = !fs.infinite_troops;
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    OptionToggle {
                                        label: props.translations.compact_map.clone(),
                                        checked: current_form.compact_map,
                                        on_click: move |_| {
                                            let mut fs = form_state();
                                            fs.compact_map = !fs.compact_map;
                                            if fs.compact_map && fs.bots == 400 {
                                                fs.bots = 100;
                                            } else if !fs.compact_map && fs.bots == 100 {
                                                fs.bots = 400;
                                            }
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    // Max Timer
                                    ToggleInputCard {
                                        label: props.translations.max_timer.clone(),
                                        checked: current_form.max_timer,
                                        placeholder: props.translations.max_timer_placeholder.clone(),
                                        value: current_form.max_timer_value.map(|v| v.to_string()).unwrap_or_default(),
                                        min: "1".to_string(),
                                        max: "120".to_string(),
                                        step: "1".to_string(),
                                        on_toggle: move |_| {
                                            let mut fs = form_state();
                                            fs.max_timer = !fs.max_timer;
                                            if fs.max_timer && fs.max_timer_value.is_none() {
                                                fs.max_timer_value = Some(30);
                                            } else if !fs.max_timer {
                                                fs.max_timer_value = None;
                                            }
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                        on_input: move |val: String| {
                                            let mut fs = form_state();
                                            fs.max_timer_value = val.parse::<u32>().ok().filter(|&v| v >= 1 && v <= 120);
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    // Gold Multiplier
                                    ToggleInputCard {
                                        label: props.translations.gold_multiplier.clone(),
                                        checked: current_form.gold_multiplier,
                                        placeholder: props.translations.gold_multiplier_placeholder.clone(),
                                        value: current_form.gold_multiplier_value.map(|v| v.to_string()).unwrap_or_default(),
                                        min: "0.1".to_string(),
                                        max: "1000".to_string(),
                                        step: "any".to_string(),
                                        on_toggle: move |_| {
                                            let mut fs = form_state();
                                            fs.gold_multiplier = !fs.gold_multiplier;
                                            if fs.gold_multiplier && fs.gold_multiplier_value.is_none() {
                                                fs.gold_multiplier_value = Some(2.0);
                                            } else if !fs.gold_multiplier {
                                                fs.gold_multiplier_value = None;
                                            }
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                        on_input: move |val: String| {
                                            let mut fs = form_state();
                                            fs.gold_multiplier_value = val.parse::<f64>().ok().filter(|&v| v >= 0.1 && v <= 1000.0);
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }

                                    // Starting Gold
                                    ToggleInputCard {
                                        label: props.translations.starting_gold.clone(),
                                        checked: current_form.starting_gold,
                                        placeholder: props.translations.starting_gold_placeholder.clone(),
                                        value: current_form.starting_gold_value.map(|v| v.to_string()).unwrap_or_default(),
                                        min: "0".to_string(),
                                        max: "1000000000".to_string(),
                                        step: "100000".to_string(),
                                        on_toggle: move |_| {
                                            let mut fs = form_state();
                                            fs.starting_gold = !fs.starting_gold;
                                            if fs.starting_gold && fs.starting_gold_value.is_none() {
                                                fs.starting_gold_value = Some(5000000);
                                            } else if !fs.starting_gold {
                                                fs.starting_gold_value = None;
                                            }
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                        on_input: move |val: String| {
                                            let mut fs = form_state();
                                            fs.starting_gold_value = val.parse::<u64>().ok().filter(|&v| v <= 1000000000);
                                            form_state.set(fs.clone());
                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                emit_form_change(&json);
                                            }
                                        },
                                    }
                                }
                            }

                            // Unit Enables
                            div {
                                class: "space-y-6",
                                SectionHeader { title: props.translations.enables_title.clone(), color_class: "bg-teal-500/20 text-teal-400".to_string() }

                                div {
                                    class: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4",
                                    for unit_opt in props.unit_options.iter() {
                                        {
                                            let ut = unit_opt.unit_type.clone();
                                            let label = unit_opt.label.clone();
                                            let enabled = !current_form.disabled_units.contains(&ut);

                                            rsx! {
                                                UnitToggle {
                                                    label: label,
                                                    enabled: enabled,
                                                    on_click: {
                                                        let ut_clone = ut.clone();
                                                        move |_| {
                                                            let mut fs = form_state();
                                                            if fs.disabled_units.contains(&ut_clone) {
                                                                fs.disabled_units.retain(|u| u != &ut_clone);
                                                            } else {
                                                                fs.disabled_units.push(ut_clone.clone());
                                                            }
                                                            form_state.set(fs.clone());
                                                            if let Ok(json) = serde_json::to_string(&fs) {
                                                                emit_form_change(&json);
                                                            }
                                                        }
                                                    },
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Footer
                    div {
                        class: "p-6 pt-4 border-t border-white/10 bg-black/20",
                        button {
                            class: "w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0",
                            onclick: on_start,
                            "{props.translations.start}"
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// Root component and WASM exports
// ============================================================================

fn SinglePlayerModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());

    match state {
        Some(state) => rsx! {
            SinglePlayerModal {
                translations: state.translations,
                maps: state.maps,
                difficulties: state.difficulties,
                unit_options: state.unit_options,
                team_count_options: state.team_count_options,
            }
        },
        None => rsx! { div { class: "hidden" } },
    }
}

/// Launch the single player modal
pub fn launch_single_player_modal(
    translations_json: &str,
    maps_json: &str,
    difficulties_json: &str,
    unit_options_json: &str,
    team_count_options_json: &str,
) {
    log::info!("Launching single player modal");

    let translations: SinglePlayerTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();
    let maps: Vec<MapCategory> = serde_json::from_str(maps_json).unwrap_or_default();
    let difficulties: Vec<DifficultyOption> =
        serde_json::from_str(difficulties_json).unwrap_or_default();
    let unit_options: Vec<UnitOption> = serde_json::from_str(unit_options_json).unwrap_or_default();
    let team_count_options: Vec<TeamCountOption> =
        serde_json::from_str(team_count_options_json).unwrap_or_default();

    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(SinglePlayerModalState {
            translations,
            maps,
            difficulties,
            unit_options,
            team_count_options,
        });
    });

    let config = dioxus::web::Config::new().rootname("dioxus-single-player-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(SinglePlayerModalRoot);
}

/// Show the modal
pub fn show_single_player_modal() {
    log::debug!("show_single_player_modal called");

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(true);
        }
    });
}

/// Hide the modal
pub fn hide_single_player_modal() {
    log::debug!("hide_single_player_modal called");

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(false);
        }
    });

    // Reset form state
    FORM_STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(SinglePlayerFormState::default());
        }
    });
}

/// Update form state from TypeScript
pub fn update_single_player_form(form_json: &str) {
    log::debug!("update_single_player_form called");

    if let Ok(form) = serde_json::from_str::<SinglePlayerFormState>(form_json) {
        FORM_STATE_SIGNAL.with(|s| {
            if let Some(mut signal) = s.borrow().clone() {
                signal.set(form);
            }
        });
    }
}

/// Update achievements data
pub fn update_single_player_achievements(achievements_json: &str) {
    log::debug!("update_single_player_achievements called");

    if let Ok(data) = serde_json::from_str::<AchievementsData>(achievements_json) {
        ACHIEVEMENTS_SIGNAL.with(|s| {
            if let Some(mut signal) = s.borrow().clone() {
                signal.set(data);
            }
        });
    }
}
