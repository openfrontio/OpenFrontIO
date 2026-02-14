//! WinModal component
//!
//! A modal that displays at the end of a game.
//! Shows game stats, cosmetics, and replay options.
//! Handles win/loss scenarios with different content based on context.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;

use crate::providers::win_modal_provider::set_initial_state;
use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the win modal web component
pub fn register() {
    log::debug!("Registered <dioxus-win-modal> component");
}

// Thread-local storage for signals
thread_local! {
    static IS_VISIBLE_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static SHOW_BUTTONS_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static TITLE_SIGNAL: RefCell<Option<Signal<String>>> = const { RefCell::new(None) };
    static IS_WIN_SIGNAL: RefCell<Option<Signal<bool>>> = const { RefCell::new(None) };
    static CONTENT_TYPE_SIGNAL: RefCell<Option<Signal<WinModalContentType>>> = const { RefCell::new(None) };
    static COSMETICS_DATA_SIGNAL: RefCell<Option<Signal<CosmeticsData>>> = const { RefCell::new(None) };
}

use std::cell::RefCell;

/// State for the win modal
#[derive(Clone)]
pub struct WinModalState {
    pub translations: WinModalTranslations,
    pub is_win: bool,
    pub title: String,
    pub content_type: WinModalContentType,
    pub cosmetics_data: CosmeticsData,
    pub is_in_iframe: bool,
    pub games_played: u32,
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

/// Translations passed to Dioxus
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinModalTranslations {
    pub died: String,
    pub your_team: String,
    pub other_team: String,
    pub nation_won: String,
    pub you_won: String,
    pub other_won: String,
    pub exit: String,
    pub keep: String,
    pub spectate: String,
    pub youtube_tutorial: String,
    pub support_openfront: String,
    pub territory_pattern: String,
    pub wishlist: String,
    pub join_discord: String,
    pub discord_description: String,
    pub join_server: String,
}

impl Default for WinModalTranslations {
    fn default() -> Self {
        Self {
            died: "You died".to_string(),
            your_team: "Your Team Won!".to_string(),
            other_team: "Team {team} Won!".to_string(),
            nation_won: "{nation} Won!".to_string(),
            you_won: "You Won!".to_string(),
            other_won: "{player} Won!".to_string(),
            exit: "Exit".to_string(),
            keep: "Keep Playing".to_string(),
            spectate: "Spectate".to_string(),
            youtube_tutorial: "Watch Tutorial".to_string(),
            support_openfront: "Support OpenFront".to_string(),
            territory_pattern: "Get exclusive territory patterns!".to_string(),
            wishlist: "Wishlist on Steam".to_string(),
            join_discord: "Join Discord".to_string(),
            discord_description:
                "Join our Discord community to chat with other players and get updates.".to_string(),
            join_server: "Join Server".to_string(),
        }
    }
}

/// Cosmetics data for displaying purchasable patterns
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosmeticsData {
    pub purchasable_patterns: Vec<PurchasablePattern>,
}

impl Default for CosmeticsData {
    fn default() -> Self {
        Self {
            purchasable_patterns: Vec::new(),
        }
    }
}

/// A purchasable pattern with its color palette
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchasablePattern {
    pub pattern: PatternInfo,
    pub color_palette: ColorPaletteInfo,
}

/// Pattern information
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternInfo {
    pub name: String,
    pub pattern_data: String,
    pub affiliate_code: Option<String>,
    pub product: Option<ProductInfo>,
}

/// Color palette information
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorPaletteInfo {
    pub name: String,
    pub primary_color: String,
    pub secondary_color: String,
}

/// Product information for purchase
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInfo {
    pub price_id: String,
    pub price: String,
}

/// WinModal component props
#[derive(Props, Clone, PartialEq)]
pub struct WinModalProps {
    pub translations: WinModalTranslations,
    pub is_win: bool,
    pub title: String,
    pub content_type: WinModalContentType,
    pub cosmetics_data: CosmeticsData,
}

/// Emit exit event
fn emit_exit_event() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_WIN_MODAL_EXIT),
        Some("component.win-modal"),
        json!({}),
    );
}

/// Emit hide event
fn emit_hide_event() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_WIN_MODAL_HIDE_REQUEST),
        Some("component.win-modal"),
        json!({}),
    );
}

/// Emit purchase event
fn emit_purchase_event(price_id: String, color_palette_name: String) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_WIN_MODAL_PURCHASE),
        Some("component.win-modal"),
        json!({
            "priceId": price_id,
            "colorPaletteName": color_palette_name,
        }),
    );
}

/// Render the YouTube tutorial content
fn render_youtube_tutorial(translations: WinModalTranslations, is_visible: bool) -> Element {
    let video_url = if is_visible {
        "https://www.youtube.com/embed/EN2oOog3pSs"
    } else {
        ""
    };

    rsx! {
        div {
            class: "text-center mb-6 bg-black/30 p-2.5 rounded-sm",
            h3 {
                class: "text-xl font-semibold text-white mb-3",
                "{translations.youtube_tutorial}"
            }
            div {
                class: "relative w-full pb-[56.25%]",
                iframe {
                    class: "absolute top-0 left-0 w-full h-full rounded-sm",
                    src: "{video_url}",
                    title: "YouTube video player",
                    frame_border: "0",
                    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
                    allowfullscreen: true
                }
            }
        }
    }
}

/// Render the Steam wishlist content
fn render_steam_wishlist(translations: WinModalTranslations) -> Element {
    rsx! {
        p {
            class: "m-0 mb-5 text-center bg-black/30 p-2.5 rounded-sm",
            a {
                href: "https://store.steampowered.com/app/3560670",
                target: "_blank",
                rel: "noopener noreferrer",
                class: "text-[#4a9eff] underline font-medium transition-colors duration-200 text-2xl hover:text-[#6db3ff]",
                "{translations.wishlist}"
            }
        }
    }
}

/// Render the Discord join content
fn render_discord(translations: WinModalTranslations) -> Element {
    rsx! {
        div {
            class: "text-center mb-6 bg-black/30 p-2.5 rounded-sm",
            h3 {
                class: "text-xl font-semibold text-white mb-3",
                "{translations.join_discord}"
            }
            p {
                class: "text-white mb-3",
                "{translations.discord_description}"
            }
            a {
                href: "https://discord.com/invite/openfront",
                target: "_blank",
                rel: "noopener noreferrer",
                class: "inline-block px-6 py-3 bg-indigo-600 text-white rounded-sm font-semibold transition-all duration-200 hover:bg-indigo-700 hover:-translate-y-px no-underline",
                "{translations.join_server}"
            }
        }
    }
}

/// Render the pattern button content with purchasable patterns
fn render_pattern_button(
    translations: WinModalTranslations,
    patterns: Vec<PurchasablePattern>,
) -> Element {
    if patterns.is_empty() {
        return rsx! {
            div {
                class: "text-center mb-6 bg-black/30 p-2.5 rounded-sm",
                h3 {
                    class: "text-xl font-semibold text-white mb-3",
                    "{translations.support_openfront}"
                }
                p {
                    class: "text-white mb-3",
                    "{translations.territory_pattern}"
                }
                p {
                    class: "text-white/50 italic text-sm",
                    "No patterns available"
                }
            }
        };
    }

    // Just show the first pattern for now as a simple implementation
    let first_pattern = &patterns[0];
    let pattern_name = first_pattern.pattern.name.clone();
    let palette_name = first_pattern.color_palette.name.clone();
    let product_price = first_pattern
        .pattern
        .product
        .as_ref()
        .map(|p| p.price.clone());
    let price_id = first_pattern
        .pattern
        .product
        .as_ref()
        .map(|p| p.price_id.clone());

    rsx! {
        div {
            class: "text-center mb-6 bg-black/30 p-2.5 rounded-sm",
            h3 {
                class: "text-xl font-semibold text-white mb-3",
                "{translations.support_openfront}"
            }
            p {
                class: "text-white mb-3",
                "{translations.territory_pattern}"
            }
            div {
                class: "flex justify-center",
                div {
                    class: "pattern-button-wrapper",
                    button {
                        class: "px-4 py-2 bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all duration-200 cursor-pointer border-0",
                        onclick: move |_| {
                            if let Some(pid) = &price_id {
                                emit_purchase_event(pid.clone(), palette_name.clone());
                            }
                        },
                        div {
                            class: "text-sm font-medium",
                            "{pattern_name}"
                        }
                        div {
                            class: "text-xs opacity-75",
                            "{palette_name}"
                        }
                        if let Some(price) = &product_price {
                            div {
                                class: "text-xs font-bold mt-1",
                                "{price}"
                            }
                        }
                    }
                }
            }
            if patterns.len() > 1 {
                p {
                    class: "text-white/50 italic text-xs mt-2",
                    "+ {patterns.len() - 1} more patterns"
                }
            }
        }
    }
}

/// Main WinModal component
#[component]
pub fn WinModal(props: WinModalProps) -> Element {
    let is_visible = use_signal(|| false);
    let show_buttons = use_signal(|| false);
    let title = use_signal(|| props.title.clone());
    let is_win = use_signal(|| props.is_win);
    let content_type = use_signal(|| props.content_type);
    let cosmetics_data = use_signal(|| props.cosmetics_data.clone());

    // Store signals for external updates
    IS_VISIBLE_SIGNAL.with(|s| *s.borrow_mut() = Some(is_visible));
    SHOW_BUTTONS_SIGNAL.with(|s| *s.borrow_mut() = Some(show_buttons));
    TITLE_SIGNAL.with(|s| *s.borrow_mut() = Some(title));
    IS_WIN_SIGNAL.with(|s| *s.borrow_mut() = Some(is_win));
    CONTENT_TYPE_SIGNAL.with(|s| *s.borrow_mut() = Some(content_type));
    COSMETICS_DATA_SIGNAL.with(|s| *s.borrow_mut() = Some(cosmetics_data));

    let handle_exit = {
        let mut is_visible = is_visible.clone();
        move |_| {
            is_visible.set(false);
            emit_exit_event();
        }
    };

    let handle_hide = {
        let mut is_visible = is_visible.clone();
        move |_| {
            is_visible.set(false);
            emit_hide_event();
        }
    };

    if !is_visible() {
        return rsx! { div { class: "hidden" } };
    }

    let current_content_type = content_type();
    let current_cosmetics_data = cosmetics_data();
    let current_translations = props.translations.clone();
    let current_is_visible = is_visible();

    rsx! {
        div {
            class: "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 shrink-0 rounded-lg z-9999 shadow-2xl backdrop-blur-xs text-white w-87.5 max-w-[90%] md:w-175 animate-fadeIn",
            style: "animation: fadeIn 0.3s ease-out;",
            h2 {
                class: "m-0 mb-4 text-[26px] text-center text-white",
                "{title()}"
            }

            // Render content based on content type
            {
                match current_content_type {
                    WinModalContentType::YoutubeTutorial => {
                        render_youtube_tutorial(current_translations, current_is_visible)
                    }
                    WinModalContentType::SteamWishlist => {
                        render_steam_wishlist(current_translations)
                    }
                    WinModalContentType::Discord => {
                        render_discord(current_translations)
                    }
                    WinModalContentType::PatternButton => {
                        render_pattern_button(current_translations, current_cosmetics_data.purchasable_patterns.clone())
                    }
                }
            }

            div {
                class: if show_buttons() {
                    "flex justify-between gap-2.5"
                } else {
                    "hidden"
                },
                button {
                    class: "flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px",
                    onclick: handle_exit,
                    "{props.translations.exit}"
                }
                button {
                    class: "flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px",
                    onclick: handle_hide,
                    if is_win() {
                        "{props.translations.keep}"
                    } else {
                        "{props.translations.spectate}"
                    }
                }
            }
        }
    }
}

/// Launch the win modal component
pub fn launch_win_modal(translations_json: &str, is_in_iframe: bool, games_played: u32) {
    log::info!("Launching win modal");

    let translations: WinModalTranslations = match serde_json::from_str(translations_json) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to parse translations: {}", e);
            WinModalTranslations::default()
        }
    };

    // Determine initial content type based on conditions
    let content_type = if is_in_iframe {
        WinModalContentType::SteamWishlist
    } else if !is_in_iframe && games_played < 3 {
        WinModalContentType::YoutubeTutorial
    } else {
        // Random selection will be done on show
        WinModalContentType::SteamWishlist
    };

    // Store state using the provider's function
    set_initial_state(WinModalState {
        translations,
        is_win: false,
        title: String::new(),
        content_type,
        cosmetics_data: CosmeticsData::default(),
        is_in_iframe,
        games_played,
    });

    let config = dioxus::web::Config::new().rootname("dioxus-win-modal-root");

    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(crate::providers::win_modal_provider::WinModalRoot);
}

/// Show the modal with specified title and content
pub fn show_win_modal(title: &str, is_win: bool, content_type_json: &str, cosmetics_json: &str) {
    log::debug!(
        "show_win_modal called with title: {}, is_win: {}",
        title,
        is_win
    );

    let content_type: WinModalContentType =
        serde_json::from_str(content_type_json).unwrap_or_default();

    let cosmetics_data: CosmeticsData = serde_json::from_str(cosmetics_json).unwrap_or_default();

    TITLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!("Setting title to {}", title);
            signal.set(title.to_string());
        }
    });

    IS_WIN_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!("Setting is_win to {}", is_win);
            signal.set(is_win);
        }
    });

    CONTENT_TYPE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!("Setting content_type to {:?}", content_type);
            signal.set(content_type);
        }
    });

    COSMETICS_DATA_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!(
                "Setting cosmetics data with {} patterns",
                cosmetics_data.purchasable_patterns.len()
            );
            signal.set(cosmetics_data);
        }
    });

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!("Showing win modal");
            signal.set(true);
        } else {
            log::warn!("IS_VISIBLE_SIGNAL is None, cannot show modal");
        }
    });

    // Show buttons after 3 seconds
    let window = web_sys::window().expect("no global window");
    let closure = Closure::wrap(Box::new(move || {
        SHOW_BUTTONS_SIGNAL.with(|s| {
            if let Some(ref mut signal) = *s.borrow_mut() {
                log::info!("Showing buttons");
                signal.set(true);
            }
        });
    }) as Box<dyn FnMut()>);

    let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
        closure.as_ref().unchecked_ref(),
        3000,
    );
    closure.forget();
}

/// Hide the modal
pub fn hide_win_modal() {
    log::debug!("hide_win_modal called");

    IS_VISIBLE_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!("Hiding win modal");
            signal.set(false);
        } else {
            log::warn!("IS_VISIBLE_SIGNAL is None, cannot hide modal");
        }
    });

    SHOW_BUTTONS_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            signal.set(false);
        }
    });
}

/// Update cosmetics data
pub fn update_win_modal_cosmetics(cosmetics_json: &str) {
    log::debug!("update_win_modal_cosmetics called");

    let cosmetics_data: CosmeticsData = match serde_json::from_str(cosmetics_json) {
        Ok(data) => data,
        Err(e) => {
            log::error!("Failed to parse cosmetics data: {}", e);
            CosmeticsData::default()
        }
    };

    COSMETICS_DATA_SIGNAL.with(|s| {
        if let Some(ref mut signal) = *s.borrow_mut() {
            log::info!(
                "Updating cosmetics data with {} patterns",
                cosmetics_data.purchasable_patterns.len()
            );
            signal.set(cosmetics_data);
        }
    });
}
