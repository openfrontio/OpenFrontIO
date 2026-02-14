//! Player Moderation Modal component
//!
//! A modal for player moderation actions (kick, etc.)

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cell::RefCell;

use crate::runtime::emit_ui_event;
use crate::runtime_protocol::{event_keys, event_name};

/// Register the player moderation modal web component
pub fn register() {
    log::debug!("Registered <player-moderation-modal> component");
}

/// Player moderation state received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerModerationModalState {
    pub is_open: bool,
    pub already_kicked: bool,
}

/// Player information for the target player
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TargetPlayer {
    pub id: String,
    pub name: String,
    pub player_type: String,
    pub client_id: Option<String>,
    pub is_lobby_creator: bool,
}

/// Current player information
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MyPlayer {
    pub id: String,
    pub is_lobby_creator: bool,
}

/// Translations received from TypeScript
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerModerationTranslations {
    pub moderation: String,
    pub kick: String,
    pub kicked: String,
    pub close: String,
    pub kick_confirm: String,
}

/// Modal props
#[derive(Props, Clone, PartialEq)]
pub struct PlayerModerationModalProps {
    pub state: PlayerModerationModalState,
    pub my_player: MyPlayer,
    pub target_player: TargetPlayer,
    pub translations: PlayerModerationTranslations,
    pub kick_icon: String,
    pub shield_icon: String,
}

/// Player Moderation Modal component
///
/// This component provides player moderation functionality:
/// - Kick player (if current user is lobby creator)
/// - Shows player information
/// - ESC key and backdrop click to close
#[component]
pub fn PlayerModerationModal(props: PlayerModerationModalProps) -> Element {
    // Try to get the context first (preferred way)
    let has_context = try_use_context::<crate::contexts::PlayerModerationContext>().is_some();

    if has_context {
        let context = use_context::<crate::contexts::PlayerModerationContext>();
        render_player_moderation_modal_with_context(context)
    } else {
        // Fallback: render with props (for standalone usage without context)
        render_player_moderation_modal_with_props(props)
    }
}

/// Render the player moderation modal using context state
fn render_player_moderation_modal_with_context(
    context: crate::contexts::PlayerModerationContext,
) -> Element {
    let mut state = context.state;
    let my_player = context.my_player;
    let target_player = context.target_player;
    let translations = context.translations;
    let kick_icon = context.kick_icon;
    let shield_icon = context.shield_icon;

    let can_kick = my_player().is_lobby_creator
        && my_player().id != target_player().id
        && target_player().player_type == "HUMAN"
        && target_player().client_id.is_some()
        && !target_player()
            .client_id
            .as_ref()
            .map_or(true, |s| s.is_empty());

    // Close handler
    let on_close = move |_| {
        state.write().is_open = false;
        emit_modal_close();
    };

    // Handle backdrop click
    let on_backdrop_click = move |_| {
        state.write().is_open = false;
        emit_modal_close();
    };

    // Kick handler
    let target_id = target_player().id.clone();
    let target_name = target_player().name.clone();
    let kick_confirm_msg = translations().kick_confirm.clone();

    let on_kick = {
        move |evt: MouseEvent| {
            evt.stop_propagation();

            if !can_kick || state().already_kicked {
                return;
            }

            // Emit kick event with player info for confirmation
            emit_kick_event(&target_id, &target_name, &kick_confirm_msg);
        }
    };

    let kick_title = if state().already_kicked {
        translations().kicked.clone()
    } else {
        translations().kick.clone()
    };

    if !state().is_open {
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
                aria_labelledby: "moderation-title",
                class: "relative z-10 w-full max-w-120 focus:outline-hidden",
                tabindex: "0",
                onclick: move |e: MouseEvent| e.stop_propagation(),

                div {
                    class: "rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200",
                    onclick: move |e: MouseEvent| e.stop_propagation(),

                    // Header with close button
                    div {
                        class: "mb-3 flex items-center justify-between relative",

                        div {
                            class: "flex items-center gap-2",
                            img {
                                src: "{shield_icon}",
                                alt: "",
                                aria_hidden: "true",
                                class: "h-5 w-5",
                                width: "20",
                                height: "20"
                            }
                            h2 {
                                id: "moderation-title",
                                class: "text-lg font-semibold tracking-tight text-zinc-100",
                                "{translations().moderation}"
                            }
                        }

                        button {
                            r#type: "button",
                            class: "absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus:outline-hidden",
                            aria_label: "{translations().close}",
                            title: "{translations().close}",
                            onclick: on_close,
                            "✕"
                        }
                    }

                    // Target player info
                    div {
                        class: "mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2",
                        div {
                            class: "text-sm font-semibold text-zinc-100 truncate",
                            title: "{target_player().name}",
                            "{target_player().name}"
                        }
                    }

                    // Action buttons
                    div {
                        class: "grid auto-cols-fr grid-flow-col gap-1",
                        button {
                            class: if can_kick && !state().already_kicked {
                                "flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            } else {
                                "flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600/50 px-3 text-sm font-semibold text-white/50 shadow-sm transition-colors cursor-not-allowed"
                            },
                            onclick: on_kick,
                            disabled: !can_kick || state().already_kicked,

                            img {
                                src: "{kick_icon}",
                                alt: "kick",
                                width: "16",
                                height: "16",
                                class: "h-4 w-4"
                            }
                            span { "{kick_title}" }
                        }
                    }
                }
            }
        }
    }
}

/// Render the player moderation modal using props (fallback for non-context usage)
fn render_player_moderation_modal_with_props(props: PlayerModerationModalProps) -> Element {
    let mut state = use_signal(|| props.state.clone());
    let my_player = props.my_player.clone();
    let target_player = props.target_player.clone();
    let translations = props.translations.clone();
    let kick_icon = props.kick_icon.clone();
    let shield_icon = props.shield_icon.clone();

    // Store the state signal for external updates
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(state);
    });

    let can_kick = my_player.is_lobby_creator
        && my_player.id != target_player.id
        && target_player.player_type == "HUMAN"
        && target_player.client_id.is_some()
        && !target_player
            .client_id
            .as_ref()
            .map_or(true, |s| s.is_empty());

    // Close handler
    let on_close = move |_| {
        state.write().is_open = false;
        emit_modal_close();
    };

    // Handle backdrop click
    let on_backdrop_click = move |_| {
        state.write().is_open = false;
        emit_modal_close();
    };

    // Kick handler
    let target_id = target_player.id.clone();
    let target_name = target_player.name.clone();
    let kick_confirm_msg = translations.kick_confirm.clone();

    let on_kick = {
        move |evt: MouseEvent| {
            evt.stop_propagation();

            if !can_kick || state().already_kicked {
                return;
            }

            emit_kick_event(&target_id, &target_name, &kick_confirm_msg);
        }
    };

    let kick_title = if state().already_kicked {
        translations.kicked.clone()
    } else {
        translations.kick.clone()
    };

    if !state().is_open {
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
                aria_labelledby: "moderation-title",
                class: "relative z-10 w-full max-w-120 focus:outline-hidden",
                tabindex: "0",
                onclick: move |e: MouseEvent| e.stop_propagation(),

                div {
                    class: "rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200",
                    onclick: move |e: MouseEvent| e.stop_propagation(),

                    // Header with close button
                    div {
                        class: "mb-3 flex items-center justify-between relative",

                        div {
                            class: "flex items-center gap-2",
                            img {
                                src: "{shield_icon}",
                                alt: "",
                                aria_hidden: "true",
                                class: "h-5 w-5",
                                width: "20",
                                height: "20"
                            }
                            h2 {
                                id: "moderation-title",
                                class: "text-lg font-semibold tracking-tight text-zinc-100",
                                "{translations.moderation}"
                            }
                        }

                        button {
                            r#type: "button",
                            class: "absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus:outline-hidden",
                            aria_label: "{translations.close}",
                            title: "{translations.close}",
                            onclick: on_close,
                            "✕"
                        }
                    }

                    // Target player info
                    div {
                        class: "mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2",
                        div {
                            class: "text-sm font-semibold text-zinc-100 truncate",
                            title: "{target_player.name}",
                            "{target_player.name}"
                        }
                    }

                    // Action buttons
                    div {
                        class: "grid auto-cols-fr grid-flow-col gap-1",
                        button {
                            class: if can_kick && !state().already_kicked {
                                "flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            } else {
                                "flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600/50 px-3 text-sm font-semibold text-white/50 shadow-sm transition-colors cursor-not-allowed"
                            },
                            onclick: on_kick,
                            disabled: !can_kick || state().already_kicked,

                            img {
                                src: "{kick_icon}",
                                alt: "kick",
                                width: "16",
                                height: "16",
                                class: "h-4 w-4"
                            }
                            span { "{kick_title}" }
                        }
                    }
                }
            }
        }
    }
}

/// Emit a modal close event
fn emit_modal_close() {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_PLAYER_MODERATION_CLOSE_REQUEST),
        Some("component.player-moderation-modal"),
        json!({}),
    );
}

/// Emit a kick event
fn emit_kick_event(player_id: &str, player_name: &str, confirm_message: &str) {
    emit_ui_event(
        event_name(event_keys::UI_INGAME_PLAYER_MODERATION_KICK),
        Some("component.player-moderation-modal"),
        json!({
            "playerId": player_id,
            "playerName": player_name,
            "confirmMessage": confirm_message,
        }),
    );
}

// Thread-local storage for initial state passing from launch functions
thread_local! {
    static INITIAL_STATE: RefCell<Option<(PlayerModerationModalState, MyPlayer, TargetPlayer, PlayerModerationTranslations, String, String)>> =
        const { RefCell::new(None) };
    static STATE_SIGNAL: RefCell<Option<Signal<PlayerModerationModalState>>> =
        const { RefCell::new(None) };
}

/// Store initial state for the player moderation modal
pub fn set_initial_state(
    state: PlayerModerationModalState,
    my_player: MyPlayer,
    target_player: TargetPlayer,
    translations: PlayerModerationTranslations,
    kick_icon: String,
    shield_icon: String,
) {
    INITIAL_STATE.with(|s| {
        *s.borrow_mut() = Some((
            state,
            my_player,
            target_player,
            translations,
            kick_icon,
            shield_icon,
        ));
    });
}

/// Take the initial state (used by PlayerModerationRoot)
pub fn take_initial_state() -> (
    PlayerModerationModalState,
    MyPlayer,
    TargetPlayer,
    PlayerModerationTranslations,
    String,
    String,
) {
    INITIAL_STATE.with(|s| {
        s.borrow_mut().take().unwrap_or_else(|| {
            (
                PlayerModerationModalState::default(),
                MyPlayer::default(),
                TargetPlayer::default(),
                PlayerModerationTranslations::default(),
                String::new(),
                String::new(),
            )
        })
    })
}

/// Store the state signal for external WASM updates
pub fn store_state_signal(signal: Signal<PlayerModerationModalState>) {
    STATE_SIGNAL.with(|s| {
        *s.borrow_mut() = Some(signal);
    });
}

/// Export for provider to use
pub use store_state_signal as player_moderation_store_state_signal;
pub use take_initial_state as player_moderation_take_initial_state;

/// Launch the player moderation modal with provided configuration
///
/// This function is called from TypeScript to initialize and launch the modal.
/// It stores the initial state in thread-local storage for the root component to consume.
pub fn launch_player_moderation_modal(
    state_json: &str,
    my_player_json: &str,
    target_player_json: &str,
    translations_json: &str,
    kick_icon: &str,
    shield_icon: &str,
) {
    let state: PlayerModerationModalState = serde_json::from_str(state_json).unwrap_or_default();
    let my_player: MyPlayer = serde_json::from_str(my_player_json).unwrap_or_default();
    let target_player: TargetPlayer = serde_json::from_str(target_player_json).unwrap_or_default();
    let translations: PlayerModerationTranslations =
        serde_json::from_str(translations_json).unwrap_or_default();

    log::info!("Launching player moderation modal");
    log::debug!("State: {:?}", state);
    log::debug!("Target player: {:?}", target_player);

    // Store initial state in thread-local storage for PlayerModerationRoot to consume
    set_initial_state(
        state,
        my_player,
        target_player,
        translations,
        kick_icon.to_string(),
        shield_icon.to_string(),
    );

    let config = dioxus::web::Config::new().rootname("dioxus-player-moderation-modal-root");

    // Launch the root component which will create the provider and context
    dioxus::LaunchBuilder::new()
        .with_cfg(config)
        .launch(crate::providers::PlayerModerationRoot);
}

/// Open the modal (can be called after initial launch)
pub fn open_player_moderation_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.write().is_open = true;
            *s.borrow_mut() = Some(signal);
        }
    });
}

/// Close the modal (can be called after initial launch)
pub fn close_player_moderation_modal() {
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.write().is_open = false;
            *s.borrow_mut() = Some(signal);
        }
    });
}

/// Update the already kicked state
pub fn update_player_moderation_already_kicked(already_kicked: bool) {
    STATE_SIGNAL.with(|s| {
        if let Some(mut signal) = s.borrow_mut().take() {
            signal.write().already_kicked = already_kicked;
            *s.borrow_mut() = Some(signal);
        }
    });
}
