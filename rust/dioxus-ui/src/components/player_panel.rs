//! PlayerPanel component
//!
//! Displays a player profile panel with identity, resources, stats, alliances,
//! and action buttons. All game logic and event handling stays in the TS bridge;
//! this component only renders the serialized state.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<PlayerPanelState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerPanelState {
    is_visible: bool,
    // Identity
    player_name: String,
    player_flag: String,
    has_flag: bool,
    player_type_chip: Option<TypeChip>,
    is_traitor: bool,
    traitor_label: String,
    traitor_icon: String,
    traitor_duration: Option<String>,
    traitor_urgent: bool,
    // Relation
    show_relation: bool,
    relation_class: String,
    relation_name: String,
    // Resources
    gold: String,
    gold_label: String,
    troops: String,
    troops_label: String,
    // Stats
    betrayals: u32,
    betrayals_label: String,
    trading_label: String,
    is_embargoed: bool,
    trading_stopped_label: String,
    trading_active_label: String,
    // Alliance expiry
    show_alliance_expiry: bool,
    alliance_time_remaining_label: String,
    alliance_expiry_text: String,
    alliance_expiry_color: String,
    // Alliances list
    alliances_label: String,
    none_label: String,
    allies: Vec<AllyEntry>,
    // Rocket direction toggle
    show_rocket_toggle: bool,
    rocket_toggle_label: String,
    rocket_direction_label: String,
    // Action buttons
    actions: Vec<ActionButton>,
    // Secondary actions (embargo/alliance row)
    secondary_actions: Vec<ActionButton>,
    // Self-trade actions (stop/start trading all)
    self_trade_actions: Vec<ActionButton>,
    // Moderation
    show_moderation: bool,
    moderation_action: Option<ActionButton>,
    // Translations
    close_label: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeChip {
    label: String,
    icon: String,
    classes: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AllyEntry {
    name: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionButton {
    id: String,
    label: String,
    title: String,
    icon: String,
    icon_alt: String,
    btn_type: String, // "normal", "yellow", "green", "red", "indigo"
    disabled: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-player-panel> component");
}

fn emit_no_payload(event_key: &str) {
    emit_ui_event(
        event_name(event_key),
        Some("component.player-panel"),
        json!({}),
    );
}

fn emit_action(action_id: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_PLAYER_PANEL_ACTION),
        Some("component.player-panel"),
        json!({ "actionId": action_id }),
    );
}

fn get_btn_classes(btn_type: &str) -> &'static str {
    match btn_type {
        "yellow" => "border-amber-400/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200",
        "green" => {
            "border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200"
        }
        "red" => "border-red-400/30 bg-red-500/10 hover:bg-red-500/20 text-red-200",
        "indigo" => "border-indigo-400/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200",
        _ => "border-zinc-400/20 bg-zinc-500/5 hover:bg-zinc-500/10 text-zinc-200",
    }
}

const PANEL_STYLE: &str = r#"
.traitor-ring {
    border-radius: 1rem;
    box-shadow:
        0 0 0 2px rgba(239, 68, 68, 0.34),
        0 0 12px 4px rgba(239, 68, 68, 0.22),
        inset 0 0 14px rgba(239, 68, 68, 0.13);
    animation: glowPulse 2.4s ease-in-out infinite;
}
@keyframes glowPulse {
    0%, 100% {
        box-shadow:
            0 0 0 2px rgba(239, 68, 68, 0.22),
            0 0 8px 2px rgba(239, 68, 68, 0.15),
            inset 0 0 8px rgba(239, 68, 68, 0.07);
    }
    50% {
        box-shadow:
            0 0 0 4px rgba(239, 68, 68, 0.38),
            0 0 18px 6px rgba(239, 68, 68, 0.26),
            inset 0 0 18px rgba(239, 68, 68, 0.15);
    }
}
"#;

fn render_action_button(btn: &ActionButton) -> Element {
    let classes = get_btn_classes(&btn.btn_type);
    let action_id = btn.id.clone();
    let disabled = btn.disabled;

    rsx! {
        button {
            class: "flex flex-col items-center gap-1 rounded-xl border px-2 py-1.5 text-center transition active:scale-[0.97] min-w-0 {classes}",
            disabled: disabled,
            title: "{btn.title}",
            onclick: move |e| {
                e.stop_propagation();
                if !disabled {
                    emit_action(&action_id);
                }
            },
            img {
                src: "{btn.icon}",
                alt: "{btn.icon_alt}",
                class: "size-5 shrink-0",
            }
            span {
                class: "text-[11px] leading-tight truncate w-full",
                "{btn.label}"
            }
        }
    }
}

#[component]
fn PlayerPanel() -> Element {
    let state = use_signal(PlayerPanelState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_visible {
        return rsx! {
            style { {PANEL_STYLE} }
        };
    }

    let ring_class = if s.is_traitor {
        "traitor-ring"
    } else {
        "ring-1 ring-white/5"
    };

    rsx! {
        style { {PANEL_STYLE} }
        div {
            class: "fixed inset-0 z-10001 flex items-center justify-center overflow-auto bg-black/15 backdrop-brightness-110 pointer-events-auto",
            oncontextmenu: |e| e.prevent_default(),
            onwheel: |e| e.stop_propagation(),
            onclick: move |_| emit_no_payload(event_keys::UI_INGAME_PLAYER_PANEL_CLOSE),

            div {
                class: "pointer-events-auto max-h-[90vh] min-w-75 max-w-100 px-4 py-2",
                onclick: |e| e.stop_propagation(),

                div {
                    class: "relative",
                    div {
                        class: "absolute inset-2 -z-10 rounded-2xl bg-black/25 backdrop-blur-[2px]",
                    }
                    div {
                        class: "relative w-full bg-zinc-900/95 rounded-2xl text-zinc-100 shadow-2xl shadow-black/50 {ring_class}",
                        div {
                            class: "overflow-visible",
                            div {
                                class: "overflow-auto [-webkit-overflow-scrolling:touch] resize-y max-h-[calc(100vh-120px-env(safe-area-inset-bottom))]",

                                // Close button
                                div {
                                    class: "sticky top-0 z-20 flex justify-end p-2",
                                    button {
                                        class: "absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors",
                                        "aria-label": "{s.close_label}",
                                        title: "{s.close_label}",
                                        onclick: move |e| {
                                            e.stop_propagation();
                                            emit_no_payload(event_keys::UI_INGAME_PLAYER_PANEL_CLOSE);
                                        },
                                        "\u{2715}"
                                    }
                                }

                                div {
                                    class: "p-6 flex flex-col gap-2 font-sans antialiased text-[14.5px] leading-relaxed",

                                    // Identity
                                    div {
                                        class: "mb-1",
                                        // Flag + Name + Type chip
                                        div {
                                            class: "flex items-center gap-2.5 flex-wrap",
                                            if s.has_flag {
                                                img {
                                                    src: "/flags/{s.player_flag}.svg",
                                                    alt: "Flag",
                                                    class: "h-10 w-10 rounded-full object-cover",
                                                }
                                            }
                                            div {
                                                class: "flex-1 min-w-0",
                                                h2 {
                                                    class: "text-xl font-bold tracking-[-0.01em] text-zinc-50 truncate",
                                                    title: "{s.player_name}",
                                                    "{s.player_name}"
                                                }
                                            }
                                            if let Some(ref chip) = s.player_type_chip {
                                                span {
                                                    class: "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold {chip.classes}",
                                                    role: "status",
                                                    span {
                                                        "aria-hidden": "true",
                                                        class: "leading-none",
                                                        "{chip.icon}"
                                                    }
                                                    span {
                                                        class: "tracking-tight",
                                                        "{chip.label}"
                                                    }
                                                }
                                            }
                                        }

                                        // Traitor badge
                                        if s.is_traitor {
                                            div {
                                                class: "mt-1",
                                                role: "status",
                                                span {
                                                    class: "inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-0.5 text-sm font-semibold text-red-200 shadow-[inset_0_0_8px_rgba(239,68,68,0.12)]",
                                                    title: "{s.traitor_label}",
                                                    img {
                                                        src: "{s.traitor_icon}",
                                                        alt: "",
                                                        "aria-hidden": "true",
                                                        class: "size-4.5",
                                                    }
                                                    span {
                                                        class: "tracking-tight",
                                                        "{s.traitor_label}"
                                                    }
                                                    if let Some(ref dur) = s.traitor_duration {
                                                        span {
                                                            class: if s.traitor_urgent { "mx-1 size-1 rounded-full bg-red-400/70 animate-pulse" } else { "mx-1 size-1 rounded-full bg-red-400/70" },
                                                        }
                                                        span {
                                                            class: "tabular-nums font-bold text-red-100 whitespace-nowrap text-sm",
                                                            "{dur}"
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        // Relation pill
                                        if s.show_relation {
                                            div {
                                                class: "mt-1",
                                                span {
                                                    class: "text-sm font-semibold {s.relation_class}",
                                                    "{s.relation_name}"
                                                }
                                            }
                                        }
                                    }

                                    // Divider
                                    hr { class: "border-zinc-700/60" }

                                    // Resources
                                    div {
                                        class: "mb-1 flex justify-between gap-2",
                                        div {
                                            class: "inline-flex items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 shrink-0 text-white w-35",
                                            span { class: "mr-0.5", "\u{1F4B0}" }
                                            span {
                                                "translate": "no",
                                                class: "tabular-nums w-[5ch] font-semibold",
                                                "{s.gold}"
                                            }
                                            span {
                                                class: "text-zinc-200 whitespace-nowrap",
                                                "{s.gold_label}"
                                            }
                                        }
                                        div {
                                            class: "inline-flex items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 text-white w-35 shrink-0",
                                            span { class: "mr-0.5", "\u{1F6E1}\u{FE0F}" }
                                            span {
                                                "translate": "no",
                                                class: "tabular-nums w-[5ch] font-semibold",
                                                "{s.troops}"
                                            }
                                            span {
                                                class: "text-zinc-200 whitespace-nowrap",
                                                "{s.troops_label}"
                                            }
                                        }
                                    }

                                    // Rocket direction toggle
                                    if s.show_rocket_toggle {
                                        hr { class: "border-zinc-700/60" }
                                        button {
                                            class: "flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-left text-white hover:bg-white/8 active:scale-[0.995] transition",
                                            onclick: move |e| {
                                                e.stop_propagation();
                                                emit_no_payload(event_keys::UI_INGAME_PLAYER_PANEL_TOGGLE_ROCKET);
                                            },
                                            div {
                                                class: "flex flex-col",
                                                span {
                                                    class: "text-sm font-semibold tracking-tight",
                                                    "{s.rocket_toggle_label}"
                                                }
                                                span {
                                                    class: "text-xs text-zinc-300",
                                                    "translate": "no",
                                                    "{s.rocket_direction_label}"
                                                }
                                            }
                                            span { class: "text-lg", "aria-hidden": "true", "\u{1F500}" }
                                        }
                                    }

                                    hr { class: "border-zinc-700/60" }

                                    // Stats: betrayals, trading
                                    div {
                                        class: "grid grid-cols-[auto_1fr] gap-x-6 gap-y-2",
                                        div {
                                            class: "flex items-center gap-2 text-[15px] font-medium text-zinc-100 leading-snug",
                                            span { "aria-hidden": "true", "\u{26A0}\u{FE0F}" }
                                            span { "{s.betrayals_label}" }
                                        }
                                        div {
                                            class: "text-right text-[14px] font-semibold text-zinc-200",
                                            "{s.betrayals}"
                                        }
                                    }
                                    div {
                                        class: "grid grid-cols-[auto_1fr] gap-x-6 gap-y-2",
                                        div {
                                            class: "flex items-center gap-2 text-[15px] font-medium text-zinc-100 leading-snug",
                                            span { "aria-hidden": "true", "\u{2693}" }
                                            span { "{s.trading_label}" }
                                        }
                                        div {
                                            class: "flex items-center justify-end gap-2 text-[14px] font-semibold",
                                            if s.is_embargoed {
                                                span { class: "text-amber-400", "{s.trading_stopped_label}" }
                                            } else {
                                                span { class: "text-blue-400", "{s.trading_active_label}" }
                                            }
                                        }
                                    }

                                    hr { class: "border-zinc-700/60" }

                                    // Alliances list
                                    div {
                                        class: "select-none",
                                        div {
                                            class: "flex items-center justify-between mb-2",
                                            div {
                                                class: "text-[15px] font-medium text-zinc-200",
                                                "{s.alliances_label}"
                                            }
                                            span {
                                                class: "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-[10px] text-[12px] text-zinc-100 bg-white/10 border border-white/20",
                                                "{s.allies.len()}"
                                            }
                                        }
                                        div {
                                            class: "rounded-lg bg-zinc-800/70 ring-1 ring-zinc-700/60 w-full min-w-0",
                                            ul {
                                                class: "max-h-30 overflow-y-auto p-2 flex flex-wrap gap-1.5 scrollbar-thin scrollbar-thumb-zinc-600 hover:scrollbar-thumb-zinc-500 scrollbar-track-zinc-800",
                                                role: "list",
                                                "translate": "no",
                                                if s.allies.is_empty() {
                                                    li {
                                                        class: "text-zinc-400 text-[14px] px-1",
                                                        "{s.none_label}"
                                                    }
                                                } else {
                                                    for (i, ally) in s.allies.iter().enumerate() {
                                                        li {
                                                            key: "{i}",
                                                            class: "max-w-full inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[14px] text-zinc-100 hover:bg-white/8 active:scale-[0.99] transition",
                                                            title: "{ally.name}",
                                                            span { class: "truncate", "{ally.name}" }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    // Alliance time remaining
                                    if s.show_alliance_expiry {
                                        div {
                                            class: "grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base",
                                            div {
                                                class: "font-semibold text-zinc-300",
                                                "{s.alliance_time_remaining_label}"
                                            }
                                            div {
                                                class: "text-right font-semibold",
                                                span {
                                                    class: "inline-flex items-center rounded-full px-2 py-0.5 text-[14px] font-bold {s.alliance_expiry_color}",
                                                    "{s.alliance_expiry_text}"
                                                }
                                            }
                                        }
                                    }

                                    hr { class: "border-zinc-700/60" }

                                    // Actions
                                    div {
                                        class: "flex flex-col gap-2.5",
                                        if !s.actions.is_empty() {
                                            div {
                                                class: "grid auto-cols-fr grid-flow-col gap-1",
                                                for btn in s.actions.iter() {
                                                    {render_action_button(btn)}
                                                }
                                            }
                                        }

                                        if !s.secondary_actions.is_empty() {
                                            hr { class: "border-zinc-700/60" }
                                            div {
                                                class: "grid auto-cols-fr grid-flow-col gap-1",
                                                for btn in s.secondary_actions.iter() {
                                                    {render_action_button(btn)}
                                                }
                                            }
                                        }

                                        if !s.self_trade_actions.is_empty() {
                                            div {
                                                class: "grid auto-cols-fr grid-flow-col gap-1",
                                                for btn in s.self_trade_actions.iter() {
                                                    {render_action_button(btn)}
                                                }
                                            }
                                        }

                                        // Moderation
                                        if s.show_moderation {
                                            hr { class: "border-zinc-700/60" }
                                            if let Some(ref btn) = s.moderation_action {
                                                div {
                                                    class: "grid auto-cols-fr grid-flow-col gap-1",
                                                    {render_action_button(btn)}
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
}

fn PlayerPanelRoot() -> Element {
    rsx! { PlayerPanel {} }
}

pub fn launch_player_panel() {
    log::info!("Launching player panel");
    let config = dioxus::web::Config::new().rootname("dioxus-player-panel-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(PlayerPanelRoot);
}

pub fn update_player_panel(state_json: &str) {
    let new_state: PlayerPanelState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse player panel state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
