//! LangSelector component
//!
//! A small button that displays the current language's flag.
//! When clicked, emits an event to open the language selection modal.
//! The translation logic stays in the TypeScript bridge.

use dioxus::prelude::*;
use std::cell::RefCell;

/// Register the lang selector component
pub fn register() {
    log::debug!("Registered <dioxus-lang-selector> component");
}

// Thread-local storage for component state
thread_local! {
    static FLAG_SVG_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
}

/// Emit click event to open the language modal
fn emit_lang_selector_click() {
    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    if let Ok(event) = web_sys::CustomEvent::new("dioxus-lang-selector-click") {
        if let Some(root) = document.get_element_by_id("dioxus-lang-selector-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main LangSelector component
#[component]
fn LangSelector() -> Element {
    let flag_svg = use_signal(|| "uk_us_flag".to_string());
    let is_visible = use_signal(|| true);

    FLAG_SVG_SIGNAL.with(|s| *s.borrow_mut() = Some(flag_svg));
    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));

    if !is_visible() {
        return rsx! {};
    }

    let svg = flag_svg();
    let flag_src = format!("/flags/{}.svg", svg);

    rsx! {
        button {
            title: "Change Language",
            onclick: move |_| {
                emit_lang_selector_click();
            },
            class: "border-none bg-none cursor-pointer p-0 flex items-center justify-center",
            style: "width: 28px; height: 28px;",
            img {
                class: "object-contain hover:scale-110 transition-transform duration-200",
                style: "width: 28px; height: 28px;",
                src: "{flag_src}",
                alt: "flag",
            }
        }
    }
}

/// Root component
fn LangSelectorRoot() -> Element {
    rsx! { LangSelector {} }
}

/// Launch the lang selector component
pub fn launch_lang_selector(initial_flag_svg: &str) {
    log::info!("Launching lang selector");

    let config = dioxus::web::Config::new().rootname("dioxus-lang-selector-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(LangSelectorRoot);

    // Set initial flag after launch
    update_lang_selector_flag(initial_flag_svg);
}

/// Update the displayed language flag
pub fn update_lang_selector_flag(flag_svg: &str) {
    FLAG_SVG_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(flag_svg.to_string());
        }
    });
}

/// Show the lang selector
pub fn show_lang_selector() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(true);
        }
    });
}

/// Hide the lang selector
pub fn hide_lang_selector() {
    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(false);
        }
    });
}
