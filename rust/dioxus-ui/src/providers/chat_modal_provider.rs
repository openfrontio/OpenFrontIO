//! Chat Modal Provider
//!
//! Provides the chat modal context to child components.

use crate::components::{
    chat_modal_store_players_signal, chat_modal_store_state_signal, chat_modal_take_initial_state,
    ChatModalComponent as ChatModal, ChatModalState, ChatModalTranslations, ChatPlayer,
    QuickChatPhrases,
};
use crate::contexts::ChatModalContext;
use dioxus::prelude::*;
use std::collections::HashMap;

/// Props for the ChatModalProvider
#[derive(Props, Clone, PartialEq)]
pub struct ChatModalProviderProps {
    /// Initial modal state
    pub state: ChatModalState,
    /// Initial players list
    pub players: Vec<ChatPlayer>,
    /// Initial quick chat phrases
    pub quick_chat_phrases: QuickChatPhrases,
    /// Initial translations
    pub translations: ChatModalTranslations,
    /// Initial phrase translations map
    pub phrase_translations: HashMap<String, String>,
}

/// Provider component that creates and provides the chat modal context
#[component]
pub fn ChatModalProvider(props: ChatModalProviderProps) -> Element {
    // Create signals using hooks (must be done in component scope)
    let state = use_signal(|| props.state.clone());
    let players = use_signal(|| props.players.clone());
    let quick_chat_phrases = use_signal(|| props.quick_chat_phrases.clone());
    let translations = use_signal(|| props.translations.clone());
    let phrase_translations = use_signal(|| props.phrase_translations.clone());

    // Create the context from the signals
    let context = ChatModalContext::from_signals(
        state,
        players,
        quick_chat_phrases,
        translations,
        phrase_translations,
    );

    // Provide the context to children
    use_context_provider(|| context);

    // Store the signals in thread-local for external WASM updates
    chat_modal_store_state_signal(context.state);
    chat_modal_store_players_signal(context.players);

    // Render the ChatModal component which will consume the context
    rsx! {
        ChatModal {
            state: ChatModalState::default(),
            players: Vec::new(),
            quick_chat_phrases: HashMap::new(),
            translations: ChatModalTranslations::default(),
            phrase_translations: HashMap::new(),
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the ChatModal.
pub fn ChatModalRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_chat_modal before this component runs
    let (state, players, quick_chat_phrases, translations, phrase_translations) =
        chat_modal_take_initial_state();

    rsx! {
        ChatModalProvider {
            state,
            players,
            quick_chat_phrases,
            translations,
            phrase_translations,
        }
    }
}
