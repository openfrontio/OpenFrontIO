//! Chat Modal component
//!
//! A modal for in-game quick chat communication with category selection,
//! phrase selection, and player targeting.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;
use std::collections::HashMap;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the chat modal web component
pub fn register() {
    log::debug!("Registered <chat-modal> component");
}

/// Chat category
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCategory {
    pub id: String,
}

/// Quick chat phrase
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuickChatPhrase {
    pub key: String,
    pub requires_player: bool,
}

/// Player information for chat targeting
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatPlayer {
    pub id: String,
    pub name: String,
}

/// Quick chat phrases by category
pub type QuickChatPhrases = HashMap<String, Vec<QuickChatPhrase>>;

/// Chat modal state received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatModalState {
    pub is_open: bool,
    pub selected_category: Option<String>,
    pub selected_phrase_text: Option<String>,
    pub selected_phrase_template: Option<String>,
    pub selected_quick_chat_key: Option<String>,
    pub preview_text: Option<String>,
    pub requires_player_selection: bool,
    pub player_search_query: String,
    pub selected_player_id: Option<String>,
}

/// Translations received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatModalTranslations {
    pub title: String,
    pub category: String,
    pub phrase: String,
    pub player: String,
    pub search: String,
    pub build: String,
    pub send: String,
    pub close: String,
    // Category translations (dynamic keys)
    pub cat_help: String,
    pub cat_attack: String,
    pub cat_defend: String,
    pub cat_greet: String,
    pub cat_misc: String,
    pub cat_warnings: String,
}

/// Modal props
#[derive(Props, Clone, PartialEq)]
pub struct ChatModalProps {
    pub state: ChatModalState,
    pub players: Vec<ChatPlayer>,
    pub quick_chat_phrases: QuickChatPhrases,
    pub translations: ChatModalTranslations,
    /// Map of phrase translation keys to translated text
    pub phrase_translations: HashMap<String, String>,
}

/// Get category display name
fn get_category_name(category_id: &str, translations: &ChatModalTranslations) -> String {
    match category_id {
        "help" => translations.cat_help.clone(),
        "attack" => translations.cat_attack.clone(),
        "defend" => translations.cat_defend.clone(),
        "greet" => translations.cat_greet.clone(),
        "misc" => translations.cat_misc.clone(),
        "warnings" => translations.cat_warnings.clone(),
        _ => category_id.to_string(),
    }
}

/// Available categories
fn get_categories() -> Vec<ChatCategory> {
    vec![
        ChatCategory {
            id: "help".to_string(),
        },
        ChatCategory {
            id: "attack".to_string(),
        },
        ChatCategory {
            id: "defend".to_string(),
        },
        ChatCategory {
            id: "greet".to_string(),
        },
        ChatCategory {
            id: "misc".to_string(),
        },
        ChatCategory {
            id: "warnings".to_string(),
        },
    ]
}

/// Chat Modal component
///
/// This component provides quick chat functionality:
/// - Category selection
/// - Phrase selection with preview
/// - Player targeting for phrases that require it
/// - Send chat message event
#[component]
pub fn ChatModal(props: ChatModalProps) -> Element {
    // Try to get the context first (preferred way)
    let has_context = try_use_context::<crate::contexts::ChatModalContext>().is_some();

    if has_context {
        let context = use_context::<crate::contexts::ChatModalContext>();
        render_chat_modal_with_context(context)
    } else {
        // Fallback: render with props (for standalone usage without context)
        render_chat_modal_with_props(props)
    }
}

/// Render the chat modal using context state
fn render_chat_modal_with_context(context: crate::contexts::ChatModalContext) -> Element {
    let mut state = context.state;
    let players = context.players;
    let quick_chat_phrases = context.quick_chat_phrases;
    let translations = context.translations;
    let phrase_translations = context.phrase_translations;

    // Clone signals for use in closures
    let translations_clone = translations.clone();
    let phrase_translations_clone = phrase_translations.clone();

    // Close handler
    let on_close = {
        let mut state = state.clone();
        move |_| {
            reset_modal_state(&mut state);
            emit_modal_close();
        }
    };

    // Handle backdrop click
    let on_backdrop_click = {
        let mut state = state.clone();
        move |_| {
            reset_modal_state(&mut state);
            emit_modal_close();
        }
    };

    // Category selection handler
    let select_category = {
        let mut state = state.clone();
        move |category_id: String| {
            state.write().selected_category = Some(category_id.clone());
            state.write().selected_phrase_text = None;
            state.write().selected_phrase_template = None;
            state.write().selected_quick_chat_key = None;
            state.write().preview_text = Some("chat.build".to_string());
            state.write().requires_player_selection = false;
            state.write().selected_player_id = None;
        }
    };

    // Phrase selection handler
    let select_phrase = {
        let mut state = state.clone();
        let phrase_translations = phrase_translations.clone();
        move |category_id: String, phrase: QuickChatPhrase| {
            let full_key = format!("{}.{}", category_id, phrase.key);
            let translated_text = phrase_translations()
                .get(&format!("chat.{}.{}", category_id, phrase.key))
                .cloned()
                .unwrap_or_else(|| format!("chat.{}.{}", category_id, phrase.key));

            state.write().selected_quick_chat_key = Some(full_key);
            state.write().selected_phrase_template = Some(translated_text.clone());
            state.write().selected_phrase_text = Some(translated_text);
            state.write().preview_text = Some(format!("chat.{}.{}", category_id, phrase.key));
            state.write().requires_player_selection = phrase.requires_player;
            if !phrase.requires_player {
                state.write().selected_player_id = None;
            }
        }
    };

    // Player selection handler
    let select_player = {
        let mut state = state.clone();
        move |player_id: String, player_name: String| {
            if let Some(template) = state().selected_phrase_template.clone() {
                let with_player = template.replace("[P1]", &player_name);
                state.write().preview_text = Some(with_player);
                state.write().selected_player_id = Some(player_id);
                state.write().requires_player_selection = false;
            }
        }
    };

    // Player search handler
    let on_player_search = {
        let mut state = state.clone();
        move |evt: FormEvent| {
            state.write().player_search_query = evt.value().to_lowercase();
        }
    };

    // Send message handler
    let on_send = {
        let mut state = state.clone();
        move |_| {
            let s = state();
            if s.preview_text.is_some() && s.selected_quick_chat_key.is_some() {
                if !s.requires_player_selection || s.selected_player_id.is_some() {
                    emit_send_chat_event(
                        &s.selected_quick_chat_key.unwrap(),
                        &s.selected_player_id,
                        &s.preview_text.clone().unwrap_or_default(),
                    );
                    reset_modal_state(&mut state);
                    emit_modal_close();
                }
            }
        }
    };

    let categories = get_categories();

    // Memoized computations
    let is_open = use_memo(move || state().is_open);
    let can_send = use_memo(move || {
        let s = state();
        s.preview_text.is_some() && (!s.requires_player_selection || s.selected_player_id.is_some())
    });

    let selected_category = use_memo(move || state().selected_category.clone());
    let requires_player = use_memo(move || state().requires_player_selection);
    let has_selected_player = use_memo(move || state().selected_player_id.is_some());

    // Preview text computation
    let preview_display = use_memo(move || {
        let s = state();
        if let Some(preview) = s.preview_text.clone() {
            phrase_translations()
                .get(&preview)
                .cloned()
                .unwrap_or(preview)
        } else {
            translations().build.clone()
        }
    });

    // Filter and sort players
    let filtered_players = use_memo(move || {
        let search_query = state().player_search_query.clone();
        let mut players: Vec<_> = players()
            .iter()
            .filter(|p| p.name.to_lowercase().contains(&search_query))
            .cloned()
            .collect();
        players.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        players
    });

    let other_players = use_memo(move || {
        let search_query = state().player_search_query.clone();
        let mut players: Vec<_> = players()
            .iter()
            .filter(|p| !p.name.to_lowercase().contains(&search_query))
            .cloned()
            .collect();
        players.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        players
    });

    // Get current category phrases
    let current_phrases = use_memo(move || {
        let cat = selected_category();
        let phrases = quick_chat_phrases();
        if let Some(category) = cat {
            phrases.get(&category).cloned().unwrap_or_default()
        } else {
            Vec::new()
        }
    });

    // Player search query value
    let player_search_value = use_memo(move || state().player_search_query.clone());

    if !is_open() {
        return rsx! {};
    }

    rsx! {
        div {
            class: "absolute inset-0 z-1200 flex items-center justify-center p-4",

            // Backdrop
            div {
                class: "absolute inset-0 bg-black/60 rounded-2xl",
                onclick: on_backdrop_click,
            }

            // Modal content
            div {
                role: "dialog",
                aria_modal: "true",
                aria_labelledby: "chat-title",
                class: "relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-zinc-800 text-white",
                tabindex: "0",
                onclick: move |e: MouseEvent| e.stop_propagation(),

                // Header with close button
                div {
                    class: "flex items-center justify-between p-4 border-b border-zinc-700",

                    h2 {
                        id: "chat-title",
                        class: "text-lg font-semibold text-zinc-100",
                        "{translations_clone().title}"
                    }

                    button {
                        r#type: "button",
                        class: "text-zinc-400 hover:text-white text-2xl font-bold leading-none px-2",
                        aria_label: "{translations_clone().close}",
                        onclick: on_close,
                        "×"
                    }
                }

                // Chat columns (category, phrase, player)
                div {
                    class: "flex gap-4 p-4 overflow-x-auto chat-columns",

                    // Category column
                    div {
                        class: "flex flex-col gap-2 min-w-[140px] chat-column",
                        div {
                            class: "font-bold text-zinc-300 mb-1 column-title",
                            "{translations_clone().category}"
                        }
                        for category in categories.iter() {
                            {
                                let category_id = category.id.clone();
                                let is_selected = selected_category().as_ref() == Some(&category.id);
                                let mut select_cat = select_category.clone();
                                let cat_name = get_category_name(&category.id, &translations_clone());
                                let selected_class = if is_selected { " selected" } else { "" };

                                rsx! {
                                    button {
                                        class: "chat-option-button{selected_class}",
                                        onclick: move |_| select_cat(category_id.clone()),
                                        "{cat_name}"
                                    }
                                }
                            }
                        }
                    }

                    // Phrase column (shown when category is selected)
                    if selected_category().is_some() {
                        div {
                            class: "flex flex-col gap-2 min-w-[140px] chat-column",
                            div {
                                class: "font-bold text-zinc-300 mb-1 column-title",
                                "{translations_clone().phrase}"
                            }
                            div {
                                class: "max-h-[280px] overflow-y-auto flex flex-col gap-1.5 pr-1 phrase-scroll-area",
                                for phrase in current_phrases().iter() {
                                    {
                                        let cat_id = selected_category().clone().unwrap_or_default();
                                        let phrase_key = format!("chat.{}.{}", cat_id, phrase.key);
                                        let translated = phrase_translations_clone()
                                            .get(&phrase_key)
                                            .cloned()
                                            .unwrap_or_else(|| phrase_key.clone());
                                        let ph = phrase.clone();
                                        let cat_id_clone = cat_id.clone();
                                        let mut select_ph = select_phrase.clone();
                                        let is_selected = state().selected_phrase_text.as_ref() == Some(&translated);
                                        let selected_class = if is_selected { " selected" } else { "" };

                                        rsx! {
                                            button {
                                                class: "chat-option-button{selected_class}",
                                                onclick: move |_| select_ph(cat_id_clone.clone(), ph.clone()),
                                                "{translated}"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Player column (shown when phrase requires player or player is selected)
                    if requires_player() || has_selected_player() {
                        div {
                            class: "flex flex-col gap-2 min-w-[140px] chat-column",
                            div {
                                class: "font-bold text-zinc-300 mb-1 column-title",
                                "{translations_clone().player}"
                            }
                            input {
                                class: "player-search-input",
                                r#type: "text",
                                placeholder: "{translations_clone().search}",
                                value: "{player_search_value()}",
                                oninput: on_player_search
                            }
                            div {
                                class: "max-h-[240px] overflow-y-auto flex flex-col gap-1.5 pr-1 mt-2 player-scroll-area",
                                for player in filtered_players().iter().chain(other_players().iter()) {
                                    {
                                        let p = player.clone();
                                        let mut select_pl = select_player.clone();
                                        let is_selected = state().selected_player_id.as_ref() == Some(&p.id);
                                        let selected_class = if is_selected { " selected" } else { "" };

                                        rsx! {
                                            button {
                                                class: "chat-option-button{selected_class}",
                                                onclick: move |_| select_pl(p.id.clone(), p.name.clone()),
                                                "{p.name}"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Preview area
                div {
                    class: "chat-preview",
                    style: "margin: 10px 12px; padding: 10px; background: #222; color: white; border-radius: 6px; text-align: center;",
                    "{preview_display()}"
                }

                // Send button
                div {
                    class: "chat-send",
                    style: "display: flex; justify-content: flex-end; padding: 0 12px 12px;",
                    button {
                        class: "chat-send-button",
                        disabled: !can_send(),
                        onclick: on_send,
                        style: if can_send() {
                            "background: #4caf50; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;"
                        } else {
                            "background: #666; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: not-allowed;"
                        },
                        "{translations_clone().send}"
                    }
                }
            }
        }
    }
}

/// Render the chat modal using props (fallback for non-context usage)
fn render_chat_modal_with_props(props: ChatModalProps) -> Element {
    let mut state = use_signal(|| props.state.clone());
    let players = use_signal(|| props.players.clone());
    let quick_chat_phrases = use_signal(|| props.quick_chat_phrases.clone());
    let translations = use_signal(|| props.translations.clone());
    let phrase_translations = use_signal(|| props.phrase_translations.clone());

    // Store the state signal for external updates
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(state);
    });
    PLAYERS_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(players);
    });

    // Clone signals for use in closures
    let translations_clone = translations.clone();
    let phrase_translations_clone = phrase_translations.clone();

    // Close handler
    let on_close = {
        let mut state = state.clone();
        move |_| {
            reset_modal_state(&mut state);
            emit_modal_close();
        }
    };

    // Handle backdrop click
    let on_backdrop_click = {
        let mut state = state.clone();
        move |_| {
            reset_modal_state(&mut state);
            emit_modal_close();
        }
    };

    // Category selection handler
    let select_category = {
        let mut state = state.clone();
        move |category_id: String| {
            state.write().selected_category = Some(category_id.clone());
            state.write().selected_phrase_text = None;
            state.write().selected_phrase_template = None;
            state.write().selected_quick_chat_key = None;
            state.write().preview_text = Some("chat.build".to_string());
            state.write().requires_player_selection = false;
            state.write().selected_player_id = None;
        }
    };

    // Phrase selection handler
    let select_phrase = {
        let mut state = state.clone();
        let phrase_translations = phrase_translations.clone();
        move |category_id: String, phrase: QuickChatPhrase| {
            let full_key = format!("{}.{}", category_id, phrase.key);
            let translated_text = phrase_translations()
                .get(&format!("chat.{}.{}", category_id, phrase.key))
                .cloned()
                .unwrap_or_else(|| format!("chat.{}.{}", category_id, phrase.key));

            state.write().selected_quick_chat_key = Some(full_key);
            state.write().selected_phrase_template = Some(translated_text.clone());
            state.write().selected_phrase_text = Some(translated_text);
            state.write().preview_text = Some(format!("chat.{}.{}", category_id, phrase.key));
            state.write().requires_player_selection = phrase.requires_player;
            if !phrase.requires_player {
                state.write().selected_player_id = None;
            }
        }
    };

    // Player selection handler
    let select_player = {
        let mut state = state.clone();
        move |player_id: String, player_name: String| {
            if let Some(template) = state().selected_phrase_template.clone() {
                let with_player = template.replace("[P1]", &player_name);
                state.write().preview_text = Some(with_player);
                state.write().selected_player_id = Some(player_id);
                state.write().requires_player_selection = false;
            }
        }
    };

    // Player search handler
    let on_player_search = {
        let mut state = state.clone();
        move |evt: FormEvent| {
            state.write().player_search_query = evt.value().to_lowercase();
        }
    };

    // Send message handler
    let on_send = {
        let mut state = state.clone();
        move |_| {
            let s = state();
            if s.preview_text.is_some() && s.selected_quick_chat_key.is_some() {
                if !s.requires_player_selection || s.selected_player_id.is_some() {
                    emit_send_chat_event(
                        &s.selected_quick_chat_key.unwrap(),
                        &s.selected_player_id,
                        &s.preview_text.clone().unwrap_or_default(),
                    );
                    reset_modal_state(&mut state);
                    emit_modal_close();
                }
            }
        }
    };

    let categories = get_categories();

    // Memoized computations
    let is_open = use_memo(move || state().is_open);
    let can_send = use_memo(move || {
        let s = state();
        s.preview_text.is_some() && (!s.requires_player_selection || s.selected_player_id.is_some())
    });

    let selected_category = use_memo(move || state().selected_category.clone());
    let requires_player = use_memo(move || state().requires_player_selection);
    let has_selected_player = use_memo(move || state().selected_player_id.is_some());

    // Preview text computation
    let preview_display = use_memo(move || {
        let s = state();
        if let Some(preview) = s.preview_text.clone() {
            phrase_translations()
                .get(&preview)
                .cloned()
                .unwrap_or(preview)
        } else {
            translations().build.clone()
        }
    });

    // Filter and sort players
    let filtered_players = use_memo(move || {
        let search_query = state().player_search_query.clone();
        let mut players: Vec<_> = players()
            .iter()
            .filter(|p| p.name.to_lowercase().contains(&search_query))
            .cloned()
            .collect();
        players.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        players
    });

    let other_players = use_memo(move || {
        let search_query = state().player_search_query.clone();
        let mut players: Vec<_> = players()
            .iter()
            .filter(|p| !p.name.to_lowercase().contains(&search_query))
            .cloned()
            .collect();
        players.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        players
    });

    // Get current category phrases
    let current_phrases = use_memo(move || {
        let cat = selected_category();
        let phrases = quick_chat_phrases();
        if let Some(category) = cat {
            phrases.get(&category).cloned().unwrap_or_default()
        } else {
            Vec::new()
        }
    });

    // Player search query value
    let player_search_value = use_memo(move || state().player_search_query.clone());

    if !is_open() {
        return rsx! {};
    }

    rsx! {
        div {
            class: "absolute inset-0 z-1200 flex items-center justify-center p-4",

            // Backdrop
            div {
                class: "absolute inset-0 bg-black/60 rounded-2xl",
                onclick: on_backdrop_click,
            }

            // Modal content
            div {
                role: "dialog",
                aria_modal: "true",
                aria_labelledby: "chat-title",
                class: "relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-zinc-800 text-white",
                tabindex: "0",
                onclick: move |e: MouseEvent| e.stop_propagation(),

                // Header with close button
                div {
                    class: "flex items-center justify-between p-4 border-b border-zinc-700",

                    h2 {
                        id: "chat-title",
                        class: "text-lg font-semibold text-zinc-100",
                        "{translations().title}"
                    }

                    button {
                        r#type: "button",
                        class: "text-zinc-400 hover:text-white text-2xl font-bold leading-none px-2",
                        aria_label: "{translations().close}",
                        onclick: on_close,
                        "×"
                    }
                }

                // Chat columns (category, phrase, player)
                div {
                    class: "flex gap-4 p-4 overflow-x-auto chat-columns",

                    // Category column
                    div {
                        class: "flex flex-col gap-2 min-w-[140px] chat-column",
                        div {
                            class: "font-bold text-zinc-300 mb-1 column-title",
                            "{translations().category}"
                        }
                        for category in categories.iter() {
                            {
                                let selected_cat_value = selected_category();
                                let is_selected = selected_cat_value.as_ref();
                                let selected_class = if is_selected == Some(&category.id) { " selected" } else { "" };
                                let display_name = get_category_name(&category.id, &translations());
                                let category_id = category.id.clone();
                                let mut select_cat = select_category.clone();

                                rsx! {
                                    button {
                                        class: "chat-option-button{selected_class}",
                                        onclick: move |_| select_cat(category_id.clone()),
                                        "{display_name}"
                                    }
                                }
                            }
                        }
                    }

                    // Phrase column (shown when category is selected)
                    if selected_category().is_some() {
                        div {
                            class: "flex flex-col gap-2 min-w-[140px] chat-column",
                            div {
                                class: "font-bold text-zinc-300 mb-1 column-title",
                                "{translations().phrase}"
                            }
                            div {
                                class: "max-h-[280px] overflow-y-auto flex flex-col gap-1.5 pr-1 phrase-scroll-area",
                                for phrase in current_phrases().iter() {
                                    {
                                        let cat_id = selected_category().clone().unwrap_or_default();
                                        let phrase_key = format!("chat.{}.{}", cat_id, phrase.key);
                                        let translated = phrase_translations_clone()
                                            .get(&phrase_key)
                                            .cloned()
                                            .unwrap_or_else(|| phrase_key.clone());
                                        let ph = phrase.clone();
                                        let cat_id_clone = cat_id.clone();
                                        let mut select_ph = select_phrase.clone();
                                        let is_selected = state().selected_phrase_text.as_ref() == Some(&translated);
                                        let selected_class = if is_selected { " selected" } else { "" };

                                        rsx! {
                                            button {
                                                class: "chat-option-button{selected_class}",
                                                onclick: move |_| select_ph(cat_id_clone.clone(), ph.clone()),
                                                "{translated}"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Player column (shown when phrase requires player or player is selected)
                    if requires_player() || has_selected_player() {
                        div {
                            class: "flex flex-col gap-2 min-w-[140px] chat-column",
                            div {
                                class: "font-bold text-zinc-300 mb-1 column-title",
                                "{translations().player}"
                            }
                            input {
                                class: "player-search-input",
                                r#type: "text",
                                placeholder: "{translations().search}",
                                value: "{player_search_value()}",
                                oninput: on_player_search
                            }
                            div {
                                class: "max-h-[240px] overflow-y-auto flex flex-col gap-1.5 pr-1 mt-2 player-scroll-area",
                                for player in filtered_players().iter().chain(other_players().iter()) {
                                    {
                                        let p = player.clone();
                                        let mut select_pl = select_player.clone();
                                        let is_selected = state().selected_player_id.as_ref() == Some(&p.id);
                                        let selected_class = if is_selected { " selected" } else { "" };

                                        rsx! {
                                            button {
                                                class: "chat-option-button{selected_class}",
                                                onclick: move |_| select_pl(p.id.clone(), p.name.clone()),
                                                "{p.name}"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Preview area
                div {
                    class: "chat-preview",
                    style: "margin: 10px 12px; padding: 10px; background: #222; color: white; border-radius: 6px; text-align: center;",
                    "{preview_display()}"
                }

                // Send button
                div {
                    class: "chat-send",
                    style: "display: flex; justify-content: flex-end; padding: 0 12px 12px;",
                    button {
                        class: "chat-send-button",
                        disabled: !can_send(),
                        onclick: on_send,
                        style: if can_send() {
                            "background: #4caf50; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;"
                        } else {
                            "background: #666; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: not-allowed;"
                        },
                        "{translations().send}"
                    }
                }
            }
        }
    }
}

/// Reset modal state to default
fn reset_modal_state(state: &mut Signal<ChatModalState>) {
    state.write().selected_category = None;
    state.write().selected_phrase_text = None;
    state.write().selected_phrase_template = None;
    state.write().selected_quick_chat_key = None;
    state.write().preview_text = None;
    state.write().requires_player_selection = false;
    state.write().player_search_query = String::new();
    state.write().selected_player_id = None;
}

/// Emit a modal close event
fn emit_modal_close() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_CHAT_MODAL_CLOSE_REQUEST),
        Some("component.chat-modal"),
        json!({}),
    );
}

/// Emit a send chat event
fn emit_send_chat_event(quick_chat_key: &str, selected_player_id: &Option<String>, message: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_CHAT_MODAL_SEND),
        Some("component.chat-modal"),
        json!({
            "quickChatKey": quick_chat_key,
            "selectedPlayerId": selected_player_id,
            "message": message,
        }),
    );
}

// Thread-local storage for initial state passing from launch functions
thread_local! {
    static INITIAL_STATE: RefCell<Option<(ChatModalState, Vec<ChatPlayer>, QuickChatPhrases, ChatModalTranslations, HashMap<String, String>)>> =
        const { RefCell::new(None) };
    static STATE_SIGNAL: RefCell<Option<Signal<ChatModalState>>> =
        const { RefCell::new(None) };
    static PLAYERS_SIGNAL: RefCell<Option<Signal<Vec<ChatPlayer>>>> =
        const { RefCell::new(None) };
}

/// Store initial state for the chat modal
pub fn set_initial_state(
    state: ChatModalState,
    players: Vec<ChatPlayer>,
    quick_chat_phrases: QuickChatPhrases,
    translations: ChatModalTranslations,
    phrase_translations: HashMap<String, String>,
) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((
            state,
            players,
            quick_chat_phrases,
            translations,
            phrase_translations,
        ));
    });
}

/// Take the initial state (used by ChatModalRoot)
pub fn take_initial_state() -> (
    ChatModalState,
    Vec<ChatPlayer>,
    QuickChatPhrases,
    ChatModalTranslations,
    HashMap<String, String>,
) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                ChatModalState::default(),
                Vec::new(),
                HashMap::new(),
                ChatModalTranslations::default(),
                HashMap::new(),
            )
        })
    })
}

/// Store the state signal for external WASM updates
pub fn store_state_signal(signal: Signal<ChatModalState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

/// Store the players signal for external WASM updates
pub fn store_players_signal(signal: Signal<Vec<ChatPlayer>>) {
    PLAYERS_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

pub use store_players_signal as chat_modal_store_players_signal;
/// Export for provider to use
pub use store_state_signal as chat_modal_store_state_signal;
pub use take_initial_state as chat_modal_take_initial_state;

/// Launch the chat modal with provided configuration
///
/// This function is called from TypeScript to initialize and launch the modal.
/// It stores the initial state in thread-local storage for the root component to consume.
pub fn launch_chat_modal(
    state_json: &str,
    players_json: &str,
    quick_chat_phrases_json: &str,
    translations_json: &str,
    phrase_translations_json: &str,
) {
    let state: ChatModalState = serde_json::from_str(state_json).unwrap_or_default();
    let players: Vec<ChatPlayer> = serde_json::from_str(players_json).unwrap_or_default();
    let quick_chat_phrases: QuickChatPhrases =
        serde_json::from_str(quick_chat_phrases_json).unwrap_or_default();
    let translations: ChatModalTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();
    let phrase_translations: HashMap<String, String> =
        serde_json::from_str(phrase_translations_json).unwrap_or_default();

    log::info!("Launching chat modal");
    log::debug!("State: {:?}", state);
    log::debug!("Players: {:?}", players);

    // Store initial state in thread-local storage for ChatModalRoot to consume
    set_initial_state(
        state,
        players,
        quick_chat_phrases,
        translations,
        phrase_translations,
    );

    let config = dioxus::web::Config::new().rootname("dioxus-chat-modal-root");

    // Launch the root component which will create the provider and context
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(crate::providers::ChatModalRoot);
}

/// Open the modal (can be called after initial launch)
pub fn open_chat_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.write().is_open = true;
            *s.borrow_mut() = Some(signal);
        }
    });
}

/// Close the modal (can be called after initial launch)
pub fn close_chat_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.write().is_open = false;
            *s.borrow_mut() = Some(signal);
        }
    });
}

/// Update the players list
pub fn update_chat_modal_players(players_json: &str) {
    let players: Vec<ChatPlayer> = serde_json::from_str(players_json).unwrap_or_default();
    PLAYERS_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.set(players);
            *s.borrow_mut() = Some(signal);
        }
    });
}

/// Open the modal with a specific category and phrase pre-selected
pub fn open_chat_modal_with_selection(category_id: &str, phrase_key: &str) {
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.write().is_open = true;
            signal.write().selected_category = Some(category_id.to_string());
            signal.write().selected_quick_chat_key =
                Some(format!("{}.{}", category_id, phrase_key));
            signal.write().preview_text = Some(format!("chat.{}.{}", category_id, phrase_key));
            *s.borrow_mut() = Some(signal);
        }
    });
}
