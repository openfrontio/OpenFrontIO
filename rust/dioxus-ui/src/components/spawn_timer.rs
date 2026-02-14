//! SpawnTimer component
//!
//! A progress bar at the top of the screen showing spawn phase progress
//! or team territory distribution in team games.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

thread_local! {
    static IS_VISIBLE: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static SEGMENTS: RefCell<Option<Signal<Vec<BarSegment>>>> = const { RefCell::new(None) };
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BarSegment {
    pub ratio: f64,
    pub color: String,
}

pub fn register() {
    log::debug!("Registered <dioxus-spawn-timer> component");
}

#[component]
fn SpawnTimer() -> Element {
    let is_visible = use_signal(|| false);
    let segments = use_signal(Vec::<BarSegment>::new);

    IS_VISIBLE.with(|s| *s.borrow_mut() = Some(is_visible));
    SEGMENTS.with(|s| *s.borrow_mut() = Some(segments));

    if !is_visible() || segments().is_empty() {
        return rsx! {};
    }

    rsx! {
        div {
            class: "fixed top-0 left-0 w-full z-[1000] pointer-events-none",
            style: "height: 7px;",
            div {
                class: "w-full h-full flex",
                for (i, seg) in segments().iter().enumerate() {
                    div {
                        key: "{i}",
                        class: "h-full transition-all duration-100 ease-in-out",
                        style: "width: {seg.ratio * 100.0}%; background-color: {seg.color};",
                    }
                }
            }
        }
    }
}

fn SpawnTimerRoot() -> Element {
    rsx! { SpawnTimer {} }
}

pub fn launch_spawn_timer() {
    log::info!("Launching spawn timer");
    let config = dioxus::web::Config::new().rootname("dioxus-spawn-timer-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(SpawnTimerRoot);
}

pub fn show_spawn_timer() {
    IS_VISIBLE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(true);
        }
    });
}

pub fn hide_spawn_timer() {
    IS_VISIBLE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(false);
        }
    });
}

pub fn update_spawn_timer(segments_json: &str) {
    let segments: Vec<BarSegment> = match serde_json::from_str(segments_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse spawn timer segments: {}", e);
            return;
        }
    };
    SEGMENTS.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(segments);
        }
    });
}
