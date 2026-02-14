//! ModalOverlay component
//!
//! A simple full-screen overlay that sits behind modals.
//! When clicked, it dispatches a close event.
//! Visibility is controlled from the TS bridge via show/hide.

use dioxus::prelude::*;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

thread_local! {
    static STATE: RefCell<Option<Signal<OverlayState>>> = const { RefCell::new(None) };
}

#[derive(Clone, Default)]
struct OverlayState {
    is_visible: bool,
}

pub fn register() {
    log::debug!("Registered <dioxus-modal-overlay> component");
}

fn emit_event(name: &str) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            let init = CustomEventInit::new();
            init.set_bubbles(true);
            init.set_composed(true);
            if let Ok(event) = CustomEvent::new_with_event_init_dict(name, &init) {
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

#[component]
fn ModalOverlay() -> Element {
    let state = use_signal(OverlayState::default);

    STATE.with(|s| *s.borrow_mut() = Some(state));

    let current = state();

    if !current.is_visible {
        return rsx! {};
    }

    rsx! {
        div {
            class: "absolute left-0 top-0 w-full h-full",
            onclick: move |_| {
                emit_event("dioxus-modal-overlay-click");
            },
        }
    }
}

fn ModalOverlayRoot() -> Element {
    rsx! { ModalOverlay {} }
}

#[wasm_bindgen]
pub fn launch_modal_overlay() {
    log::info!("Launching modal overlay");
    let config = dioxus::web::Config::new().rootname("dioxus-modal-overlay-root");
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(ModalOverlayRoot);
}

#[wasm_bindgen]
pub fn show_modal_overlay() {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(OverlayState { is_visible: true });
        }
    });
}

#[wasm_bindgen]
pub fn hide_modal_overlay() {
    STATE.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(OverlayState { is_visible: false });
        }
    });
}
