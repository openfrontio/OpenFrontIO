//! AlertFrame component
//!
//! Displays a blinking border alert when the player is betrayed or attacked.

use dioxus::prelude::*;
use std::cell::RefCell;

thread_local! {
    static STATE: RefCell<Option<Signal<AlertState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default)]
struct AlertState {
    is_active: bool,
    alert_type: String,
}

const ALERT_CSS: &str = r#"
.dioxus-alert-border {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    border: 17px solid;
    box-sizing: border-box;
    z-index: 40;
    opacity: 0;
}
.dioxus-alert-border.betrayal {
    border-color: #ee0000;
}
.dioxus-alert-border.land-attack {
    border-color: #ffa500;
}
.dioxus-alert-border.animate {
    animation: dioxusAlertBlink 1.6s ease-in-out 2;
}
@keyframes dioxusAlertBlink {
    0% { opacity: 0; }
    50% { opacity: 1; }
    100% { opacity: 0; }
}
"#;

pub fn register() {
    // Inject CSS for alert animation
    if let Some(document) = web_sys::window().and_then(|w| w.document()) {
        if document
            .query_selector("style[data-dioxus-alert-frame]")
            .ok()
            .flatten()
            .is_none()
        {
            if let Ok(style) = document.create_element("style") {
                let _ = style.set_attribute("data-dioxus-alert-frame", "");
                style.set_text_content(Some(ALERT_CSS));
                if let Some(head) = document.head() {
                    let _ = head.append_child(&style);
                }
            }
        }
    }
    log::debug!("Registered <dioxus-alert-frame> component");
}

fn dispatch_event(name: &str) {
    if let Some(document) = web_sys::window().and_then(|w| w.document()) {
        if let Ok(event) = web_sys::CustomEvent::new(name) {
            let _ = document.dispatch_event(&event);
        }
    }
}

#[component]
fn AlertFrame() -> Element {
    let state = use_signal(AlertState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let s = state();

    if !s.is_active {
        return rsx! {};
    }

    rsx! {
        div {
            class: "dioxus-alert-border animate {s.alert_type}",
            onanimationend: move |_| {
                dispatch_event("dioxus-alert-dismiss");
            },
        }
    }
}

fn AlertFrameRoot() -> Element {
    rsx! { AlertFrame {} }
}

pub fn launch_alert_frame() {
    log::info!("Launching alert frame");
    let config = dioxus::web::Config::new().rootname("dioxus-alert-frame-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(AlertFrameRoot);
}

pub fn show_alert_frame(alert_type: &str) {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(AlertState {
                is_active: true,
                alert_type: alert_type.to_string(),
            });
        }
    });
}

pub fn hide_alert_frame() {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(AlertState::default());
        }
    });
}
