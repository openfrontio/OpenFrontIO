//! Dioxus UI Components for OpenFrontIO
//!
//! This crate provides Dioxus-based UI components that are exposed as Web Components
//! for seamless integration with the existing Lit-based UI.
//!
//! ## Usage
//!
//! Components are registered as custom elements when `init()` is called:
//!
//! ```javascript
//! import init from './dioxus-ui/pkg/dioxus_ui.js';
//! await init();
//!
//! // Now you can use custom elements in HTML:
//! // <game-settings-modal></game-settings-modal>
//! ```

use wasm_bindgen::prelude::*;

pub mod components;
pub mod contexts;
pub mod providers;
pub mod runtime;
pub mod runtime_protocol;

/// Initialize the Dioxus UI module
///
/// This function:
/// 1. Sets up panic hook for better error messages
/// 2. Initializes console logging
/// 3. Registers all web components
#[wasm_bindgen]
pub fn init() {
    // Set up panic hook for better error messages in browser console
    console_error_panic_hook::set_once();

    // Initialize console logging
    console_log::init_with_level(log::Level::Debug).ok();

    log::info!("Dioxus UI initialized");

    // Register web components
    components::register_all();

    // Initialize unified runtime scaffolding
    runtime::initialize();
}

/// Check if the Dioxus UI module is ready
#[wasm_bindgen]
pub fn is_ready() -> bool {
    true
}
