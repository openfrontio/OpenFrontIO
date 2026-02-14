//! HeadsUpMessage component
//!
//! Displays HUD messages during spawn phase / pause, and toast notifications.

use dioxus::prelude::*;
use std::cell::RefCell;

thread_local! {
    static STATE: RefCell<Option<Signal<HudState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default)]
struct HudState {
    is_visible: bool,
    message: String,
    toast_message: Option<String>,
    toast_color: String,
}

pub fn register() {
    log::debug!("Registered <dioxus-heads-up-message> component");
}

#[component]
fn HeadsUpMessage() -> Element {
    let state = use_signal(HudState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    rsx! {
        div {
            style: "pointer-events: none;",
            if let Some(ref toast) = s.toast_message {
                {
                    let (bg, border, shadow) = if s.toast_color == "red" {
                        ("rgba(239,68,68,0.1)", "rgba(239,68,68,0.5)", "rgba(239,68,68,0.3)")
                    } else {
                        ("rgba(34,197,94,0.1)", "rgba(34,197,94,0.5)", "rgba(34,197,94,0.3)")
                    };
                    rsx! {
                        div {
                            class: "fixed top-6 left-1/2 -translate-x-1/2 z-[11001] px-6 py-4 rounded-xl transition-all duration-300 animate-fade-in-out",
                            style: "max-width: 90vw; min-width: 200px; text-align: center; background: {bg}; border: 1px solid {border}; color: white; box-shadow: 0 0 30px 0 {shadow}; backdrop-filter: blur(12px);",
                            oncontextmenu: |e| e.prevent_default(),
                            span { class: "font-medium", "{toast}" }
                        }
                    }
                }
            }
            if s.is_visible {
                div {
                    class: "fixed top-[10%] left-1/2 -translate-x-1/2 z-[11000] inline-flex items-center justify-center h-8 lg:h-10 w-fit max-w-[90vw] bg-gray-900/60 rounded-md lg:rounded-lg backdrop-blur-md text-white text-md lg:text-xl px-3 lg:px-4 text-center break-words",
                    style: "word-wrap: break-word; hyphens: auto;",
                    oncontextmenu: |e| e.prevent_default(),
                    "{s.message}"
                }
            }
        }
    }
}

fn HeadsUpMessageRoot() -> Element {
    rsx! { HeadsUpMessage {} }
}

pub fn launch_heads_up_message() {
    log::info!("Launching heads up message");
    let config = dioxus::web::Config::new().rootname("dioxus-heads-up-message-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(HeadsUpMessageRoot);
}

pub fn update_heads_up_message(is_visible: bool, message: &str) {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            let mut state = signal();
            state.is_visible = is_visible;
            state.message = message.to_string();
            signal.set(state);
        }
    });
}

pub fn show_heads_up_toast(message: &str, color: &str) {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            let mut state = signal();
            state.toast_message = Some(message.to_string());
            state.toast_color = color.to_string();
            signal.set(state);
        }
    });
}

pub fn hide_heads_up_toast() {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            let mut state = signal();
            state.toast_message = None;
            signal.set(state);
        }
    });
}
