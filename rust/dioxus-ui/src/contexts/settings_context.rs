//! Settings Context
//!
//! Provides shared state for the SettingsModal component using Dioxus Context API.

use crate::components::{Icons, SettingsState, Translations};
use dioxus::prelude::*;

/// Context for sharing settings state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct SettingsContext {
    /// Signal containing the settings state
    pub settings: Signal<SettingsState>,
    /// Signal containing the translations
    pub translations: Signal<Translations>,
    /// Signal containing the icons
    pub icons: Signal<Icons>,
}

impl SettingsContext {
    /// Create a new settings context from existing signals
    pub fn from_signals(
        settings: Signal<SettingsState>,
        translations: Signal<Translations>,
        icons: Signal<Icons>,
    ) -> Self {
        Self {
            settings,
            translations,
            icons,
        }
    }
}
