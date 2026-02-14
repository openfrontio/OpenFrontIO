//! TeamStats Context
//!
//! Provides shared state for the TeamStats component using Dioxus Context API.

use crate::components::{TeamStatsEntry, TeamStatsTranslations};
use dioxus::prelude::*;

/// Context for sharing team stats state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct TeamStatsContext {
    /// Signal containing the team stats entries
    pub entries: Signal<Vec<TeamStatsEntry>>,
    /// Signal containing the translations
    pub translations: Signal<TeamStatsTranslations>,
    /// Whether to show units or control view
    pub show_units: Signal<bool>,
}

impl TeamStatsContext {
    /// Create a new team stats context from existing signals
    pub fn from_signals(
        entries: Signal<Vec<TeamStatsEntry>>,
        translations: Signal<TeamStatsTranslations>,
        show_units: Signal<bool>,
    ) -> Self {
        Self {
            entries,
            translations,
            show_units,
        }
    }
}
