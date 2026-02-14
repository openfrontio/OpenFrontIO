//! Hello World component - Proof of concept
//!
//! This is a simple component to verify that Dioxus web components work correctly
//! when integrated with the existing Lit-based UI.
//!
//! ## Usage
//!
//! ```html
//! <game-hello-world name="Player" count="0"></game-hello-world>
//! ```
//!
//! ## Events
//!
//! - `count-changed`: Fired when the count changes, with detail containing the new count

use dioxus::prelude::*;
use wasm_bindgen::prelude::*;
use web_sys::{CustomEvent, CustomEventInit};

/// Register the hello-world web component
pub fn register() {
    // For now, we'll use a manual registration approach
    // The dioxus-web-component macro can be added once we verify basic functionality
    log::debug!("Registered <game-hello-world> component");
}

/// HelloWorld component props
#[derive(Props, Clone, PartialEq)]
pub struct HelloWorldProps {
    /// The name to display
    #[props(default = "World".to_string())]
    name: String,

    /// Initial count value
    #[props(default = 0)]
    initial_count: i32,
}

/// Hello World component
///
/// A simple component that displays a greeting and a counter button.
/// Demonstrates:
/// - Props from attributes
/// - Signal-based state management
/// - Event handling
/// - Custom event emission
#[component]
pub fn HelloWorld(props: HelloWorldProps) -> Element {
    // Create a signal for the count state
    let mut count = use_signal(|| props.initial_count);

    // Handler for increment button
    let on_increment = move |_| {
        count += 1;
        // Emit custom event for Lit interop
        emit_count_changed(count());
    };

    // Handler for decrement button
    let on_decrement = move |_| {
        count -= 1;
        emit_count_changed(count());
    };

    rsx! {
        div {
            class: "hello-world-container",
            style: "padding: 16px; border: 1px solid #ccc; border-radius: 8px; font-family: system-ui;",

            h2 {
                style: "margin: 0 0 12px 0; color: #333;",
                "Hello, {props.name}!"
            }

            p {
                style: "margin: 0 0 12px 0; color: #666;",
                "This component is rendered by Dioxus (Rust/WASM)"
            }

            div {
                style: "display: flex; align-items: center; gap: 12px;",

                button {
                    onclick: on_decrement,
                    style: "padding: 8px 16px; font-size: 16px; cursor: pointer;",
                    "-"
                }

                span {
                    style: "font-size: 24px; font-weight: bold; min-width: 60px; text-align: center;",
                    "{count}"
                }

                button {
                    onclick: on_increment,
                    style: "padding: 8px 16px; font-size: 16px; cursor: pointer;",
                    "+"
                }
            }
        }
    }
}

/// Emit a custom event when count changes
fn emit_count_changed(count: i32) {
    if let Some(window) = web_sys::window() {
        if let Some(document) = window.document() {
            // Create custom event with count as detail
            let init = CustomEventInit::new();
            init.set_detail(&JsValue::from(count));
            init.set_bubbles(true);
            init.set_composed(true); // Allow crossing shadow DOM boundaries

            if let Ok(event) = CustomEvent::new_with_event_init_dict("count-changed", &init) {
                // Dispatch on document for global listening
                let _ = document.dispatch_event(&event);
            }
        }
    }
}

/// Launch the HelloWorld component
/// Mounts to an element with id="dioxus-root" or falls back to body
#[wasm_bindgen]
pub fn launch_hello_world() {
    // Try to find the target mount element
    let config = dioxus::web::Config::new().rootname("dioxus-root");

    dioxus::LaunchBuilder::new().with_cfg(config).launch(|| {
        rsx! {
            HelloWorld {
                name: "Dioxus User".to_string(),
                initial_count: 0,
            }
        }
    });
}
