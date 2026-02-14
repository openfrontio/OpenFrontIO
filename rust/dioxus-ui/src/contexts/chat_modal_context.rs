//! Chat Modal Context
//!
//! Provides shared state for the ChatModal component using Dioxus Context API.

use crate::components::{ChatModalState, ChatModalTranslations, ChatPlayer, QuickChatPhrases};
use dioxus::prelude::*;
use std::collections::HashMap;

/// Context for sharing chat modal state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct ChatModalContext {
    /// Signal containing the modal state
    pub state: Signal<ChatModalState>,
    /// Signal containing the players list
    pub players: Signal<Vec<ChatPlayer>>,
    /// Signal containing the quick chat phrases
    pub quick_chat_phrases: Signal<QuickChatPhrases>,
    /// Signal containing the translations
    pub translations: Signal<ChatModalTranslations>,
    /// Signal containing the phrase translations map
    pub phrase_translations: Signal<HashMap<String, String>>,
}

impl ChatModalContext {
    /// Create a new chat modal context from existing signals
    pub fn from_signals(
        state: Signal<ChatModalState>,
        players: Signal<Vec<ChatPlayer>>,
        quick_chat_phrases: Signal<QuickChatPhrases>,
        translations: Signal<ChatModalTranslations>,
        phrase_translations: Signal<HashMap<String, String>>,
    ) -> Self {
        Self {
            state,
            players,
            quick_chat_phrases,
            translations,
            phrase_translations,
        }
    }
}
