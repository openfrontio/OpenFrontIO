//! UI Components module
//!
//! This module contains all Dioxus UI components that are exposed as Web Components.

mod build_menu;
mod chat_modal;
mod flag_input_modal;
mod game_starting_modal;
mod hello_world;
mod language_modal;
mod leaderboard;
mod multi_tab_modal;
mod player_moderation_modal;
mod radial_menu;
mod send_resource_modal;
mod settings_modal;
mod team_stats;
mod win_modal;

// Wave 1: Simple HUD layers
mod alert_frame;
mod heads_up_message;
mod immunity_timer;
mod spawn_timer;

// Wave 2: Game Control layers
mod control_panel;
mod emoji_table;
mod game_left_sidebar;
mod game_right_sidebar;
mod replay_panel;
mod unit_display;

// Wave 3: Complex Game layers
mod chat_display;
mod events_display;
mod performance_overlay;
mod player_info_overlay;
mod player_panel;

// Wave 4: Input Components
mod flag_input;
mod lang_selector;
mod pattern_input;
mod username_input;

// Wave 5: Simple Lobby Modals
mod account_modal;
mod help_modal;
mod join_private_lobby_modal;
mod news_modal;
mod token_login_modal;

// Wave 6: Medium Lobby Modals
mod game_info_modal;
mod matchmaking;
mod stats_modal;
mod territory_patterns_modal;
mod user_setting_modal;

// Wave 7: Complex Lobby Modals
mod host_lobby_modal;
mod public_lobby;
pub mod single_player_modal;

// Wave 8: Layout & Navigation
mod desktop_nav_bar;
mod footer;
mod main_layout;
mod mobile_nav_bar;
mod modal_overlay;
mod play_page;

// Re-export components and their props
pub use chat_modal::{
    chat_modal_store_players_signal, chat_modal_store_state_signal, chat_modal_take_initial_state,
    close_chat_modal, launch_chat_modal, open_chat_modal, open_chat_modal_with_selection,
    update_chat_modal_players, ChatCategory, ChatModal as ChatModalComponent, ChatModalProps,
    ChatModalState, ChatModalTranslations, ChatPlayer, QuickChatPhrase, QuickChatPhrases,
};
pub use flag_input_modal::{
    close_flag_input_modal, launch_flag_input_modal, open_flag_input_modal, CountryOption,
    FlagInputModal, FlagInputModalProps, FlagInputModalTranslations,
};
pub use game_starting_modal::{
    hide_game_starting_modal, launch_game_starting_modal, show_game_starting_modal,
    GameStartingModal, GameStartingModalProps, GameStartingModalTranslations,
};
pub use hello_world::{launch_hello_world, HelloWorld, HelloWorldProps};
pub use language_modal::{
    close_language_modal, launch_language_modal, open_language_modal, LanguageModal,
    LanguageModalProps, LanguageModalTranslations, LanguageOption,
};
pub use leaderboard::{
    launch_leaderboard,
    // Helper functions for providers
    store_entries_signal as leaderboard_store_entries_signal,
    take_initial_state as leaderboard_take_initial_state,
    update_leaderboard_entries,
    Leaderboard,
    LeaderboardEntry,
    LeaderboardProps,
    LeaderboardTranslations,
    SortKey,
    SortOrder,
};
pub use multi_tab_modal::{
    hide_multi_tab_modal, launch_multi_tab_modal, show_multi_tab_modal, MultiTabModal,
    MultiTabModalProps, MultiTabTranslations,
};
pub use player_moderation_modal::{
    close_player_moderation_modal,
    launch_player_moderation_modal,
    open_player_moderation_modal,
    // Helper functions for providers
    player_moderation_store_state_signal,
    player_moderation_take_initial_state,
    update_player_moderation_already_kicked,
    MyPlayer,
    PlayerModerationModal,
    PlayerModerationModalProps,
    PlayerModerationModalState,
    PlayerModerationTranslations,
    TargetPlayer,
};
pub use settings_modal::{
    launch_full_settings_modal,
    launch_settings_modal,
    // Helper functions for providers
    settings_store_settings_signal,
    settings_take_initial_state,
    FullSettingsModal,
    FullSettingsModalProps,
    GameSettings,
    GraphicsQuality,
    Icons,
    SettingsModal,
    SettingsModalProps,
    SettingsState,
    Translations,
};
pub use team_stats::{
    launch_team_stats,
    // Types needed by context
    set_initial_state as team_stats_set_initial_state,
    // Helper functions for providers
    store_entries_signal as team_stats_store_entries_signal,
    take_initial_state as team_stats_take_initial_state,
    update_team_stats_entries,
    TeamStats,
    TeamStatsEntry,
    TeamStatsProps,
    TeamStatsTranslations,
};
pub use win_modal::{
    hide_win_modal,
    launch_win_modal,
    show_win_modal,
    update_win_modal_cosmetics,
    // Types for serialization
    ColorPaletteInfo,
    CosmeticsData,
    PatternInfo,
    ProductInfo,
    PurchasablePattern,
    WinModal,
    WinModalContentType,
    WinModalProps,
    WinModalState,
    WinModalTranslations,
};

pub use build_menu::{
    hide_build_menu, launch_build_menu, show_build_menu, update_build_menu_items,
    BuildMenu as BuildMenuComponent, BuildMenuItemState, BuildMenuProps, BuildMenuTranslations,
};
pub use radial_menu::{
    hide_radial_menu, launch_radial_menu, pop_submenu, push_submenu, show_radial_menu,
    update_center_button, update_radial_items, RadialMenu as RadialMenuComponent,
    RadialMenuCenterButton, RadialMenuConfig, RadialMenuItem, RadialMenuProps,
};
pub use send_resource_modal::{
    hide_send_resource_modal, launch_send_resource_modal, show_send_resource_modal,
    update_send_resource_total, ResourceMode, SendResourceModal as SendResourceModalComponent,
    SendResourceModalData, SendResourceModalProps, SendResourceModalState,
    SendResourceTranslations,
};

// Wave 1: Simple HUD layers
pub use alert_frame::{hide_alert_frame, launch_alert_frame, show_alert_frame};
pub use heads_up_message::{
    hide_heads_up_toast, launch_heads_up_message, show_heads_up_toast, update_heads_up_message,
};
pub use immunity_timer::{
    hide_immunity_timer, launch_immunity_timer, show_immunity_timer, update_immunity_timer,
};
pub use spawn_timer::{hide_spawn_timer, launch_spawn_timer, show_spawn_timer, update_spawn_timer};

// Wave 2: Game Control layers
pub use control_panel::{launch_control_panel, update_control_panel};
pub use emoji_table::{hide_emoji_table, launch_emoji_table, show_emoji_table};
pub use game_left_sidebar::{launch_game_left_sidebar, update_game_left_sidebar};
pub use game_right_sidebar::{launch_game_right_sidebar, update_game_right_sidebar};
pub use replay_panel::{launch_replay_panel, update_replay_panel};
pub use unit_display::{launch_unit_display, update_unit_display};

// Wave 3: Complex Game layers
pub use chat_display::{launch_chat_display, update_chat_display};
pub use events_display::{launch_events_display, update_events_display};
pub use performance_overlay::{launch_performance_overlay, update_performance_overlay};
pub use player_info_overlay::{launch_player_info_overlay, update_player_info_overlay};
pub use player_panel::{launch_player_panel, update_player_panel};

// Wave 4: Input components
pub use flag_input::{
    launch_flag_input, update_flag_input, update_flag_input_show_select_label,
    update_flag_input_translations,
};
pub use lang_selector::{
    hide_lang_selector, launch_lang_selector, show_lang_selector, update_lang_selector_flag,
};
pub use pattern_input::{
    launch_pattern_input, update_pattern_input_loading, update_pattern_input_preview,
    update_pattern_input_show_select_label, update_pattern_input_translations,
};
pub use username_input::{
    launch_username_input, update_username_input_clan_tag, update_username_input_translations,
    update_username_input_username, update_username_input_validation_error,
};

// Wave 5: Simple Lobby modals
pub use account_modal::{
    close_account_modal, launch_account_modal, open_account_modal, update_account_modal_content,
    update_account_modal_header_right, update_account_modal_loading,
};
pub use help_modal::{
    close_help_modal, launch_help_modal, open_help_modal, update_help_modal_content,
};
pub use join_private_lobby_modal::{
    close_join_private_lobby_modal, launch_join_private_lobby_modal, open_join_private_lobby_modal,
    update_join_private_lobby_config_html, update_join_private_lobby_id,
    update_join_private_lobby_joined, update_join_private_lobby_players_html,
};
pub use news_modal::{
    close_news_modal, launch_news_modal, open_news_modal, update_news_modal_content,
};
pub use token_login_modal::{
    close_token_login_modal, launch_token_login_modal, open_token_login_modal,
    update_token_login_email,
};

// Wave 6: Medium Lobby modals
pub use game_info_modal::{
    hide_game_info_modal, launch_game_info_modal, show_game_info_modal, update_game_info_modal,
};
pub use matchmaking::{
    hide_matchmaking_modal, launch_matchmaking_modal, show_matchmaking_modal,
    update_matchmaking_state,
};
pub use stats_modal::{hide_stats_modal, launch_stats_modal, show_stats_modal, update_stats_modal};
pub use territory_patterns_modal::{
    hide_territory_patterns_modal, launch_territory_patterns_modal, show_territory_patterns_modal,
    update_territory_patterns_modal,
};
pub use user_setting_modal::{
    hide_user_setting_modal, launch_user_setting_modal, show_user_setting_modal,
    update_user_setting_modal,
};

// Wave 7: Complex Lobby modals
pub use host_lobby_modal::{
    hide_host_lobby_modal, launch_host_lobby_modal, show_host_lobby_modal,
    update_host_lobby_players,
};
pub use public_lobby::{
    launch_public_lobby, update_public_lobby_data, update_public_lobby_joining,
};
pub use single_player_modal::{
    hide_single_player_modal, launch_single_player_modal, show_single_player_modal,
    update_single_player_achievements, update_single_player_form,
};

// Wave 8: Layout & navigation
pub use desktop_nav_bar::{launch_desktop_nav_bar, update_desktop_nav_bar};
pub use footer::{launch_footer, update_footer};
pub use main_layout::{launch_main_layout, update_main_layout};
pub use mobile_nav_bar::{launch_mobile_nav_bar, update_mobile_nav_bar};
pub use modal_overlay::{hide_modal_overlay, launch_modal_overlay, show_modal_overlay};
pub use play_page::{launch_play_page, update_play_page};

/// Register all web components
///
/// This function is called during initialization to register all custom elements
/// with the browser's CustomElementRegistry.
pub fn register_all() {
    log::debug!("Registering Dioxus web components...");

    // Register hello-world component (proof of concept)
    hello_world::register();

    // Register settings modal component
    settings_modal::register();

    // Register leaderboard component
    leaderboard::register();

    // Register team stats component
    team_stats::register();

    // Register game starting modal component
    game_starting_modal::register();

    // Register language modal component
    language_modal::register();

    // Register flag input modal component
    flag_input_modal::register();

    // Register multi-tab modal component
    multi_tab_modal::register();

    // Register player moderation modal component
    player_moderation_modal::register();

    // Register win modal component
    win_modal::register();

    // Register chat modal component
    chat_modal::register();

    // Register send resource modal component
    send_resource_modal::register();

    // Register build menu component
    build_menu::register();

    // Register radial menu component
    radial_menu::register();

    // Wave 1: Simple HUD layers
    spawn_timer::register();
    immunity_timer::register();
    heads_up_message::register();
    alert_frame::register();

    // Wave 2: Game Control layers
    control_panel::register();
    emoji_table::register();
    unit_display::register();
    replay_panel::register();
    game_right_sidebar::register();
    game_left_sidebar::register();

    // Wave 3: Complex Game layers
    chat_display::register();
    events_display::register();
    performance_overlay::register();
    player_info_overlay::register();
    player_panel::register();

    // Wave 4: Input components
    flag_input::register();
    pattern_input::register();
    username_input::register();
    lang_selector::register();

    // Wave 5: Simple Lobby modals
    join_private_lobby_modal::register();
    token_login_modal::register();
    help_modal::register();
    news_modal::register();
    account_modal::register();

    // Wave 6: Medium Lobby modals
    game_info_modal::register();
    matchmaking::register();
    stats_modal::register();
    territory_patterns_modal::register();
    user_setting_modal::register();

    // Wave 7: Complex Lobby modals
    single_player_modal::register();
    host_lobby_modal::register();
    public_lobby::register();

    // Wave 8: Layout & navigation
    play_page::register();
    desktop_nav_bar::register();
    mobile_nav_bar::register();
    main_layout::register();
    footer::register();
    modal_overlay::register();

    log::info!("All Dioxus web components registered");
}
