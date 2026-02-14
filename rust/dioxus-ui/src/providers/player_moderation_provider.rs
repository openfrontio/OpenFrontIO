//! Player Moderation Provider
//!
//! Provides the player moderation context to child components.

use crate::components::{
    player_moderation_store_state_signal, player_moderation_take_initial_state, MyPlayer,
    PlayerModerationModal, PlayerModerationModalState, PlayerModerationTranslations, TargetPlayer,
};
use crate::contexts::PlayerModerationContext;
use dioxus::prelude::*;

/// Props for the PlayerModerationProvider
#[derive(Props, Clone, PartialEq)]
pub struct PlayerModerationProviderProps {
    /// Initial modal state
    pub state: PlayerModerationModalState,
    /// Initial current player info
    pub my_player: MyPlayer,
    /// Initial target player info
    pub target_player: TargetPlayer,
    /// Initial translations
    pub translations: PlayerModerationTranslations,
    /// Kick icon URL
    pub kick_icon: String,
    /// Shield icon URL
    pub shield_icon: String,
}

/// Provider component that creates and provides the player moderation context
#[component]
pub fn PlayerModerationProvider(props: PlayerModerationProviderProps) -> Element {
    // Create signals using hooks (must be done in component scope)
    let state = use_signal(|| props.state.clone());
    let my_player = use_signal(|| props.my_player.clone());
    let target_player = use_signal(|| props.target_player.clone());
    let translations = use_signal(|| props.translations.clone());
    let kick_icon = use_signal(|| props.kick_icon.clone());
    let shield_icon = use_signal(|| props.shield_icon.clone());

    // Create the context from the signals
    let context = PlayerModerationContext::from_signals(
        state,
        my_player,
        target_player,
        translations,
        kick_icon,
        shield_icon,
    );

    // Provide the context to children
    use_context_provider(|| context);

    // Store the state signal in thread-local for external WASM updates
    player_moderation_store_state_signal(context.state);

    // Render the PlayerModerationModal component which will consume the context
    rsx! {
        PlayerModerationModal {
            state: PlayerModerationModalState::default(),
            my_player: MyPlayer::default(),
            target_player: TargetPlayer::default(),
            translations: PlayerModerationTranslations::default(),
            kick_icon: String::new(),
            shield_icon: String::new(),
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the PlayerModerationModal.
pub fn PlayerModerationRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_player_moderation_modal before this component runs
    let (state, my_player, target_player, translations, kick_icon, shield_icon) =
        player_moderation_take_initial_state();

    rsx! {
        PlayerModerationProvider {
            state,
            my_player,
            target_player,
            translations,
            kick_icon,
            shield_icon,
        }
    }
}
