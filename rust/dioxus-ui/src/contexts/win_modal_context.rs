//! WinModal Context
//!
//! Provides shared state for the WinModal component using Dioxus Context API.

use crate::components::{CosmeticsData, WinModalTranslations};
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

/// Context for sharing win modal state across components
///
/// This struct holds Signals that can be shared across the component tree.
/// It uses Copy + Clone since it only contains Signal handles which are cheap to copy.
#[derive(Clone, Copy)]
pub struct WinModalContext {
    /// Signal containing the visibility state
    pub is_visible: Signal<bool>,
    /// Signal containing the show buttons state
    pub show_buttons: Signal<bool>,
    /// Signal containing the title
    pub title: Signal<String>,
    /// Signal containing whether this is a win
    pub is_win: Signal<bool>,
    /// Signal containing the content type
    pub content_type: Signal<WinModalContentType>,
    /// Signal containing the translations
    pub translations: Signal<WinModalTranslations>,
    /// Signal containing the cosmetics data
    pub cosmetics_data: Signal<CosmeticsData>,
}

/// Content type to display in the modal
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WinModalContentType {
    YoutubeTutorial,
    SteamWishlist,
    Discord,
    PatternButton,
}

impl Default for WinModalContentType {
    fn default() -> Self {
        Self::SteamWishlist
    }
}

impl WinModalContext {
    /// Create a new win modal context from existing signals
    pub fn from_signals(
        is_visible: Signal<bool>,
        show_buttons: Signal<bool>,
        title: Signal<String>,
        is_win: Signal<bool>,
        content_type: Signal<WinModalContentType>,
        translations: Signal<WinModalTranslations>,
        cosmetics_data: Signal<CosmeticsData>,
    ) -> Self {
        Self {
            is_visible,
            show_buttons,
            title,
            is_win,
            content_type,
            translations,
            cosmetics_data,
        }
    }
}
