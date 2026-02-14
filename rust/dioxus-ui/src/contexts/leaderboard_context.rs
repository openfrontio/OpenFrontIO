//! Leaderboard Context
//!
//! Provides shared state for the Leaderboard component using Dioxus Context API.

use crate::components::{LeaderboardEntry, LeaderboardTranslations, SortKey, SortOrder};
use dioxus::prelude::*;

/// Context for sharing leaderboard state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct LeaderboardContext {
    /// Signal containing the leaderboard entries
    pub entries: Signal<Vec<LeaderboardEntry>>,
    /// Signal containing the translations
    pub translations: Signal<LeaderboardTranslations>,
    /// Current sort key
    pub sort_key: Signal<SortKey>,
    /// Current sort order
    pub sort_order: Signal<SortOrder>,
    /// Whether to show only top 5 or all entries
    pub show_top_five: Signal<bool>,
}

impl LeaderboardContext {
    /// Create a new leaderboard context from existing signals
    pub fn from_signals(
        entries: Signal<Vec<LeaderboardEntry>>,
        translations: Signal<LeaderboardTranslations>,
        sort_key: Signal<SortKey>,
        sort_order: Signal<SortOrder>,
        show_top_five: Signal<bool>,
    ) -> Self {
        Self {
            entries,
            translations,
            sort_key,
            sort_order,
            show_top_five,
        }
    }
}
