//! RadialMenu component
//!
//! A radial/pie menu for in-game context actions.
//! Renders SVG sectors with icons, handles submenu navigation,
//! center button, tooltips, and viewport clamping.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;
use std::f64::consts::PI;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

pub fn register() {
    log::debug!("Registered <dioxus-radial-menu> component");
}

// ── Serialized types from TypeScript ──────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadialMenuItem {
    pub id: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub font_size: Option<String>,
    pub color: String,
    pub disabled: bool,
    pub has_submenu: bool,
    #[serde(default)]
    pub tooltip_html: Option<String>,
    #[serde(default)]
    pub cooldown: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadialMenuCenterButton {
    pub icon: String,
    pub color: String,
    pub icon_size: f64,
    pub disabled: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadialMenuConfig {
    #[serde(default = "default_back_icon")]
    pub back_icon: String,
}

fn default_back_icon() -> String {
    "/images/BackIconWhite.svg".to_string()
}

impl Default for RadialMenuConfig {
    fn default() -> Self {
        Self {
            back_icon: default_back_icon(),
        }
    }
}

// ── Internal state ───────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
struct MenuLevel {
    items: Vec<RadialMenuItem>,
}

#[derive(Clone)]
struct RadialMenuInitState {
    config: RadialMenuConfig,
}

// ── Thread-local signals ─────────────────────────────────────────

thread_local! {
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static ITEMS_SIGNAL: RefCell<Option<Signal<Vec<RadialMenuItem>>>> = const { RefCell::new(None) };
    static MENU_STACK_SIGNAL: RefCell<Option<Signal<Vec<MenuLevel>>>> = const { RefCell::new(None) };
    static CENTER_BUTTON_SIGNAL: RefCell<Option<Signal<Option<RadialMenuCenterButton>>>> = const { RefCell::new(None) };
    static POSITION_SIGNAL: RefCell<Option<Signal<(f64, f64)>>> = const { RefCell::new(None) };
    static INIT_STATE: RefCell<Option<RadialMenuInitState>> = const { RefCell::new(None) };
    static TOOLTIP_SIGNAL: RefCell<Option<Signal<Option<TooltipState>>>> = const { RefCell::new(None) };
    static TOOLTIP_POS_SIGNAL: RefCell<Option<Signal<(f64, f64)>>> = const { RefCell::new(None) };
}

#[derive(Clone, Debug, PartialEq)]
struct TooltipState {
    html: String,
}

// ── SVG arc math ─────────────────────────────────────────────────

/// Convert polar (angle, radius) to cartesian.
/// Convention: 0 = top (12 o'clock), clockwise.
fn angle_to_point(angle: f64, radius: f64) -> (f64, f64) {
    let x = radius * angle.sin();
    let y = -radius * angle.cos();
    (x, y)
}

/// Build an SVG arc path for a sector.
fn sector_path(start_angle: f64, end_angle: f64, inner_r: f64, outer_r: f64) -> String {
    let (sx_o, sy_o) = angle_to_point(start_angle, outer_r);
    let (ex_o, ey_o) = angle_to_point(end_angle, outer_r);
    let (sx_i, sy_i) = angle_to_point(end_angle, inner_r);
    let (ex_i, ey_i) = angle_to_point(start_angle, inner_r);

    let large_arc = if (end_angle - start_angle).abs() > PI {
        1
    } else {
        0
    };

    format!(
        "M {sx_o:.3} {sy_o:.3} A {outer_r:.3} {outer_r:.3} 0 {large_arc} 1 {ex_o:.3} {ey_o:.3} L {sx_i:.3} {sy_i:.3} A {inner_r:.3} {inner_r:.3} 0 {large_arc} 0 {ex_i:.3} {ey_i:.3} Z"
    )
}

fn inner_radius_for_level(level: usize) -> f64 {
    if level == 0 {
        40.0
    } else {
        75.0
    }
}

fn outer_radius_for_level(level: usize) -> f64 {
    let inner = inner_radius_for_level(level);
    let arc_width = if level == 0 { 55.0 } else { 65.0 };
    inner + arc_width
}

fn emit_item_click(item_id: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_RADIAL_MENU_ITEM_CLICK),
        Some("component.radial-menu"),
        json!({ "itemId": item_id }),
    );
}

fn emit_center_click() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_RADIAL_MENU_CENTER_CLICK),
        Some("component.radial-menu"),
        json!({}),
    );
}

fn emit_close() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_RADIAL_MENU_CLOSE),
        Some("component.radial-menu"),
        json!({}),
    );
}

// ── Props ────────────────────────────────────────────────────────

#[derive(Props, Clone, PartialEq)]
pub struct RadialMenuProps {
    config: RadialMenuConfig,
}

// ── Component ────────────────────────────────────────────────────

#[component]
pub fn RadialMenu(props: RadialMenuProps) -> Element {
    let is_visible = use_signal(|| false);
    let items = use_signal(|| Vec::<RadialMenuItem>::new());
    let menu_stack = use_signal(|| Vec::<MenuLevel>::new());
    let center_button = use_signal(|| Option::<RadialMenuCenterButton>::None);
    let position = use_signal(|| (0.0_f64, 0.0_f64));
    let tooltip = use_signal(|| Option::<TooltipState>::None);
    let tooltip_pos = use_signal(|| (0.0_f64, 0.0_f64));

    // Store signals in thread-locals for WASM API access
    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));
    ITEMS_SIGNAL.with(|s| *s.borrow_mut() = Some(items));
    MENU_STACK_SIGNAL.with(|s| *s.borrow_mut() = Some(menu_stack));
    CENTER_BUTTON_SIGNAL.with(|s| *s.borrow_mut() = Some(center_button));
    POSITION_SIGNAL.with(|s| *s.borrow_mut() = Some(position));
    TOOLTIP_SIGNAL.with(|s| *s.borrow_mut() = Some(tooltip));
    TOOLTIP_POS_SIGNAL.with(|s| *s.borrow_mut() = Some(tooltip_pos));

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    let current_items = items();
    let stack = menu_stack();
    let current_level = stack.len();
    let (pos_x, pos_y) = position();
    let cb = center_button();

    let outer_r = outer_radius_for_level(current_level);
    let margin = outer_r + 10.0;
    let svg_size = (margin * 2.0) as i32 + 20;

    // Viewport clamping
    let (vw, vh) = web_sys::window()
        .map(|w| {
            (
                w.inner_width()
                    .ok()
                    .and_then(|v| v.as_f64())
                    .unwrap_or(800.0),
                w.inner_height()
                    .ok()
                    .and_then(|v| v.as_f64())
                    .unwrap_or(600.0),
            )
        })
        .unwrap_or((800.0, 600.0));

    let clamped_x = if 2.0 * margin > vw {
        vw / 2.0
    } else {
        pos_x.max(margin).min(vw - margin)
    };
    let clamped_y = if 2.0 * margin > vh {
        vh / 2.0
    } else {
        pos_y.max(margin).min(vh - margin)
    };

    let half = svg_size as f64 / 2.0;
    let back_icon = props.config.back_icon.clone();

    rsx! {
        // Full-screen overlay to catch outside clicks
        div {
            style: "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999; touch-action: none;",
            onclick: move |_| {
                emit_close();
            },
            oncontextmenu: move |e| {
                e.prevent_default();
                emit_close();
            },

            // SVG container positioned at clamped coords
            svg {
                width: "{svg_size}",
                height: "{svg_size}",
                style: "position: absolute; top: {clamped_y}px; left: {clamped_x}px; transform: translate(-50%, -50%); pointer-events: all;",
                onclick: move |e| {
                    e.stop_propagation();
                    emit_close();
                },

                // Glow filter
                defs {
                    filter { id: "glow",
                        feGaussianBlur { std_deviation: "2", result: "coloredBlur" }
                        feMerge {
                            feMergeNode { _in: "coloredBlur" }
                            feMergeNode { _in: "SourceGraphic" }
                        }
                    }
                }

                // Main group centered in SVG
                g {
                    transform: "translate({half},{half})",

                    // Render current level
                    g {
                        style: "opacity: 1; transform: scale(1); transition: opacity 0.24s, transform 0.24s; transform-origin: center;",
                        {render_menu_sectors(&current_items, current_level, true)}
                    }

                    // Center button
                    {render_center_button(&cb, current_level, &back_icon)}
                }
            }

            // Tooltip
            {render_tooltip(&tooltip(), &tooltip_pos())}
        }
    }
}

fn render_menu_sectors(items: &[RadialMenuItem], level: usize, interactive: bool) -> Element {
    if items.is_empty() {
        return rsx! {};
    }

    let n = items.len();
    let offset = -PI / n as f64;
    let pad_angle = 0.03_f64;
    let total_pad = pad_angle * n as f64;
    let usable = 2.0 * PI - total_pad;
    let slice = usable / n as f64;

    let inner_r = inner_radius_for_level(level);
    let outer_r = outer_radius_for_level(level);
    let icon_size = 32.0_f64;

    rsx! {
        for (i, item) in items.iter().enumerate() {
            {
                let start = offset + i as f64 * (slice + pad_angle);
                let end = start + slice;
                let mid_angle = (start + end) / 2.0;
                let centroid_r = (inner_r + outer_r) / 2.0;
                let (cx, cy) = angle_to_point(mid_angle, centroid_r);

                let path_d = sector_path(start, end, inner_r, outer_r);

                let base_color = &item.color;
                let disabled = item.disabled;
                let opacity_val = if disabled { 0.5 } else { 0.7 };

                // Apply opacity to color via rgba
                let fill = if disabled {
                    "rgb(128,128,128)".to_string()
                } else {
                    format!("{}",  base_color)
                };

                let path_opacity = if disabled { "0.5" } else { "1" };
                let cursor = if disabled { "not-allowed" } else { "pointer" };
                let pointer_events = if interactive && !disabled { "auto" } else { if interactive { "auto" } else { "none" } };

                let item_id_click = item.id.clone();
                let has_tooltip = item.tooltip_html.is_some();
                let tooltip_html_val = item.tooltip_html.clone().unwrap_or_default();

                let has_text = item.text.is_some();
                let text_val = item.text.clone().unwrap_or_default();
                let font_size_val = item.font_size.clone().unwrap_or_else(|| "12px".to_string());
                let has_icon = item.icon.is_some();
                let icon_val = item.icon.clone().unwrap_or_default();
                let icon_opacity = if disabled { "0.5" } else { "1" };

                let cooldown_text = item.cooldown
                    .filter(|&c| c > 0.0)
                    .map(|c| format!("{}s", c.ceil() as i32));

                rsx! {
                    g {
                        class: "menu-item-group",

                        path {
                            d: "{path_d}",
                            fill: "{fill}",
                            fill_opacity: "{opacity_val}",
                            stroke: "#ffffff",
                            stroke_width: "2",
                            style: "cursor: {cursor}; opacity: {path_opacity}; pointer-events: {pointer_events}; transition: filter 0.15s, stroke-width 0.15s, fill 0.15s;",
                            onclick: move |e| {
                                e.stop_propagation();
                                emit_item_click(&item_id_click);
                            },
                            onmouseenter: {
                                let tooltip_html_hover = tooltip_html_val.clone();
                                let has_tooltip_hover = has_tooltip;
                                move |_| {
                                    if has_tooltip_hover {
                                        TOOLTIP_SIGNAL.with(|s| {
                                            if let Some(ref mut sig) = *s.borrow_mut() {
                                                sig.set(Some(TooltipState { html: tooltip_html_hover.clone() }));
                                            }
                                        });
                                    }
                                }
                            },
                            onmouseleave: move |_| {
                                TOOLTIP_SIGNAL.with(|s| {
                                    if let Some(ref mut sig) = *s.borrow_mut() {
                                        sig.set(None);
                                    }
                                });
                            },
                            onmousemove: move |e| {
                                let coords = e.page_coordinates();
                                TOOLTIP_POS_SIGNAL.with(|s| {
                                    if let Some(ref mut sig) = *s.borrow_mut() {
                                        sig.set((coords.x + 10.0, coords.y + 10.0));
                                    }
                                });
                            },
                        }

                        // Icon or text
                        if has_text {
                            text {
                                x: "{cx:.1}",
                                y: "{cy:.1}",
                                text_anchor: "middle",
                                dominant_baseline: "central",
                                fill: "white",
                                font_size: "{font_size_val}",
                                font_family: "Arial, sans-serif",
                                style: "pointer-events: none; opacity: {icon_opacity};",
                                "{text_val}"
                            }
                        } else if has_icon {
                            image {
                                href: "{icon_val}",
                                x: "{cx - icon_size / 2.0:.1}",
                                y: "{cy - icon_size / 2.0:.1}",
                                width: "{icon_size:.0}",
                                height: "{icon_size:.0}",
                                style: "pointer-events: none; opacity: {icon_opacity};",
                            }
                        }

                        // Cooldown text
                        if let Some(ref cd) = cooldown_text {
                            text {
                                x: "{cx - icon_size / 4.0:.1}",
                                y: "{cy + icon_size / 2.0 + 7.0:.1}",
                                fill: "white",
                                font_size: "14px",
                                font_weight: "bold",
                                style: "pointer-events: none; opacity: {icon_opacity};",
                                "{cd}"
                            }
                        }
                    }
                }
            }
        }
    }
}

fn render_center_button(
    cb: &Option<RadialMenuCenterButton>,
    current_level: usize,
    back_icon: &str,
) -> Element {
    let (icon, color, icon_size, disabled) = if current_level > 0 {
        // Show back button in submenus
        let back_size = 48.0 * 0.8;
        (
            back_icon.to_string(),
            "#2c3e50".to_string(),
            back_size,
            false,
        )
    } else if let Some(cb) = cb {
        (cb.icon.clone(), cb.color.clone(), cb.icon_size, cb.disabled)
    } else {
        return rsx! {};
    };

    let btn_r = if current_level > 0 { 30.0 * 0.8 } else { 30.0 };
    let cursor = if disabled { "not-allowed" } else { "pointer" };
    let fill_color = if disabled { "#999999" } else { &color };
    let icon_opacity = if disabled { "0.5" } else { "1" };
    let half_icon = icon_size / 2.0;

    rsx! {
        g {
            class: "center-button",

            // Invisible hitbox
            circle {
                r: "{btn_r}",
                fill: "transparent",
                style: "cursor: {cursor};",
                onclick: move |e| {
                    e.stop_propagation();
                    if !disabled {
                        emit_center_click();
                    }
                },
            }

            // Visible circle
            circle {
                r: "{btn_r}",
                fill: "{fill_color}",
                style: "pointer-events: none; transition: r 0.2s;",
            }

            // Icon
            image {
                href: "{icon}",
                x: "{-half_icon:.1}",
                y: "{-half_icon:.1}",
                width: "{icon_size:.0}",
                height: "{icon_size:.0}",
                style: "pointer-events: none; opacity: {icon_opacity};",
            }
        }
    }
}

fn render_tooltip(tooltip: &Option<TooltipState>, pos: &(f64, f64)) -> Element {
    if let Some(ts) = tooltip {
        let left = pos.0;
        let top = pos.1;
        rsx! {
            div {
                class: "radial-tooltip",
                style: "position: absolute; pointer-events: none; background: rgba(0,0,0,0.7); color: white; padding: 6px 10px; border-radius: 6px; font-size: 12px; z-index: 10000; max-width: 250px; left: {left}px; top: {top}px;",
                dangerous_inner_html: "{ts.html}",
            }
        }
    } else {
        rsx! {}
    }
}

// ── Root wrapper ─────────────────────────────────────────────────

fn RadialMenuRoot() -> Element {
    let state = INIT_STATE.with(|s| s.borrow().clone());
    match state {
        Some(state) => rsx! {
            RadialMenu { config: state.config }
        },
        None => rsx! { div { class: "hidden" } },
    }
}

// ── WASM exports ─────────────────────────────────────────────────

pub fn launch_radial_menu(config_json: &str) {
    log::info!("Launching radial menu");
    let config: RadialMenuConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to parse radial menu config: {}", e);
            RadialMenuConfig::default()
        }
    };
    INIT_STATE.with(|s| {
        *s.borrow_mut() = Some(RadialMenuInitState { config });
    });
    let dioxus_config = dioxus::web::Config::new().rootname("dioxus-radial-menu-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(dioxus_config)
        .launch(RadialMenuRoot);
}

pub fn show_radial_menu(items_json: &str, center_button_json: &str, x: f64, y: f64) {
    let items: Vec<RadialMenuItem> = match serde_json::from_str(items_json) {
        Ok(i) => i,
        Err(e) => {
            log::error!("Failed to parse radial menu items: {}", e);
            return;
        }
    };
    let cb: Option<RadialMenuCenterButton> = serde_json::from_str(center_button_json).ok();

    // Reset stack
    MENU_STACK_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(Vec::new());
        }
    });

    ITEMS_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(items);
        }
    });
    CENTER_BUTTON_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(cb);
        }
    });
    POSITION_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set((x, y));
        }
    });
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(true);
        }
    });
}

pub fn push_submenu(items_json: &str) {
    let new_items: Vec<RadialMenuItem> = match serde_json::from_str(items_json) {
        Ok(i) => i,
        Err(e) => {
            log::error!("Failed to parse submenu items: {}", e);
            return;
        }
    };

    // Push current items onto stack
    let current = ITEMS_SIGNAL.with(|s| s.borrow().as_ref().map(|sig| sig.read().clone()));

    if let Some(current_items) = current {
        MENU_STACK_SIGNAL.with(|s| {
            if let Some(ref mut sig) = *s.borrow_mut() {
                let mut stack = sig.read().clone();
                stack.push(MenuLevel {
                    items: current_items,
                });
                sig.set(stack);
            }
        });
    }

    // Set new items as current
    ITEMS_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(new_items);
        }
    });
}

pub fn pop_submenu() {
    let popped = MENU_STACK_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            let mut stack = sig.read().clone();
            let popped = stack.pop();
            sig.set(stack);
            popped
        } else {
            None
        }
    });

    if let Some(level) = popped {
        ITEMS_SIGNAL.with(|s| {
            if let Some(ref mut sig) = *s.borrow_mut() {
                sig.set(level.items);
            }
        });
    }
}

pub fn update_radial_items(items_json: &str, center_button_json: &str) {
    let items: Vec<RadialMenuItem> = match serde_json::from_str(items_json) {
        Ok(i) => i,
        Err(e) => {
            log::error!("Failed to parse radial menu items for update: {}", e);
            return;
        }
    };
    ITEMS_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(items);
        }
    });

    if !center_button_json.is_empty() {
        let cb: Option<RadialMenuCenterButton> = serde_json::from_str(center_button_json).ok();
        CENTER_BUTTON_SIGNAL.with(|s| {
            if let Some(ref mut sig) = *s.borrow_mut() {
                sig.set(cb);
            }
        });
    }
}

pub fn update_center_button(center_button_json: &str) {
    let cb: Option<RadialMenuCenterButton> = serde_json::from_str(center_button_json).ok();
    CENTER_BUTTON_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(cb);
        }
    });
}

pub fn hide_radial_menu() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(false);
        }
    });
    TOOLTIP_SIGNAL.with(|s| {
        if let Some(ref mut sig) = *s.borrow_mut() {
            sig.set(None);
        }
    });
}
