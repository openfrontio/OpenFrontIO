//! TeamStats Provider
//!
//! Provides the team stats context to child components.

use crate::components::{
    team_stats_store_entries_signal, team_stats_take_initial_state, TeamStats, TeamStatsEntry,
    TeamStatsTranslations,
};
use crate::contexts::TeamStatsContext;
use dioxus::prelude::*;

/// Props for the TeamStatsProvider
#[derive(Props, Clone, PartialEq)]
pub struct TeamStatsProviderProps {
    /// Initial team stats entries
    pub entries: Vec<TeamStatsEntry>,
    /// Initial translations
    pub translations: TeamStatsTranslations,
}

/// Provider component that creates and provides the team stats context
#[component]
pub fn TeamStatsProvider(props: TeamStatsProviderProps) -> Element {
    // Create signals using hooks (must be done in component scope)
    let entries = use_signal(|| props.entries.clone());
    let translations = use_signal(|| props.translations.clone());
    let show_units = use_signal(|| false); // Default to showing control view, not units

    // Create the context from the signals
    let context = TeamStatsContext::from_signals(entries, translations, show_units);

    // Provide the context to children
    use_context_provider(|| context);

    // Store the entries signal in thread-local for external WASM updates
    // This is a minimal use of thread-local just for the WASM bridge
    team_stats_store_entries_signal(context.entries);

    // Render the TeamStats component which will consume the context
    // Pass default/empty props since the component will use the context
    rsx! {
        TeamStats {
            entries: vec![],
            translations: TeamStatsTranslations::default(),
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the TeamStats.
pub fn TeamStatsRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_team_stats before this component runs
    let (entries, translations) = team_stats_take_initial_state();

    rsx! {
        TeamStatsProvider {
            entries,
            translations,
        }
    }
}
