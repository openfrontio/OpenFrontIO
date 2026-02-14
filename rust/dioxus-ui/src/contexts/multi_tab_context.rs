//! MultiTab Context
//!
//! Provides shared state for the MultiTabModal component using Dioxus Context API.

use crate::components::MultiTabTranslations;
use dioxus::prelude::*;

/// Context for sharing multi-tab modal state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct MultiTabContext {
    /// Signal containing the visibility state
    pub is_visible: Signal<bool>,
    /// Signal containing the countdown value
    pub countdown: Signal<u32>,
    /// Signal containing the duration in milliseconds
    pub duration: Signal<u32>,
    /// Signal containing the translations
    pub translations: Signal<MultiTabTranslations>,
    /// Signal containing the fake IP
    pub fake_ip: Signal<String>,
    /// Signal containing the device fingerprint
    pub device_fingerprint: Signal<String>,
    /// Signal containing the reported status
    pub reported: Signal<bool>,
}

impl MultiTabContext {
    /// Create a new multi-tab context from existing signals
    pub fn from_signals(
        is_visible: Signal<bool>,
        countdown: Signal<u32>,
        duration: Signal<u32>,
        translations: Signal<MultiTabTranslations>,
        fake_ip: Signal<String>,
        device_fingerprint: Signal<String>,
        reported: Signal<bool>,
    ) -> Self {
        Self {
            is_visible,
            countdown,
            duration,
            translations,
            fake_ip,
            device_fingerprint,
            reported,
        }
    }
}
