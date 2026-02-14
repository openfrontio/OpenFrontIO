//! MainLayout component
//!
//! A simple structural container that wraps the main content area.
//! Provides:
//! - Responsive padding and max-width constraints
//! - Overflow scrolling with hidden scrollbar on mobile
//! - Hidden during in-game state (managed by TS bridge via CSS class)
//! - A slot div for child content managed by the TS bridge

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

thread_local! {
    static STATE: RefCell<Option<Signal<MainLayoutState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MainLayoutState {
    is_visible: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-main-layout> component");
}

#[component]
fn MainLayout() -> Element {
    let state = use_signal(MainLayoutState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let current = state();

    if !current.is_visible {
        return rsx! {};
    }

    rsx! {
        main {
            class: "relative flex flex-col flex-1 overflow-hidden w-full px-[clamp(1.5rem,3vw,3rem)] pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-[clamp(0.75rem,1.5vw,1.5rem)]",
            div {
                class: "w-full max-w-[20cm] mx-auto flex flex-col flex-1 gap-[clamp(1.5rem,3vw,3rem)] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:[scrollbar-width:auto] lg:[-ms-overflow-style:auto] lg:[&::-webkit-scrollbar]:block",
                // Slot for child content managed by the TS bridge
                div { id: "dioxus-main-layout-content-slot" }
            }
        }
    }
}

fn MainLayoutRoot() -> Element {
    rsx! { MainLayout {} }
}

pub fn launch_main_layout() {
    log::info!("Launching main layout");
    let config = dioxus::web::Config::new().rootname("dioxus-main-layout-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(MainLayoutRoot);
}

pub fn update_main_layout(state_json: &str) {
    let new_state: MainLayoutState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to parse main layout state: {}", e);
            return;
        }
    };
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(new_state);
        }
    });
}
