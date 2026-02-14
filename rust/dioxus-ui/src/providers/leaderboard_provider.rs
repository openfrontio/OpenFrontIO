//! Leaderboard Provider
//!
//! Provides the leaderboard context to child components.

use crate::components::{leaderboard_store_entries_signal, leaderboard_take_initial_state};
use crate::components::{
    Leaderboard, LeaderboardEntry, LeaderboardTranslations, SortKey, SortOrder,
};
use crate::contexts::LeaderboardContext;
use dioxus::prelude::*;

/// Props for the LeaderboardProvider
#[derive(Props, Clone, PartialEq)]
pub struct LeaderboardProviderProps {
    /// Initial leaderboard entries
    pub entries: Vec<LeaderboardEntry>,
    /// Initial translations
    pub translations: LeaderboardTranslations,
    /// Whether to show only top 5 initially
    pub show_top_five: bool,
}

/// Provider component that creates and provides the leaderboard context
#[component]
pub fn LeaderboardProvider(props: LeaderboardProviderProps) -> Element {
    // Create signals using hooks (must be done in component scope)
    let entries = use_signal(|| props.entries.clone());
    let translations = use_signal(|| props.translations.clone());
    let sort_key = use_signal(|| SortKey::Tiles);
    let sort_order = use_signal(|| SortOrder::Desc);
    let show_top_five = use_signal(|| props.show_top_five);

    // Create the context from the signals
    let context = LeaderboardContext::from_signals(
        entries,
        translations,
        sort_key,
        sort_order,
        show_top_five,
    );

    // Provide the context to children
    use_context_provider(|| context);

    // Store the entries signal in thread-local for external WASM updates
    // This is a minimal use of thread-local just for the WASM bridge
    leaderboard_store_entries_signal(context.entries);

    // Render the Leaderboard component which will consume the context
    // Note: We pass default props since the component will use the context
    rsx! {
        Leaderboard {
            entries: vec![],
            translations: LeaderboardTranslations::default(),
            show_top_five: false,
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the Leaderboard.
pub fn LeaderboardRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_leaderboard before this component runs
    let (entries, translations, show_top_five) = leaderboard_take_initial_state();

    rsx! {
        LeaderboardProvider {
            entries,
            translations,
            show_top_five,
        }
    }
}
