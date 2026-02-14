//! UnitDisplay component
//!
//! A bottom-center toolbar showing buildable unit icons with tooltips,
//! hotkeys, counts, and selected/disabled states.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the unit display web component
pub fn register() {
    log::debug!("Registered <dioxus-unit-display> component");
}

// Thread-local storage for signals
thread_local! {
    static STATE_SIGNAL: RefCell<Option<Signal<UnitDisplayState>>> = const { RefCell::new(None) };
}

/// State for the entire unit display (passed from TypeScript as JSON)
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitDisplayState {
    pub is_visible: bool,
    pub items: Vec<UnitItem>,
}

/// State for a single unit item
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitItem {
    pub icon_url: String,
    pub count: Option<String>,
    pub unit_type: String,
    pub structure_key: String,
    pub hotkey: String,
    pub can_build: bool,
    pub is_selected: bool,
    pub cost: String,
    pub name: String,
    pub description: String,
    pub group: u8,
}

fn emit_click_event(unit_type: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_UNIT_DISPLAY_CLICK),
        Some("component.unit-display"),
        json!({ "unitType": unit_type }),
    );
}

fn emit_hover_event(unit_type: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_UNIT_DISPLAY_HOVER),
        Some("component.unit-display"),
        json!({ "unitType": unit_type }),
    );
}

fn emit_unhover_event() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_UNIT_DISPLAY_UNHOVER),
        Some("component.unit-display"),
        json!({}),
    );
}

/// Main UnitDisplay component
#[component]
pub fn UnitDisplay() -> Element {
    let state = use_signal(UnitDisplayState::default);
    let mut hovered_unit = use_signal(|| Option::<String>::None);

    STATE_SIGNAL.with(|s| *s.borrow_mut() = Some(state));

    let current_state = state();

    if !current_state.is_visible || current_state.items.is_empty() {
        return rsx! {};
    }

    // Split items into two groups
    let group0: Vec<&UnitItem> = current_state
        .items
        .iter()
        .filter(|i| i.group == 0)
        .collect();
    let group1: Vec<&UnitItem> = current_state
        .items
        .iter()
        .filter(|i| i.group == 1)
        .collect();

    rsx! {
        div {
            class: "hidden 2xl:flex lg:flex fixed bottom-4 left-1/2 transform -translate-x-1/2 z-1100 2xl:flex-row xl:flex-col lg:flex-col 2xl:gap-5 xl:gap-2 lg:gap-2 justify-center items-center",
            // Group 0: Buildings
            if !group0.is_empty() {
                div {
                    class: "bg-gray-800/70 backdrop-blur-xs rounded-lg p-0.5",
                    div {
                        class: "grid grid-rows-1 auto-cols-max grid-flow-col gap-1 w-fit",
                        for item in group0.iter() {
                            {
                                let unit_type = item.unit_type.clone();
                                let unit_type_click = item.unit_type.clone();
                                let unit_type_hover = item.unit_type.clone();
                                let icon_url = item.icon_url.clone();
                                let count = item.count.clone();
                                let hotkey = item.hotkey.clone();
                                let can_build = item.can_build;
                                let is_selected = item.is_selected;
                                let cost = item.cost.clone();
                                let name = item.name.clone();
                                let description = item.description.clone();
                                let structure_key = item.structure_key.clone();
                                let is_hovered = hovered_unit().as_deref() == Some(unit_type.as_str());

                                rsx! {
                                    div {
                                        class: "flex flex-col items-center relative",
                                        onmouseenter: {
                                            let ut = unit_type.clone();
                                            move |_| {
                                                hovered_unit.set(Some(ut.clone()));
                                            }
                                        },
                                        onmouseleave: move |_| {
                                            hovered_unit.set(None);
                                        },
                                        // Tooltip
                                        if is_hovered {
                                            div {
                                                class: "absolute -top-[250%] left-1/2 -translate-x-1/2 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-20 shadow-lg pointer-events-none",
                                                div {
                                                    class: "font-bold text-sm mb-1",
                                                    "{name} [{hotkey}]"
                                                }
                                                div {
                                                    class: "p-2",
                                                    "{description}"
                                                }
                                                div {
                                                    span {
                                                        class: "text-yellow-300",
                                                        "{cost}"
                                                    }
                                                }
                                            }
                                        }
                                        // Unit button
                                        div {
                                            class: {
                                                let mut classes = String::from("border border-slate-500 rounded-sm pr-2 pb-1 flex items-center gap-2 cursor-pointer rounded-sm text-white");
                                                if !can_build {
                                                    classes.push_str(" opacity-40");
                                                }
                                                if is_selected {
                                                    classes.push_str(" hover:bg-gray-400/10 bg-slate-400/20");
                                                } else {
                                                    classes.push_str(" hover:bg-gray-800");
                                                }
                                                classes
                                            },
                                            onclick: move |_| {
                                                emit_click_event(&unit_type_click);
                                            },
                                            onmouseenter: {
                                                let ut = unit_type_hover.clone();
                                                move |_| {
                                                    emit_hover_event(&ut);
                                                }
                                            },
                                            onmouseleave: move |_| {
                                                emit_unhover_event();
                                            },
                                            div {
                                                class: "ml-1 text-xs relative -top-1.5 text-gray-400",
                                                "{hotkey}"
                                            }
                                            div {
                                                class: "flex items-center gap-1 pt-1",
                                                img {
                                                    src: "{icon_url}",
                                                    alt: "{structure_key}",
                                                    class: "align-middle size-6",
                                                }
                                                if let Some(ref c) = count {
                                                    span { "{c}" }
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
            // Group 1: Military
            if !group1.is_empty() {
                div {
                    class: "bg-gray-800/70 backdrop-blur-xs rounded-lg p-0.5 w-fit",
                    div {
                        class: "grid grid-rows-1 auto-cols-max grid-flow-col gap-1",
                        for item in group1.iter() {
                            {
                                let unit_type = item.unit_type.clone();
                                let unit_type_click = item.unit_type.clone();
                                let unit_type_hover = item.unit_type.clone();
                                let icon_url = item.icon_url.clone();
                                let count = item.count.clone();
                                let hotkey = item.hotkey.clone();
                                let can_build = item.can_build;
                                let is_selected = item.is_selected;
                                let cost = item.cost.clone();
                                let name = item.name.clone();
                                let description = item.description.clone();
                                let structure_key = item.structure_key.clone();
                                let is_hovered = hovered_unit().as_deref() == Some(unit_type.as_str());

                                rsx! {
                                    div {
                                        class: "flex flex-col items-center relative",
                                        onmouseenter: {
                                            let ut = unit_type.clone();
                                            move |_| {
                                                hovered_unit.set(Some(ut.clone()));
                                            }
                                        },
                                        onmouseleave: move |_| {
                                            hovered_unit.set(None);
                                        },
                                        // Tooltip
                                        if is_hovered {
                                            div {
                                                class: "absolute -top-[250%] left-1/2 -translate-x-1/2 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-20 shadow-lg pointer-events-none",
                                                div {
                                                    class: "font-bold text-sm mb-1",
                                                    "{name} [{hotkey}]"
                                                }
                                                div {
                                                    class: "p-2",
                                                    "{description}"
                                                }
                                                div {
                                                    span {
                                                        class: "text-yellow-300",
                                                        "{cost}"
                                                    }
                                                }
                                            }
                                        }
                                        // Unit button
                                        div {
                                            class: {
                                                let mut classes = String::from("border border-slate-500 rounded-sm pr-2 pb-1 flex items-center gap-2 cursor-pointer rounded-sm text-white");
                                                if !can_build {
                                                    classes.push_str(" opacity-40");
                                                }
                                                if is_selected {
                                                    classes.push_str(" hover:bg-gray-400/10 bg-slate-400/20");
                                                } else {
                                                    classes.push_str(" hover:bg-gray-800");
                                                }
                                                classes
                                            },
                                            onclick: move |_| {
                                                emit_click_event(&unit_type_click);
                                            },
                                            onmouseenter: {
                                                let ut = unit_type_hover.clone();
                                                move |_| {
                                                    emit_hover_event(&ut);
                                                }
                                            },
                                            onmouseleave: move |_| {
                                                emit_unhover_event();
                                            },
                                            div {
                                                class: "ml-1 text-xs relative -top-1.5 text-gray-400",
                                                "{hotkey}"
                                            }
                                            div {
                                                class: "flex items-center gap-1 pt-1",
                                                img {
                                                    src: "{icon_url}",
                                                    alt: "{structure_key}",
                                                    class: "align-middle size-6",
                                                }
                                                if let Some(ref c) = count {
                                                    span { "{c}" }
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

/// Root component
fn UnitDisplayRoot() -> Element {
    rsx! { UnitDisplay {} }
}

/// Launch the unit display component
pub fn launch_unit_display() {
    log::info!("Launching unit display");
    let config = dioxus::web::Config::new().rootname("dioxus-unit-display-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(UnitDisplayRoot);
}

/// Update the unit display state
pub fn update_unit_display(state_json: &str) {
    let state: UnitDisplayState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse unit display state: {}", e);
            return;
        }
    };
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(state);
        }
    });
}
