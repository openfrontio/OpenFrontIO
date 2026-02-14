//! PerformanceOverlay component
//!
//! Displays FPS, frame time, tick metrics, and per-layer breakdown.
//! Draggable overlay with reset and copy-to-clipboard buttons.
//! The TS bridge computes all metrics; this component only renders.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

thread_local! {
    static STATE: RefCell<Option<Signal<PerformanceOverlayState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceOverlayState {
    is_visible: bool,
    current_fps: u32,
    average_fps: u32,
    frame_time: u32,
    tick_execution_avg: String,
    tick_execution_max: u32,
    tick_delay_avg: String,
    tick_delay_max: u32,
    layers: Vec<LayerBreakdown>,
    // Translations
    fps_label: String,
    avg_60s_label: String,
    frame_label: String,
    tick_exec_label: String,
    tick_delay_label: String,
    layers_header_label: String,
    reset_label: String,
    copy_label: String,
    // Position
    pos_x: f64,
    pos_y: f64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerBreakdown {
    name: String,
    avg: String,
    max: String,
    bar_width: f64,
}

pub fn register() {
    log::debug!("Registered <dioxus-performance-overlay> component");
}

fn emit_event(event_key: &str) {
    emit_ui_event(
        event_name(event_key),
        Some("component.performance-overlay"),
        json!({}),
    );
}

fn get_perf_color(fps: u32) -> &'static str {
    if fps >= 55 {
        "color: #4ade80;"
    } else if fps >= 30 {
        "color: #fbbf24;"
    } else {
        "color: #f87171;"
    }
}

const OVERLAY_STYLE: &str = r#"
.perf-overlay {
    position: fixed;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    z-index: 9999;
    user-select: none;
    cursor: move;
    min-width: 420px;
    pointer-events: auto;
}
.perf-line { margin: 2px 0; }
.perf-btn {
    height: 20px;
    padding: 0 6px;
    background-color: rgba(0, 0, 0, 0.8);
    border-radius: 4px;
    color: white;
    font-size: 10px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    pointer-events: auto;
}
.perf-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
    background-color: rgba(0, 0, 0, 0.8);
    border-radius: 4px;
    color: white;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    pointer-events: auto;
}
.layers-section {
    margin-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 4px;
}
.layer-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-top: 2px;
}
.layer-name {
    flex: 0 0 280px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.layer-bar {
    flex: 1;
    height: 6px;
    background: rgba(148, 163, 184, 0.25);
    border-radius: 3px;
    overflow: hidden;
}
.layer-bar-fill {
    height: 100%;
    background: #38bdf8;
    border-radius: 3px;
}
.layer-metrics {
    flex: 0 0 auto;
    white-space: nowrap;
}
"#;

#[component]
fn PerformanceOverlay() -> Element {
    let state = use_signal(PerformanceOverlayState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_visible {
        return rsx! {
            style { {OVERLAY_STYLE} }
        };
    }

    let fps_color = get_perf_color(s.current_fps);
    let avg_color = get_perf_color(s.average_fps);
    let frame_fps = if s.frame_time > 0 {
        1000 / s.frame_time
    } else {
        0
    };
    let frame_color = get_perf_color(frame_fps);

    rsx! {
        style { {OVERLAY_STYLE} }
        div {
            class: "perf-overlay",
            style: "left: {s.pos_x}px; top: {s.pos_y}px;",
            oncontextmenu: |e| e.prevent_default(),

            button {
                class: "perf-btn",
                style: "position: absolute; top: 8px; left: 8px;",
                onclick: move |_| emit_event(event_keys::UI_INGAME_PERFORMANCE_OVERLAY_RESET),
                "{s.reset_label}"
            }
            button {
                class: "perf-btn",
                style: "position: absolute; top: 8px; left: 70px;",
                onclick: move |_| emit_event(event_keys::UI_INGAME_PERFORMANCE_OVERLAY_COPY),
                "{s.copy_label}"
            }
            button {
                class: "perf-close",
                onclick: move |_| emit_event(event_keys::UI_INGAME_PERFORMANCE_OVERLAY_CLOSE_REQUEST),
                "\u{00D7}"
            }

            div { class: "perf-line",
                "{s.fps_label} "
                span { style: fps_color, "{s.current_fps}" }
            }
            div { class: "perf-line",
                "{s.avg_60s_label} "
                span { style: avg_color, "{s.average_fps}" }
            }
            div { class: "perf-line",
                "{s.frame_label} "
                span { style: frame_color, "{s.frame_time}ms" }
            }
            div { class: "perf-line",
                "{s.tick_exec_label} "
                span { "{s.tick_execution_avg}ms" }
                " (max: "
                span { "{s.tick_execution_max}ms" }
                ")"
            }
            div { class: "perf-line",
                "{s.tick_delay_label} "
                span { "{s.tick_delay_avg}ms" }
                " (max: "
                span { "{s.tick_delay_max}ms" }
                ")"
            }

            if !s.layers.is_empty() {
                div {
                    class: "layers-section",
                    div { class: "perf-line", "{s.layers_header_label}" }
                    for (i, layer) in s.layers.iter().enumerate() {
                        div {
                            key: "{i}",
                            class: "layer-row",
                            span {
                                class: "layer-name",
                                title: "{layer.name}",
                                "{layer.name}"
                            }
                            div {
                                class: "layer-bar",
                                div {
                                    class: "layer-bar-fill",
                                    style: "width: {layer.bar_width}%;",
                                }
                            }
                            span {
                                class: "layer-metrics",
                                "{layer.avg} / {layer.max}ms"
                            }
                        }
                    }
                }
            }
        }
    }
}

fn PerformanceOverlayRoot() -> Element {
    rsx! { PerformanceOverlay {} }
}

pub fn launch_performance_overlay() {
    log::info!("Launching performance overlay");
    let config = dioxus::web::Config::new().rootname("dioxus-performance-overlay-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(PerformanceOverlayRoot);
}

pub fn update_performance_overlay(state_json: &str) {
    let new_state: PerformanceOverlayState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse performance overlay state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
