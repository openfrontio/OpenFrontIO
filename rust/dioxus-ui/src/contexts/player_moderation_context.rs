//! Player Moderation Context
//!
//! Provides shared state for the PlayerModerationModal component using Dioxus Context API.

use crate::components::{
    MyPlayer, PlayerModerationModalState, PlayerModerationTranslations, TargetPlayer,
};
use dioxus::prelude::*;

/// Context for sharing player moderation state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct PlayerModerationContext {
    /// Signal containing the modal state
    pub state: Signal<PlayerModerationModalState>,
    /// Signal containing the current player info
    pub my_player: Signal<MyPlayer>,
    /// Signal containing the target player info
    pub target_player: Signal<TargetPlayer>,
    /// Signal containing the translations
    pub translations: Signal<PlayerModerationTranslations>,
    /// Signal containing the kick icon URL
    pub kick_icon: Signal<String>,
    /// Signal containing the shield icon URL
    pub shield_icon: Signal<String>,
}

impl PlayerModerationContext {
    /// Create a new player moderation context from existing signals
    pub fn from_signals(
        state: Signal<PlayerModerationModalState>,
        my_player: Signal<MyPlayer>,
        target_player: Signal<TargetPlayer>,
        translations: Signal<PlayerModerationTranslations>,
        kick_icon: Signal<String>,
        shield_icon: Signal<String>,
    ) -> Self {
        Self {
            state,
            my_player,
            target_player,
            translations,
            kick_icon,
            shield_icon,
        }
    }
}
