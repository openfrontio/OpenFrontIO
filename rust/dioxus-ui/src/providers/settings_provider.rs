//! Settings Provider
//!
//! Provides the settings context to child components.

use crate::components::{
    settings_store_settings_signal, settings_take_initial_state, FullSettingsModal, Icons,
    SettingsState, Translations,
};
use crate::contexts::SettingsContext;
use dioxus::prelude::*;

/// Props for the SettingsProvider
#[derive(Props, Clone, PartialEq)]
pub struct SettingsProviderProps {
    /// Initial settings state
    pub settings: SettingsState,
    /// Initial translations
    pub translations: Translations,
    /// Initial icons
    pub icons: Icons,
}

/// Provider component that creates and provides the settings context
#[component]
pub fn SettingsProvider(props: SettingsProviderProps) -> Element {
    // Create signals using hooks (must be done in component scope)
    let settings = use_signal(|| props.settings.clone());
    let translations = use_signal(|| props.translations.clone());
    let icons = use_signal(|| props.icons.clone());

    // Create the context from the signals
    let context = SettingsContext::from_signals(settings, translations, icons);

    // Provide the context to children
    use_context_provider(|| context);

    // Store the settings signal in thread-local for external WASM updates
    // This is a minimal use of thread-local just for the WASM bridge
    settings_store_settings_signal(context.settings);

    // Render the FullSettingsModal component which will consume the context
    // Note: We pass default props since the component will use the context
    rsx! {
        FullSettingsModal {
            settings: SettingsState::default(),
            translations: Translations::default(),
            icons: Icons::default(),
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the FullSettingsModal.
pub fn SettingsRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_full_settings_modal before this component runs
    let (settings, translations, icons) = settings_take_initial_state();

    rsx! {
        SettingsProvider {
            settings,
            translations,
            icons,
        }
    }
}
