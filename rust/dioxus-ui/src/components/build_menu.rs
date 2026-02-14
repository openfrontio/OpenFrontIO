//! BuildMenu component
//!
//! A build menu for constructing game units.
//! Shows a grid of build buttons with icons, names, costs, and counts.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the build menu web component
pub fn register() {
    log::debug!("Registered <dioxus-build-menu> component");
}

// Thread-local storage for signals
thread_local! {
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static ITEMS_SIGNAL: RefCell<Option<Signal<Vec<BuildMenuItemState>>>> = const { RefCell::new(None) };
    static INIT_STATE: RefCell<Option<BuildMenuInitState>> = const { RefCell::new(None) };
}

/// State for a build menu item (passed from TypeScript)
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildMenuItemState {
    pub unit_type: String,
    pub icon: String,
    pub description: String,
    pub name: String,
    pub countable: bool,
    pub can_build: bool,
    pub can_upgrade: bool,
    pub upgrade_unit_id: Option<u32>,
    pub cost: String,
    pub count: String,
}

impl Default for BuildMenuItemState {
    fn default() -> Self {
        Self {
            unit_type: String::new(),
            icon: String::new(),
            description: String::new(),
            name: String::new(),
            countable: false,
            can_build: false,
            can_upgrade: false,
            upgrade_unit_id: None,
            cost: "0".to_string(),
            count: "0".to_string(),
        }
    }
}

/// Translations
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildMenuTranslations {
    pub not_enough_money: String,
}

impl Default for BuildMenuTranslations {
    fn default() -> Self {
        Self {
            not_enough_money: "Not enough money".to_string(),
        }
    }
}

/// Init state
#[derive(Clone)]
pub struct BuildMenuState {
    pub translations: BuildMenuTranslations,
}

#[derive(Clone)]
struct BuildMenuInitState {
    translations: BuildMenuTranslations,
}

/// Props
#[derive(Props, Clone, PartialEq)]
pub struct BuildMenuProps {
    pub translations: BuildMenuTranslations,
}

const GOLD_COIN_ICON: &str = "/images/GoldCoinIcon.svg";

fn emit_select_event(unit_type: &str, can_upgrade: bool, upgrade_unit_id: Option<u32>) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_BUILD_MENU_SELECTED),
        Some("component.build-menu"),
        json!({
            "unitType": unit_type,
            "canUpgrade": can_upgrade,
            "upgradeUnitId": upgrade_unit_id,
        }),
    );
}

fn emit_close_event() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_BUILD_MENU_CLOSED),
        Some("component.build-menu"),
        json!({}),
    );
}

/// Main BuildMenu component
#[component]
pub fn BuildMenu(props: BuildMenuProps) -> Element {
    let mut is_visible = use_signal(|| false);
    let items = use_signal(|| Vec::<BuildMenuItemState>::new());

    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));
    ITEMS_SIGNAL.with(|s| *s.borrow_mut() = Some(items));

    let translations = props.translations.clone();

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    let current_items = items();

    rsx! {
        div {
            class: "build-menu",
            oncontextmenu: move |e| { e.prevent_default(); },
            style: "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999; background-color: #1e1e1e; padding: 15px; box-shadow: 0 0 20px rgba(0, 0, 0, 0.5); border-radius: 10px; display: flex; flex-direction: column; align-items: center; max-width: 95vw; max-height: 95vh; overflow-y: auto;",
            div {
                class: "build-row",
                style: "display: flex; justify-content: center; flex-wrap: wrap; width: 100%;",
                for item in current_items.iter() {
                    {
                        let unit_type = item.unit_type.clone();
                        let icon = item.icon.clone();
                        let name = item.name.clone();
                        let description = item.description.clone();
                        let cost = item.cost.clone();
                        let count = item.count.clone();
                        let countable = item.countable;
                        let enabled = item.can_build || item.can_upgrade;
                        let can_upgrade = item.can_upgrade;
                        let upgrade_unit_id = item.upgrade_unit_id;
                        let disabled_tooltip = if !enabled {
                            translations.not_enough_money.clone()
                        } else {
                            String::new()
                        };
                        let ut_click = unit_type.clone();

                        let btn_style = if enabled {
                            "position: relative; width: 120px; height: 140px; border: 2px solid #444; background-color: #2c2c2c; color: white; border-radius: 12px; cursor: pointer; transition: all 0.3s ease; display: flex; flex-direction: column; justify-content: center; align-items: center; margin: 8px; padding: 10px; gap: 5px;"
                        } else {
                            "position: relative; width: 120px; height: 140px; border: 2px solid #333; background-color: #1a1a1a; color: white; border-radius: 12px; cursor: not-allowed; transition: all 0.3s ease; display: flex; flex-direction: column; justify-content: center; align-items: center; margin: 8px; padding: 10px; gap: 5px; opacity: 0.7;"
                        };

                        let img_style = if !enabled { "opacity: 0.5;" } else { "" };
                        let cost_style = if !enabled { "font-size: 14px; color: #ff4444;" } else { "font-size: 14px;" };

                        let chip_style = if enabled {
                            "position: absolute; top: -10px; right: -10px; background-color: #2c2c2c; color: white; padding: 2px 10px; border-radius: 10000px; font-size: 12px; display: flex; justify-content: center; align-content: center; border: 1px solid #444;"
                        } else {
                            "position: absolute; top: -10px; right: -10px; background-color: #1a1a1a; color: white; padding: 2px 10px; border-radius: 10000px; font-size: 12px; display: flex; justify-content: center; align-content: center; border: 1px solid #333;"
                        };

                        rsx! {
                            button {
                                class: "build-button",
                                disabled: !enabled,
                                title: "{disabled_tooltip}",
                                style: "{btn_style}",
                                onclick: move |_| {
                                    emit_select_event(&ut_click, can_upgrade, upgrade_unit_id);
                                    is_visible.set(false);
                                    emit_close_event();
                                },
                                img {
                                    src: "{icon}",
                                    alt: "{unit_type}",
                                    width: "40",
                                    height: "40",
                                    style: "{img_style}"
                                }
                                span {
                                    style: "font-size: 14px; font-weight: bold; margin-bottom: 5px; text-align: center;",
                                    "{name}"
                                }
                                span {
                                    style: "font-size: 0.6rem;",
                                    "{description}"
                                }
                                span {
                                    style: "{cost_style}",
                                    "{cost} "
                                    img {
                                        src: GOLD_COIN_ICON,
                                        alt: "gold",
                                        width: "12",
                                        height: "12",
                                        style: "vertical-align: middle;"
                                    }
                                }
                                if countable {
                                    div {
                                        style: "{chip_style}",
                                        span {
                                            style: "font-weight: bold; font-size: 14px;",
                                            "{count}"
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
fn BuildMenuRoot() -> Element {
    let state = INIT_STATE.with(|s| s.borrow().clone());
    match state {
        Some(state) => rsx! {
            BuildMenu { translations: state.translations }
        },
        None => rsx! { div { class: "hidden" } },
    }
}

/// Launch the build menu component
pub fn launch_build_menu(translations_json: &str) {
    log::info!("Launching build menu");
    let translations: BuildMenuTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse build menu translations: {}", e);
            BuildMenuTranslations::default()
        }
    };
    INIT_STATE.with(|s| {
        *s.borrow_mut() = Some(BuildMenuInitState { translations });
    });
    let config = dioxus::web::Config::new().rootname("dioxus-build-menu-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(BuildMenuRoot);
}

/// Show the build menu with items
pub fn show_build_menu(items_json: &str) {
    let items: Vec<BuildMenuItemState> = match serde_json::from_str(items_json) {
        Ok(i) => i,
        Err(e) => {
            log::error!("Failed to parse build menu items: {}", e);
            Vec::new()
        }
    };
    ITEMS_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(items);
        }
    });
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(true);
        }
    });
}

/// Hide the build menu
pub fn hide_build_menu() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(false);
        }
    });
}

/// Update items during tick
pub fn update_build_menu_items(items_json: &str) {
    let items: Vec<BuildMenuItemState> = match serde_json::from_str(items_json) {
        Ok(i) => i,
        Err(e) => {
            log::error!("Failed to parse build menu items for update: {}", e);
            return;
        }
    };
    ITEMS_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(items);
        }
    });
}
