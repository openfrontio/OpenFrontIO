use wasm_bindgen::prelude::*;

pub mod pathfinding;

/// Initialize panic hook for better error messages in WASM
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Simple test function to verify WASM is working
#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! WASM is working.", name)
}

/// Add two numbers - simple test for numeric operations
#[wasm_bindgen]
pub fn add(a: u32, b: u32) -> u32 {
    a + b
}
