//! UsernameInput component
//!
//! A compound input with a clan tag field and a username field.
//! Displays validation errors below the inputs.
//! Emits events when the username changes so the TS bridge can handle validation and storage.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// Register the username input component
pub fn register() {
    log::debug!("Registered <dioxus-username-input> component");
}

// Thread-local storage for component state
thread_local! {
    static CLAN_TAG_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static USERNAME_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static VALIDATION_ERROR_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static TRANSLATIONS_SIGNAL: RefCell<Option<Signal<UsernameInputTranslations>>> = const { RefCell::new(None) };
}

/// Translations for the username input
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameInputTranslations {
    pub tag_placeholder: String,
    pub username_placeholder: String,
}

/// Emit event when clan tag changes
fn emit_clan_tag_change(value: &str) {
    use wasm_bindgen::JsValue;
    use web_sys::CustomEventInit;

    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let mut init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);
    init.set_detail(&JsValue::from_str(value));

    if let Ok(event) =
        web_sys::CustomEvent::new_with_event_init_dict("dioxus-clan-tag-change", &init)
    {
        if let Some(root) = document.get_element_by_id("dioxus-username-input-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Emit event when username changes
fn emit_username_change(value: &str) {
    use wasm_bindgen::JsValue;
    use web_sys::CustomEventInit;

    let window = web_sys::window().expect("no global window");
    let document = window.document().expect("no document");

    let mut init = CustomEventInit::new();
    init.set_bubbles(true);
    init.set_composed(true);
    init.set_detail(&JsValue::from_str(value));

    if let Ok(event) =
        web_sys::CustomEvent::new_with_event_init_dict("dioxus-username-change", &init)
    {
        if let Some(root) = document.get_element_by_id("dioxus-username-input-root") {
            let _ = root.dispatch_event(&event);
        }
    }
}

/// Main UsernameInput component
#[component]
fn UsernameInput() -> Element {
    let mut clan_tag = use_signal(String::new);
    let mut username = use_signal(String::new);
    let validation_error = use_signal(String::new);
    let translations = use_signal(UsernameInputTranslations::default);

    CLAN_TAG_SIGNAL.with(|s| *s.borrow_mut() = Some(clan_tag));
    USERNAME_SIGNAL.with(|s| *s.borrow_mut() = Some(username));
    VALIDATION_ERROR_SIGNAL.with(|s| *s.borrow_mut() = Some(validation_error));
    TRANSLATIONS_SIGNAL.with(|s| *s.borrow_mut() = Some(translations));

    let t = translations();
    let error = validation_error();

    rsx! {
        div {
            class: "flex items-center w-full h-full gap-2",
            input {
                r#type: "text",
                value: "{clan_tag}",
                placeholder: "{t.tag_placeholder}",
                maxlength: "5",
                class: "w-[6rem] bg-transparent border-b border-white/20 text-white placeholder-white/30 text-xl font-bold text-center focus:outline-none focus:border-white/50 transition-colors uppercase shrink-0",
                oninput: move |e| {
                    let val = e.value();
                    clan_tag.set(val.clone());
                    emit_clan_tag_change(&val);
                },
            }
            input {
                r#type: "text",
                value: "{username}",
                placeholder: "{t.username_placeholder}",
                maxlength: "30",
                class: "flex-1 min-w-0 bg-transparent border-0 text-white placeholder-white/30 text-2xl font-bold text-left focus:outline-none focus:ring-0 transition-colors overflow-x-auto whitespace-nowrap text-ellipsis pr-2",
                oninput: move |e| {
                    let val = e.value();
                    username.set(val.clone());
                    emit_username_change(&val);
                },
            }
        }
        if !error.is_empty() {
            div {
                class: "absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg",
                "{error}"
            }
        }
    }
}

/// Root component
fn UsernameInputRoot() -> Element {
    rsx! { UsernameInput {} }
}

/// Launch the username input component
pub fn launch_username_input(translations_json: &str) {
    log::info!("Launching username input");

    let config = dioxus::web::Config::new().rootname("dioxus-username-input-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(UsernameInputRoot);

    // Set initial translations after launch
    update_username_input_translations(translations_json);
}

/// Update the clan tag value (from TS-side sanitization)
pub fn update_username_input_clan_tag(value: &str) {
    CLAN_TAG_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(value.to_string());
        }
    });
}

/// Update the username value
pub fn update_username_input_username(value: &str) {
    USERNAME_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(value.to_string());
        }
    });
}

/// Update the validation error message
pub fn update_username_input_validation_error(error: &str) {
    VALIDATION_ERROR_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(error.to_string());
        }
    });
}

/// Update translations
pub fn update_username_input_translations(translations_json: &str) {
    let translations: UsernameInputTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse username input translations: {}", e);
            return;
        }
    };

    TRANSLATIONS_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow().clone() {
            signal.set(translations);
        }
    });
}
