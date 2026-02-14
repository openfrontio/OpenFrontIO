//! MultiTab Provider
//!
//! Provides the multi-tab modal context to child components.

use crate::components::{MultiTabModal, MultiTabTranslations};
use crate::contexts::MultiTabContext;
use dioxus::prelude::*;

/// Props for the MultiTabProvider
#[derive(Props, Clone, PartialEq)]
pub struct MultiTabProviderProps {
    /// Initial translations
    pub translations: MultiTabTranslations,
    /// Fake IP address
    pub fake_ip: String,
    /// Device fingerprint
    pub device_fingerprint: String,
    /// Reported status
    pub reported: bool,
}

/// Provider component that creates and provides the multi-tab modal context
#[component]
pub fn MultiTabProvider(props: MultiTabProviderProps) -> Element {
    // Create signals using hooks (must be done in component scope)
    let is_visible = use_signal(|| false);
    let countdown = use_signal(|| 5u32);
    let duration = use_signal(|| 5000u32);
    let translations = use_signal(|| props.translations.clone());
    let fake_ip = use_signal(|| props.fake_ip.clone());
    let device_fingerprint = use_signal(|| props.device_fingerprint.clone());
    let reported = use_signal(|| props.reported);

    // Create the context from the signals
    let context = MultiTabContext::from_signals(
        is_visible,
        countdown,
        duration,
        translations,
        fake_ip,
        device_fingerprint,
        reported,
    );

    // Provide the context to children
    use_context_provider(|| context);

    // Render the MultiTabModal component which will consume the context
    // Note: We pass default props since the component will use the context
    rsx! {
        MultiTabModal {
            translations: MultiTabTranslations::default(),
            fake_ip: String::new(),
            device_fingerprint: String::new(),
            reported: false,
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the MultiTabModal.
pub fn MultiTabRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_multi_tab_modal before this component runs
    let (translations, fake_ip, device_fingerprint, reported) = take_initial_state();

    rsx! {
        MultiTabProvider {
            translations,
            fake_ip,
            device_fingerprint,
            reported,
        }
    }
}

// Thread-local for passing initial state from launch function
use std::cell::RefCell;

thread_local! {
    static INITIAL_STATE: RefCell<Option<(MultiTabTranslations, String, String, bool)>> =
        const { RefCell::new(None) };
}

/// Store initial state for the multi-tab modal (used by launch_multi_tab_modal)
pub fn set_initial_state(
    translations: MultiTabTranslations,
    fake_ip: String,
    device_fingerprint: String,
    reported: bool,
) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((translations, fake_ip, device_fingerprint, reported));
    });
}

/// Take the initial state (used by MultiTabRoot)
pub fn take_initial_state() -> (MultiTabTranslations, String, String, bool) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                MultiTabTranslations::default(),
                String::new(),
                String::new(),
                true,
            )
        })
    })
}
