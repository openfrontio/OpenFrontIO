//! ImmunityTimer component
//!
//! An orange progress bar at the top of the screen showing spawn immunity countdown.

use dioxus::prelude::*;
use std::cell::RefCell;

thread_local! {
    static IS_VISIBLE: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static PROGRESS: RefCell<Option<Signal<f64>>> = const { RefCell::new(None) };
    static TOP_OFFSET: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
}

pub fn register() {
    log::debug!("Registered <dioxus-immunity-timer> component");
}

#[component]
fn ImmunityTimer() -> Element {
    let is_visible = use_signal(|| false);
    let progress = use_signal(|| 0.0f64);
    let top_offset = use_signal(|| "0px".to_string());

    IS_VISIBLE.with(|s| *s.borrow_mut() = Some(is_visible));
    PROGRESS.with(|s| *s.borrow_mut() = Some(progress));
    TOP_OFFSET.with(|s| *s.borrow_mut() = Some(top_offset));

    if !is_visible() {
        return rsx! {};
    }

    let width = progress() * 100.0;

    rsx! {
        div {
            class: "fixed left-0 w-full z-[1000] pointer-events-none",
            style: "height: 7px; top: {top_offset()};",
            div {
                class: "w-full h-full flex",
                div {
                    class: "h-full transition-all duration-100 ease-in-out",
                    style: "width: {width}%; background-color: rgba(255, 165, 0, 0.9);",
                }
            }
        }
    }
}

fn ImmunityTimerRoot() -> Element {
    rsx! { ImmunityTimer {} }
}

pub fn launch_immunity_timer() {
    log::info!("Launching immunity timer");
    let config = dioxus::web::Config::new().rootname("dioxus-immunity-timer-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(ImmunityTimerRoot);
}

pub fn show_immunity_timer() {
    IS_VISIBLE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(true);
        }
    });
}

pub fn hide_immunity_timer() {
    IS_VISIBLE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(false);
        }
    });
}

pub fn update_immunity_timer(progress_ratio: f64, top_offset: &str) {
    PROGRESS.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(progress_ratio);
        }
    });
    TOP_OFFSET.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(top_offset.to_string());
        }
    });
}
