//! SendResourceModal component
//!
//! A modal for sending troops or gold to another player.
//! Features slider, preset percentages, capacity limits, and summary.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the send resource modal web component
pub fn register() {
    log::debug!("Registered <dioxus-send-resource-modal> component");
}

// Thread-local storage for signals
thread_local! {
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static TOTAL_SIGNAL: RefCell<Option<Signal<f64>>> = const { RefCell::new(None) };
    static MODE_SIGNAL: RefCell<Option<Signal<ResourceMode>>> = const { RefCell::new(None) };
    static MODAL_DATA_SIGNAL: RefCell<Option<Signal<SendResourceModalData>>> = const { RefCell::new(None) };
    static MODAL_STATE: RefCell<Option<SendResourceModalInitState>> = const { RefCell::new(None) };
}

/// Resource mode
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceMode {
    Troops,
    Gold,
}

impl Default for ResourceMode {
    fn default() -> Self {
        Self::Troops
    }
}

/// Modal data updated at runtime
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResourceModalData {
    pub target_name: String,
    pub target_alive: bool,
    pub sender_alive: bool,
    pub capacity_left: Option<f64>,
    pub heading: Option<String>,
}

impl Default for SendResourceModalData {
    fn default() -> Self {
        Self {
            target_name: String::new(),
            target_alive: true,
            sender_alive: true,
            capacity_left: None,
            heading: None,
        }
    }
}

/// State passed from TypeScript for showing the modal
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResourceModalState {
    pub mode: ResourceMode,
    pub total: f64,
    pub target_name: String,
    pub target_alive: bool,
    pub sender_alive: bool,
    pub capacity_left: Option<f64>,
    pub heading: Option<String>,
}

/// Translations
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResourceTranslations {
    pub title_troops: String,
    pub title_gold: String,
    pub available: String,
    pub available_tooltip_troops: String,
    pub available_tooltip_gold: String,
    pub preset_max: String,
    pub aria_slider_troops: String,
    pub aria_slider_gold: String,
    pub summary_send: String,
    pub summary_keep: String,
    pub close_label: String,
    pub cancel: String,
    pub send: String,
    pub cap_label: String,
    pub cap_tooltip: String,
    pub capacity_note: String,
    pub target_dead_title: String,
    pub target_dead_note: String,
}

impl Default for SendResourceTranslations {
    fn default() -> Self {
        Self {
            title_troops: "Send Troops to {name}".to_string(),
            title_gold: "Send Gold to {name}".to_string(),
            available: "Available".to_string(),
            available_tooltip_troops: "Available troops".to_string(),
            available_tooltip_gold: "Available gold".to_string(),
            preset_max: "MAX".to_string(),
            aria_slider_troops: "Troop amount slider".to_string(),
            aria_slider_gold: "Gold amount slider".to_string(),
            summary_send: "Send".to_string(),
            summary_keep: "Keep".to_string(),
            close_label: "Close".to_string(),
            cancel: "Cancel".to_string(),
            send: "Send".to_string(),
            cap_label: "Cap".to_string(),
            cap_tooltip: "Target capacity limit".to_string(),
            capacity_note: "Capped at {amount}".to_string(),
            target_dead_title: "Target Eliminated".to_string(),
            target_dead_note: "This player has been eliminated.".to_string(),
        }
    }
}

/// Init state stored in thread-local
#[derive(Clone)]
struct SendResourceModalInitState {
    translations: SendResourceTranslations,
}

/// Props for the component
#[derive(Props, Clone, PartialEq)]
pub struct SendResourceModalProps {
    pub translations: SendResourceTranslations,
}

const PRESETS: [u32; 5] = [10, 25, 50, 75, 100];

fn within(val: f64, min: f64, max: f64) -> f64 {
    val.max(min).min(max)
}

fn format_number(num: f64) -> String {
    let num = num.max(0.0);
    if num >= 10_000_000.0 {
        let value = (num / 100_000.0).floor() / 10.0;
        format!("{:.1}M", value)
    } else if num >= 1_000_000.0 {
        let value = (num / 10_000.0).floor() / 100.0;
        format!("{:.2}M", value)
    } else if num >= 100_000.0 {
        format!("{}K", (num / 1000.0).floor() as u64)
    } else if num >= 10_000.0 {
        let value = (num / 100.0).floor() / 10.0;
        format!("{:.1}K", value)
    } else {
        format!("{}", num.floor() as u64)
    }
}

fn format_troops(num: f64) -> String {
    format_number(num / 10.0)
}

fn emit_close_event() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_SEND_RESOURCE_CLOSE_REQUEST),
        Some("component.send-resource-modal"),
        json!({}),
    );
}

fn emit_confirm_event(amount: f64, mode: ResourceMode) {
    let mode_str = match mode {
        ResourceMode::Troops => "troops",
        ResourceMode::Gold => "gold",
    };
    emit_ui_event(
        event_name(event_keys::UI_INGAME_SEND_RESOURCE_CONFIRM),
        Some("component.send-resource-modal"),
        json!({
            "amount": amount,
            "mode": mode_str,
        }),
    );
}

/// Main SendResourceModal component
#[component]
pub fn SendResourceModal(props: SendResourceModalProps) -> Element {
    let is_visible = use_signal(|| false);
    let total = use_signal(|| 0.0_f64);
    let mode = use_signal(|| ResourceMode::Troops);
    let modal_data = use_signal(|| SendResourceModalData::default());
    let mut send_amount = use_signal(|| 0.0_f64);
    let mut selected_percent = use_signal(|| Option::<u32>::Some(100));

    // Store signals for external updates
    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));
    TOTAL_SIGNAL.with(|s| *s.borrow_mut() = Some(total));
    MODE_SIGNAL.with(|s| *s.borrow_mut() = Some(mode));
    MODAL_DATA_SIGNAL.with(|s| *s.borrow_mut() = Some(modal_data));

    let translations = props.translations.clone();

    let current_mode = mode();
    let current_total = total();
    let data = modal_data();
    let sender_alive = data.sender_alive;
    let target_alive = data.target_alive;
    let dead = !sender_alive || !target_alive;

    let effective_total = if sender_alive { current_total } else { 0.0 };

    let capacity_left: Option<f64> = if !target_alive {
        Some(0.0)
    } else if current_mode == ResourceMode::Troops {
        data.capacity_left
    } else {
        None
    };

    let hard_max = match capacity_left {
        Some(cap) => effective_total.min(cap),
        None => effective_total,
    };

    let current_send = send_amount();
    let clamped_send = within(current_send, 0.0, hard_max);

    let percent_now = if effective_total > 0.0 {
        ((clamped_send / effective_total) * 100.0).round() as u32
    } else {
        0
    };

    let allowed = clamped_send;
    let keep = (effective_total - allowed).max(0.0);

    let format_fn: fn(f64) -> String = match current_mode {
        ResourceMode::Troops => format_troops,
        ResourceMode::Gold => format_number,
    };

    let fill_color = match current_mode {
        ResourceMode::Troops => "rgb(168 85 247)",
        ResourceMode::Gold => "rgb(234 179 8)",
    };

    let cap_percent: Option<u32> = match capacity_left {
        Some(cap) => {
            let basis = if effective_total > 0.0 {
                effective_total
            } else {
                1.0
            };
            let pct = ((cap.min(effective_total) / basis) * 100.0).round() as u32;
            Some(pct.max(0).min(100))
        }
        None => None,
    };

    let is_capped = allowed != current_send && current_mode == ResourceMode::Troops;
    let disabled_send_btn = effective_total <= 0.0 || clamped_send <= 0.0 || dead;

    let title = match &data.heading {
        Some(h) => h.clone(),
        None => {
            let name = &data.target_name;
            match current_mode {
                ResourceMode::Troops => translations.title_troops.replace("{name}", name),
                ResourceMode::Gold => translations.title_gold.replace("{name}", name),
            }
        }
    };

    let min_keep_ratio = match current_mode {
        ResourceMode::Troops => 0.3,
        ResourceMode::Gold => 0.0,
    };
    let below_min_keep = min_keep_ratio > 0.0 && keep < (effective_total * min_keep_ratio).floor();

    let slider_outer_mb = if cap_percent.is_some() {
        "mb-8"
    } else {
        "mb-2"
    };
    let slider_disabled = effective_total <= 0.0 || dead;

    let style_str = format!(
        "--percent:{}%; --fill:{}; --track: rgba(255,255,255,.28); --thumb-ring: rgb(24 24 27);",
        percent_now, fill_color
    );

    let tooltip_text = format!("{}% - {}", percent_now, format_fn(clamped_send));

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    let formatted_total = format_fn(effective_total);
    let formatted_allowed = format_fn(allowed);
    let formatted_keep = format_fn(keep);

    let capacity_note_text = if is_capped {
        translations
            .capacity_note
            .replace("{amount}", &format_fn(allowed))
    } else {
        String::new()
    };

    let available_tooltip = match current_mode {
        ResourceMode::Troops => translations.available_tooltip_troops.clone(),
        ResourceMode::Gold => translations.available_tooltip_gold.clone(),
    };

    let aria_slider = match current_mode {
        ResourceMode::Troops => translations.aria_slider_troops.clone(),
        ResourceMode::Gold => translations.aria_slider_gold.clone(),
    };

    let keep_color_class = if below_min_keep {
        "font-semibold font-mono text-amber-400"
    } else {
        "font-semibold font-mono text-emerald-400"
    };

    rsx! {
        div {
            class: "absolute inset-0 z-[1100] flex items-center justify-center p-4",
            div {
                class: "absolute inset-0 bg-black/60 rounded-2xl",
                onclick: move |_| { emit_close_event(); }
            }
            div {
                role: "dialog",
                aria_modal: "true",
                aria_labelledby: "send-title",
                class: "relative z-10 w-full max-w-[540px] focus:outline-hidden",
                tabindex: "0",
                onkeydown: move |e: KeyboardEvent| {
                    if e.key() == Key::Escape {
                        e.prevent_default();
                        emit_close_event();
                    }
                    if e.key() == Key::Enter {
                        e.prevent_default();
                        if !disabled_send_btn {
                            emit_confirm_event(clamped_send, current_mode);
                        }
                    }
                },
                div {
                    class: "rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200",
                    onclick: move |e: MouseEvent| { e.stop_propagation(); },

                    // Header
                    div {
                        class: "mb-3 flex items-center justify-between relative",
                        h2 {
                            id: "send-title",
                            class: "text-lg font-semibold tracking-tight text-zinc-100",
                            "{title}"
                        }
                        button {
                            r#type: "button",
                            class: "absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus:outline-hidden",
                            aria_label: "{translations.close_label}",
                            title: "{translations.close_label}",
                            onclick: move |_| { emit_close_event(); },
                            "x"
                        }
                    }

                    // Available chip
                    div {
                        class: "mb-4 pb-3 border-b border-zinc-800",
                        div {
                            class: "flex items-center gap-2 text-[13px]",
                            span {
                                class: "inline-flex items-center gap-1 rounded-full bg-indigo-600/15 px-2 py-0.5 ring-1 ring-indigo-400/40 text-indigo-100",
                                title: "{available_tooltip}",
                                span { class: "opacity-90", "{translations.available}" }
                                span { class: "font-mono tabular-nums", "{formatted_total}" }
                            }
                        }
                    }

                    // Dead note
                    if !target_alive {
                        div {
                            class: "mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200 text-sm",
                            div { class: "font-semibold", "{translations.target_dead_title}" }
                            div { "{translations.target_dead_note}" }
                        }
                    }

                    // Preset buttons
                    div {
                        class: "mb-8 grid grid-cols-5 gap-2",
                        for preset in PRESETS.iter() {
                            {
                                let pct = (*preset).max(0).min(100);
                                let active = selected_percent().unwrap_or(percent_now) == pct;
                                let label = if pct == 100 {
                                    translations.preset_max.clone()
                                } else {
                                    format!("{}%", pct)
                                };
                                let btn_class = if dead {
                                    "rounded-lg px-3 py-2 text-sm ring-1 transition bg-zinc-800/70 text-zinc-400 ring-zinc-700 cursor-not-allowed"
                                } else if active {
                                    "rounded-lg px-3 py-2 text-sm ring-1 transition bg-indigo-600 text-white ring-indigo-300/60"
                                } else {
                                    "rounded-lg px-3 py-2 text-sm ring-1 transition bg-zinc-800 text-zinc-200 ring-zinc-700 hover:bg-zinc-700 hover:text-zinc-50"
                                };
                                let title_str = format!("{}%", pct);

                                rsx! {
                                    button {
                                        key: "{pct}",
                                        disabled: dead,
                                        class: "{btn_class}",
                                        title: "{title_str}",
                                        onclick: move |_| {
                                            if dead { return; }
                                            selected_percent.set(Some(pct));
                                            let raw = (effective_total * pct as f64 / 100.0).floor();
                                            let clamped = within(raw, 0.0, hard_max);
                                            send_amount.set(clamped);
                                        },
                                        "{label}"
                                    }
                                }
                            }
                        }
                    }

                    // Slider
                    div {
                        class: "{slider_outer_mb}",
                        div {
                            class: "relative px-1 rounded-lg overflow-visible focus-within:ring-2 focus-within:ring-indigo-500/30",
                            input {
                                r#type: "range",
                                min: "0",
                                max: "{effective_total}",
                                value: "{clamped_send}",
                                disabled: slider_disabled,
                                class: "w-full appearance-none bg-transparent range-x focus:outline-hidden",
                                aria_label: "{aria_slider}",
                                aria_valuemin: "0",
                                aria_valuemax: "{hard_max}",
                                aria_valuetext: "{tooltip_text}",
                                style: "{style_str}",
                                oninput: move |e: FormEvent| {
                                    if dead { return; }
                                    if let Ok(raw) = e.value().parse::<f64>() {
                                        let pct_raw = if effective_total > 0.0 {
                                            ((raw / effective_total) * 100.0).round() as u32
                                        } else { 0 };
                                        selected_percent.set(Some(pct_raw.max(0).min(100)));
                                        let clamped = raw.min(hard_max);
                                        send_amount.set(within(clamped, 0.0, hard_max));
                                    }
                                }
                            }
                            // Tooltip
                            div {
                                class: "pointer-events-none absolute -top-6 -translate-x-1/2 select-none",
                                style: "left: {percent_now}%",
                                div {
                                    class: "rounded-sm bg-[#0f1116] ring-1 ring-zinc-700 text-zinc-100 px-1.5 py-0.5 text-[12px] shadow-sm whitespace-nowrap w-max z-50",
                                    "{percent_now}% - {formatted_allowed}"
                                }
                            }
                            // Cap marker
                            if let Some(cp) = cap_percent {
                                div {
                                    class: "pointer-events-none absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-amber-400/80 shadow-sm",
                                    style: "left: {cp}%",
                                    title: "{translations.cap_tooltip}"
                                }
                                div {
                                    class: "pointer-events-none absolute top-full mt-1.5 -translate-x-1/2 select-none",
                                    style: "left: {cp}%",
                                    div {
                                        class: "rounded-sm bg-[#0f1116] ring-1 ring-amber-400/40 text-amber-200 px-1 py-0.5 text-[11px] shadow-sm whitespace-nowrap",
                                        "{translations.cap_label}"
                                    }
                                }
                            }
                        }
                    }

                    // Capacity note
                    if is_capped {
                        p { class: "mt-1 text-xs text-amber-300", "{capacity_note_text}" }
                    }

                    // Summary
                    div {
                        class: "mt-3 text-center text-sm text-zinc-200",
                        "{translations.summary_send} "
                        span { class: "font-semibold text-indigo-400 font-mono", "{formatted_allowed}" }
                        " - {translations.summary_keep} "
                        span { class: "{keep_color_class}", "{formatted_keep}" }
                    }

                    // Actions
                    div {
                        class: "mt-5 flex justify-end gap-2",
                        button {
                            class: "h-10 min-w-24 rounded-lg px-3 text-sm font-semibold text-zinc-100 bg-zinc-800 ring-1 ring-zinc-700 hover:bg-zinc-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/20",
                            onclick: move |_| { emit_close_event(); },
                            "{translations.cancel}"
                        }
                        button {
                            class: "h-10 min-w-24 rounded-lg px-3 text-sm font-semibold text-white bg-indigo-600 enabled:hover:bg-indigo-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400/50 disabled:cursor-not-allowed disabled:opacity-50",
                            disabled: disabled_send_btn,
                            onclick: move |_| {
                                if !disabled_send_btn {
                                    emit_confirm_event(clamped_send, current_mode);
                                }
                            },
                            "{translations.send}"
                        }
                    }

                    // Slider styles
                    style {
                        r#"
                        .range-x {{
                            -webkit-appearance: none;
                            appearance: none;
                            height: 8px;
                            outline: none;
                            background: transparent;
                        }}
                        .range-x::-webkit-slider-runnable-track {{
                            height: 8px;
                            border-radius: 9999px;
                            background: linear-gradient(90deg, var(--fill) 0, var(--fill) var(--percent), rgba(255,255,255,0.22) var(--percent), rgba(255,255,255,0.22) 100%);
                        }}
                        .range-x::-webkit-slider-thumb {{
                            -webkit-appearance: none;
                            height: 18px;
                            width: 18px;
                            border-radius: 9999px;
                            background: var(--fill);
                            border: 3px solid var(--thumb-ring);
                            margin-top: -5px;
                        }}
                        .range-x::-moz-range-track {{
                            height: 8px;
                            border-radius: 9999px;
                            background: rgba(255,255,255,0.22);
                        }}
                        .range-x::-moz-range-progress {{
                            height: 8px;
                            border-radius: 9999px;
                            background: var(--fill);
                        }}
                        .range-x::-moz-range-thumb {{
                            height: 18px;
                            width: 18px;
                            border-radius: 9999px;
                            background: var(--fill);
                            border: 3px solid var(--thumb-ring);
                        }}
                        "#
                    }
                }
            }
        }
    }
}

/// Root component that reads props from thread-local storage
fn SendResourceModalRoot() -> Element {
    let state = MODAL_STATE.with(|s| s.borrow().clone());
    match state {
        Some(state) => rsx! {
            SendResourceModal { translations: state.translations }
        },
        None => rsx! { div { class: "hidden" } },
    }
}

/// Launch the send resource modal component
pub fn launch_send_resource_modal(translations_json: &str) {
    log::info!("Launching send resource modal");
    let translations: SendResourceTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse send resource translations: {}", e);
            SendResourceTranslations::default()
        }
    };
    MODAL_STATE.with(|s| {
        *s.borrow_mut() = Some(SendResourceModalInitState { translations });
    });
    let config = dioxus::web::Config::new().rootname("dioxus-send-resource-modal-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(SendResourceModalRoot);
}

/// Show the modal with the given state
pub fn show_send_resource_modal(state_json: &str) {
    let state: SendResourceModalState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse send resource modal state: {}", e);
            return;
        }
    };
    MODE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(state.mode);
        }
    });
    TOTAL_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(state.total);
        }
    });
    MODAL_DATA_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(SendResourceModalData {
                target_name: state.target_name,
                target_alive: state.target_alive,
                sender_alive: state.sender_alive,
                capacity_left: state.capacity_left,
                heading: state.heading,
            });
        }
    });
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(true);
        }
    });
}

/// Hide the modal
pub fn hide_send_resource_modal() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(false);
        }
    });
}

/// Update totals during tick
pub fn update_send_resource_total(
    total: f64,
    mode: &str,
    capacity_left: f64,
    has_capacity: bool,
    target_alive: bool,
    sender_alive: bool,
) {
    TOTAL_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(total);
        }
    });
    let resource_mode = match mode {
        "gold" => ResourceMode::Gold,
        _ => ResourceMode::Troops,
    };
    MODE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(resource_mode);
        }
    });
    MODAL_DATA_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            let mut data = signal.peek().clone();
            data.capacity_left = if has_capacity {
                Some(capacity_left)
            } else {
                None
            };
            data.target_alive = target_alive;
            data.sender_alive = sender_alive;
            signal.set(data);
        }
    });
}
