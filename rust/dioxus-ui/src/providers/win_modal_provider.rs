//! WinModal Provider
//!
//! Provides the win modal context to child components.

use crate::components::{
    CosmeticsData, WinModal, WinModalContentType, WinModalState, WinModalTranslations,
};
use dioxus::prelude::*;

/// Props for the WinModalProvider
#[derive(Props, Clone, PartialEq)]
pub struct WinModalProviderProps {
    /// Initial translations
    pub translations: WinModalTranslations,
    /// Initial is win state
    pub is_win: bool,
    /// Initial title
    pub title: String,
    /// Initial content type
    pub content_type: WinModalContentType,
    /// Initial cosmetics data
    pub cosmetics_data: CosmeticsData,
}

/// Provider component that creates and provides the win modal context
#[component]
pub fn WinModalProvider(props: WinModalProviderProps) -> Element {
    rsx! {
        WinModal {
            translations: props.translations,
            is_win: props.is_win,
            title: props.title,
            content_type: props.content_type,
            cosmetics_data: props.cosmetics_data,
        }
    }
}

/// Root component that uses the provider pattern
///
/// This is the entry point for the Dioxus app. It creates the provider
/// with initial values and renders the WinModal.
pub fn WinModalRoot() -> Element {
    // We need to get the initial values from thread-local storage
    // This is set by launch_win_modal before this component runs
    let state = take_initial_state();

    rsx! {
        WinModalProvider {
            translations: state.translations,
            is_win: state.is_win,
            title: state.title,
            content_type: state.content_type,
            cosmetics_data: state.cosmetics_data,
        }
    }
}

// Thread-local for passing initial state from launch function
use std::cell::RefCell;

thread_local! {
    static INITIAL_STATE: RefCell<Option<WinModalState>> =
        const { RefCell::new(None) };
}

/// Store initial state for the win modal (used by launch_win_modal)
pub fn set_initial_state(state: WinModalState) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some(state);
    });
}

/// Take the initial state (used by WinModalRoot)
pub fn take_initial_state() -> WinModalState {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| WinModalState {
            translations: WinModalTranslations::default(),
            is_win: false,
            title: String::new(),
            content_type: WinModalContentType::SteamWishlist,
            cosmetics_data: CosmeticsData::default(),
            is_in_iframe: false,
            games_played: 0,
        })
    })
}
