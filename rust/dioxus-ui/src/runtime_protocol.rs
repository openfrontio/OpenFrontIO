use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

const PROTOCOL_MANIFEST_JSON: &str = include_str!("../../../protocol/ui_runtime_protocol.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PayloadFieldType {
    String,
    Number,
    Boolean,
    Object,
    Array,
    StringOrNull,
    NumberOrNull,
    BooleanOrNull,
    Any,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PayloadFieldSpec {
    #[serde(rename = "type")]
    pub field_type: PayloadFieldType,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageSpec {
    pub name: String,
    #[serde(default)]
    pub payload: HashMap<String, PayloadFieldSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProtocolManifest {
    pub version: u32,
    #[serde(default)]
    pub actions: HashMap<String, MessageSpec>,
    #[serde(default)]
    pub events: HashMap<String, MessageSpec>,
    #[serde(default)]
    pub snapshots: HashMap<String, MessageSpec>,
}

struct ProtocolIndex {
    manifest: ProtocolManifest,
    action_by_name: HashMap<String, MessageSpec>,
    event_by_name: HashMap<String, MessageSpec>,
    snapshot_by_name: HashMap<String, MessageSpec>,
}

static PROTOCOL_INDEX: OnceLock<ProtocolIndex> = OnceLock::new();

fn build_protocol_index() -> ProtocolIndex {
    let manifest: ProtocolManifest =
        serde_json::from_str(PROTOCOL_MANIFEST_JSON).expect("invalid ui runtime protocol manifest");

    let mut action_by_name = HashMap::new();
    for spec in manifest.actions.values() {
        action_by_name.insert(spec.name.clone(), spec.clone());
    }

    let mut event_by_name = HashMap::new();
    for spec in manifest.events.values() {
        event_by_name.insert(spec.name.clone(), spec.clone());
    }

    let mut snapshot_by_name = HashMap::new();
    for spec in manifest.snapshots.values() {
        snapshot_by_name.insert(spec.name.clone(), spec.clone());
    }

    ProtocolIndex {
        manifest,
        action_by_name,
        event_by_name,
        snapshot_by_name,
    }
}

fn protocol_index() -> &'static ProtocolIndex {
    PROTOCOL_INDEX.get_or_init(build_protocol_index)
}

fn message_name<'a>(
    group: &'a HashMap<String, MessageSpec>,
    key: &str,
    group_name: &str,
) -> &'a str {
    group
        .get(key)
        .map(|spec| spec.name.as_str())
        .unwrap_or_else(|| panic!("missing runtime protocol {group_name} key: {key}"))
}

fn validate_field_type(value: &Value, expected: &PayloadFieldType) -> bool {
    match expected {
        PayloadFieldType::String => value.as_str().is_some(),
        PayloadFieldType::Number => value.as_f64().is_some(),
        PayloadFieldType::Boolean => value.as_bool().is_some(),
        PayloadFieldType::Object => value.as_object().is_some(),
        PayloadFieldType::Array => value.as_array().is_some(),
        PayloadFieldType::StringOrNull => value.is_null() || value.as_str().is_some(),
        PayloadFieldType::NumberOrNull => value.is_null() || value.as_f64().is_some(),
        PayloadFieldType::BooleanOrNull => value.is_null() || value.as_bool().is_some(),
        PayloadFieldType::Any => true,
    }
}

fn validate_payload(
    payload: &Value,
    spec: &MessageSpec,
    kind: &str,
    name: &str,
) -> Result<(), String> {
    if spec.payload.is_empty() {
        return Ok(());
    }

    let payload_object = match payload.as_object() {
        Some(payload_object) => payload_object,
        None => {
            let missing_required = spec.payload.values().any(|field| field.required);
            if !missing_required && payload.is_null() {
                return Ok(());
            }
            return Err(format!("{kind} `{name}` payload must be an object"));
        }
    };

    for (field_name, field_spec) in &spec.payload {
        let Some(value) = payload_object.get(field_name) else {
            if field_spec.required {
                return Err(format!(
                    "{kind} `{name}` payload is missing required field `{field_name}`"
                ));
            }
            continue;
        };

        if !validate_field_type(value, &field_spec.field_type) {
            return Err(format!(
                "{kind} `{name}` payload field `{field_name}` has invalid type"
            ));
        }
    }

    Ok(())
}

pub mod action_keys {
    pub const SESSION_LANGUAGE_READ: &str = "sessionLanguageRead";
    pub const SESSION_LANGUAGE_WRITE: &str = "sessionLanguageWrite";
    pub const SESSION_STORAGE_READ: &str = "sessionStorageRead";
    pub const SESSION_STORAGE_WRITE: &str = "sessionStorageWrite";
    pub const SESSION_STORAGE_REMOVE: &str = "sessionStorageRemove";
    pub const SESSION_KEYBOARD_ESCAPE: &str = "sessionKeyboardEscape";
    pub const SESSION_KEYBOARD_STATE: &str = "sessionKeyboardState";
    pub const SESSION_LIFECYCLE_BEFORE_UNLOAD: &str = "sessionLifecycleBeforeUnload";
    pub const SESSION_NAVIGATION_POPSTATE: &str = "sessionNavigationPopstate";
    pub const SESSION_NAVIGATION_HASHCHANGE: &str = "sessionNavigationHashchange";
    pub const SESSION_MODAL_STATE: &str = "sessionModalState";
    pub const SESSION_MODAL_CLOSE_REQUEST: &str = "sessionModalCloseRequest";

    pub const UI_READ_STATS_REQUEST: &str = "uiReadStatsRequest";
    pub const UI_READ_STATS_RETRY: &str = "uiReadStatsRetry";
    pub const UI_READ_STATS_ERROR: &str = "uiReadStatsError";
    pub const UI_READ_GAME_INFO_REQUEST: &str = "uiReadGameInfoRequest";
    pub const UI_READ_GAME_INFO_RETRY: &str = "uiReadGameInfoRetry";
    pub const UI_READ_GAME_INFO_ERROR: &str = "uiReadGameInfoError";
    pub const UI_READ_LOBBY_EXISTS_REQUEST: &str = "uiReadLobbyExistsRequest";
    pub const UI_READ_LOBBY_EXISTS_RETRY: &str = "uiReadLobbyExistsRetry";
    pub const UI_READ_LOBBY_EXISTS_ERROR: &str = "uiReadLobbyExistsError";
    pub const UI_READ_LOBBY_ARCHIVE_REQUEST: &str = "uiReadLobbyArchiveRequest";
    pub const UI_READ_LOBBY_ARCHIVE_RETRY: &str = "uiReadLobbyArchiveRetry";
    pub const UI_READ_LOBBY_ARCHIVE_ERROR: &str = "uiReadLobbyArchiveError";
    pub const UI_READ_LOBBY_STATE_REQUEST: &str = "uiReadLobbyStateRequest";
    pub const UI_READ_LOBBY_STATE_RETRY: &str = "uiReadLobbyStateRetry";
    pub const UI_READ_LOBBY_STATE_ERROR: &str = "uiReadLobbyStateError";
    pub const UI_MATCHMAKING_SEARCH_REQUEST: &str = "uiMatchmakingSearchRequest";
    pub const UI_MATCHMAKING_SEARCH_RETRY: &str = "uiMatchmakingSearchRetry";
    pub const UI_MATCHMAKING_SEARCH_CANCEL: &str = "uiMatchmakingSearchCancel";
    pub const UI_MATCHMAKING_SEARCH_ERROR: &str = "uiMatchmakingSearchError";

    pub const UI_MUTATE_HOST_CREATE_REQUEST: &str = "uiMutateHostCreateRequest";
    pub const UI_MUTATE_HOST_CREATE_RETRY: &str = "uiMutateHostCreateRetry";
    pub const UI_MUTATE_HOST_CREATE_ERROR: &str = "uiMutateHostCreateError";
    pub const UI_MUTATE_HOST_START_REQUEST: &str = "uiMutateHostStartRequest";
    pub const UI_MUTATE_HOST_START_RETRY: &str = "uiMutateHostStartRetry";
    pub const UI_MUTATE_HOST_START_ERROR: &str = "uiMutateHostStartError";
    pub const UI_MUTATE_ACCOUNT_MAGIC_LINK_REQUEST: &str = "uiMutateAccountMagicLinkRequest";
    pub const UI_MUTATE_ACCOUNT_MAGIC_LINK_RETRY: &str = "uiMutateAccountMagicLinkRetry";
    pub const UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR: &str = "uiMutateAccountMagicLinkError";
    pub const UI_HOST_LOBBY_MODAL_LAUNCH: &str = "uiHostLobbyModalLaunch";
    pub const UI_HOST_LOBBY_MODAL_SHOW: &str = "uiHostLobbyModalShow";
    pub const UI_HOST_LOBBY_MODAL_HIDE: &str = "uiHostLobbyModalHide";
    pub const UI_JOIN_PRIVATE_LOBBY_MODAL_LAUNCH: &str = "uiJoinPrivateLobbyModalLaunch";
    pub const UI_JOIN_PRIVATE_LOBBY_MODAL_OPEN: &str = "uiJoinPrivateLobbyModalOpen";
    pub const UI_JOIN_PRIVATE_LOBBY_MODAL_CLOSE: &str = "uiJoinPrivateLobbyModalClose";
    pub const UI_JOIN_PRIVATE_LOBBY_UPDATE_LOBBY_ID: &str = "uiJoinPrivateLobbyUpdateLobbyId";
    pub const UI_JOIN_PRIVATE_LOBBY_UPDATE_JOINED: &str = "uiJoinPrivateLobbyUpdateJoined";
    pub const UI_PUBLIC_LOBBY_LAUNCH: &str = "uiPublicLobbyLaunch";
    pub const UI_LAYOUT_FOOTER_LAUNCH: &str = "uiLayoutFooterLaunch";
    pub const UI_LAYOUT_MAIN_LAYOUT_LAUNCH: &str = "uiLayoutMainLayoutLaunch";
    pub const UI_LAYOUT_MOBILE_NAV_BAR_LAUNCH: &str = "uiLayoutMobileNavBarLaunch";
    pub const UI_LAYOUT_DESKTOP_NAV_BAR_LAUNCH: &str = "uiLayoutDesktopNavBarLaunch";
    pub const UI_LAYOUT_PLAY_PAGE_LAUNCH: &str = "uiLayoutPlayPageLaunch";
    pub const UI_PROFILE_ACCOUNT_MODAL_LAUNCH: &str = "uiProfileAccountModalLaunch";
    pub const UI_PROFILE_ACCOUNT_MODAL_OPEN: &str = "uiProfileAccountModalOpen";
    pub const UI_PROFILE_ACCOUNT_MODAL_CLOSE: &str = "uiProfileAccountModalClose";
    pub const UI_PROFILE_SINGLE_PLAYER_MODAL_LAUNCH: &str = "uiProfileSinglePlayerModalLaunch";
    pub const UI_PROFILE_SINGLE_PLAYER_MODAL_SHOW: &str = "uiProfileSinglePlayerModalShow";
    pub const UI_PROFILE_SINGLE_PLAYER_MODAL_HIDE: &str = "uiProfileSinglePlayerModalHide";
    pub const UI_PROFILE_LANG_SELECTOR_LAUNCH: &str = "uiProfileLangSelectorLaunch";
    pub const UI_PROFILE_LANG_SELECTOR_SHOW: &str = "uiProfileLangSelectorShow";
    pub const UI_PROFILE_LANG_SELECTOR_HIDE: &str = "uiProfileLangSelectorHide";
    pub const UI_PROFILE_GAME_STARTING_MODAL_LAUNCH: &str = "uiProfileGameStartingModalLaunch";
    pub const UI_PROFILE_GAME_STARTING_MODAL_SHOW: &str = "uiProfileGameStartingModalShow";
    pub const UI_PROFILE_GAME_STARTING_MODAL_HIDE: &str = "uiProfileGameStartingModalHide";
    pub const UI_PROFILE_LANGUAGE_MODAL_LAUNCH: &str = "uiProfileLanguageModalLaunch";
    pub const UI_PROFILE_LANGUAGE_MODAL_OPEN: &str = "uiProfileLanguageModalOpen";
    pub const UI_PROFILE_LANGUAGE_MODAL_CLOSE: &str = "uiProfileLanguageModalClose";
    pub const UI_PROFILE_FLAG_INPUT_MODAL_LAUNCH: &str = "uiProfileFlagInputModalLaunch";
    pub const UI_PROFILE_FLAG_INPUT_MODAL_OPEN: &str = "uiProfileFlagInputModalOpen";
    pub const UI_PROFILE_FLAG_INPUT_MODAL_CLOSE: &str = "uiProfileFlagInputModalClose";
    pub const UI_PROFILE_TOKEN_LOGIN_MODAL_LAUNCH: &str = "uiProfileTokenLoginModalLaunch";
    pub const UI_PROFILE_TOKEN_LOGIN_MODAL_OPEN: &str = "uiProfileTokenLoginModalOpen";
    pub const UI_PROFILE_TOKEN_LOGIN_MODAL_CLOSE: &str = "uiProfileTokenLoginModalClose";
    pub const UI_PROFILE_NEWS_MODAL_LAUNCH: &str = "uiProfileNewsModalLaunch";
    pub const UI_PROFILE_NEWS_MODAL_OPEN: &str = "uiProfileNewsModalOpen";
    pub const UI_PROFILE_NEWS_MODAL_CLOSE: &str = "uiProfileNewsModalClose";
    pub const UI_PROFILE_HELP_MODAL_LAUNCH: &str = "uiProfileHelpModalLaunch";
    pub const UI_PROFILE_HELP_MODAL_OPEN: &str = "uiProfileHelpModalOpen";
    pub const UI_PROFILE_HELP_MODAL_CLOSE: &str = "uiProfileHelpModalClose";
    pub const UI_PROFILE_FLAG_INPUT_LAUNCH: &str = "uiProfileFlagInputLaunch";
    pub const UI_PROFILE_PATTERN_INPUT_LAUNCH: &str = "uiProfilePatternInputLaunch";
    pub const UI_PROFILE_USERNAME_INPUT_LAUNCH: &str = "uiProfileUsernameInputLaunch";
    pub const UI_PROFILE_TERRITORY_PATTERNS_MODAL_LAUNCH: &str =
        "uiProfileTerritoryPatternsModalLaunch";
    pub const UI_PROFILE_USER_SETTING_MODAL_LAUNCH: &str = "uiProfileUserSettingModalLaunch";
    pub const UI_PROFILE_MATCHMAKING_MODAL_LAUNCH: &str = "uiProfileMatchmakingModalLaunch";
    pub const UI_PROFILE_STATS_MODAL_LAUNCH: &str = "uiProfileStatsModalLaunch";
    pub const UI_PROFILE_GAME_INFO_MODAL_LAUNCH: &str = "uiProfileGameInfoModalLaunch";
    pub const UI_PROFILE_GAME_INFO_MODAL_HIDE: &str = "uiProfileGameInfoModalHide";

    pub const UI_INGAME_BUILD_MENU_LAUNCH: &str = "uiInGameBuildMenuLaunch";
    pub const UI_INGAME_BUILD_MENU_SHOW: &str = "uiInGameBuildMenuShow";
    pub const UI_INGAME_BUILD_MENU_HIDE: &str = "uiInGameBuildMenuHide";
    pub const UI_INGAME_RADIAL_MENU_LAUNCH: &str = "uiInGameRadialMenuLaunch";
    pub const UI_INGAME_RADIAL_MENU_SHOW: &str = "uiInGameRadialMenuShow";
    pub const UI_INGAME_RADIAL_MENU_UPDATE_ITEMS: &str = "uiInGameRadialMenuUpdateItems";
    pub const UI_INGAME_RADIAL_MENU_PUSH_SUBMENU: &str = "uiInGameRadialMenuPushSubmenu";
    pub const UI_INGAME_RADIAL_MENU_POP_SUBMENU: &str = "uiInGameRadialMenuPopSubmenu";
    pub const UI_INGAME_RADIAL_MENU_HIDE: &str = "uiInGameRadialMenuHide";
    pub const UI_INGAME_WIN_MODAL_LAUNCH: &str = "uiInGameWinModalLaunch";
    pub const UI_INGAME_WIN_MODAL_SHOW: &str = "uiInGameWinModalShow";
    pub const UI_INGAME_WIN_MODAL_HIDE: &str = "uiInGameWinModalHide";
    pub const UI_INGAME_WIN_MODAL_UPDATE_COSMETICS: &str = "uiInGameWinModalUpdateCosmetics";
    pub const UI_INGAME_EVENTS_DISPLAY_LAUNCH: &str = "uiInGameEventsDisplayLaunch";
    pub const UI_INGAME_CHAT_DISPLAY_LAUNCH: &str = "uiInGameChatDisplayLaunch";
    pub const UI_INGAME_CONTROL_PANEL_LAUNCH: &str = "uiInGameControlPanelLaunch";
    pub const UI_INGAME_EMOJI_TABLE_LAUNCH: &str = "uiInGameEmojiTableLaunch";
    pub const UI_INGAME_EMOJI_TABLE_SHOW: &str = "uiInGameEmojiTableShow";
    pub const UI_INGAME_EMOJI_TABLE_HIDE: &str = "uiInGameEmojiTableHide";
    pub const UI_INGAME_UNIT_DISPLAY_LAUNCH: &str = "uiInGameUnitDisplayLaunch";
    pub const UI_HUD_SPAWN_TIMER_LAUNCH: &str = "uiHudSpawnTimerLaunch";
    pub const UI_HUD_SPAWN_TIMER_SHOW: &str = "uiHudSpawnTimerShow";
    pub const UI_HUD_IMMUNITY_TIMER_LAUNCH: &str = "uiHudImmunityTimerLaunch";
    pub const UI_HUD_HEADS_UP_MESSAGE_LAUNCH: &str = "uiHudHeadsUpMessageLaunch";
    pub const UI_HUD_HEADS_UP_TOAST_SHOW: &str = "uiHudHeadsUpToastShow";
    pub const UI_HUD_HEADS_UP_TOAST_HIDE: &str = "uiHudHeadsUpToastHide";
    pub const UI_HUD_ALERT_FRAME_LAUNCH: &str = "uiHudAlertFrameLaunch";
    pub const UI_INGAME_GAME_LEFT_SIDEBAR_LAUNCH: &str = "uiInGameGameLeftSidebarLaunch";
    pub const UI_INGAME_REPLAY_PANEL_LAUNCH: &str = "uiInGameReplayPanelLaunch";
    pub const UI_INGAME_GAME_RIGHT_SIDEBAR_LAUNCH: &str = "uiInGameGameRightSidebarLaunch";
    pub const UI_INGAME_PLAYER_PANEL_LAUNCH: &str = "uiInGamePlayerPanelLaunch";
    pub const UI_INGAME_PLAYER_INFO_OVERLAY_LAUNCH: &str = "uiInGamePlayerInfoOverlayLaunch";
    pub const UI_INGAME_PERFORMANCE_OVERLAY_LAUNCH: &str = "uiInGamePerformanceOverlayLaunch";
    pub const UI_INGAME_FULL_SETTINGS_MODAL_LAUNCH: &str = "uiInGameFullSettingsModalLaunch";
    pub const UI_INGAME_LEADERBOARD_LAUNCH: &str = "uiInGameLeaderboardLaunch";
    pub const UI_INGAME_TEAM_STATS_LAUNCH: &str = "uiInGameTeamStatsLaunch";
    pub const UI_INGAME_SEND_RESOURCE_MODAL_LAUNCH: &str = "uiInGameSendResourceModalLaunch";
    pub const UI_INGAME_SEND_RESOURCE_MODAL_SHOW: &str = "uiInGameSendResourceModalShow";
    pub const UI_INGAME_SEND_RESOURCE_MODAL_HIDE: &str = "uiInGameSendResourceModalHide";
    pub const UI_INGAME_MULTI_TAB_MODAL_LAUNCH: &str = "uiInGameMultiTabModalLaunch";
    pub const UI_INGAME_MULTI_TAB_MODAL_SHOW: &str = "uiInGameMultiTabModalShow";
    pub const UI_INGAME_MULTI_TAB_MODAL_HIDE: &str = "uiInGameMultiTabModalHide";
    pub const UI_INGAME_CHAT_MODAL_LAUNCH: &str = "uiInGameChatModalLaunch";
    pub const UI_INGAME_CHAT_MODAL_CLOSE: &str = "uiInGameChatModalClose";
    pub const UI_INGAME_CHAT_MODAL_OPEN_WITH_SELECTION: &str = "uiInGameChatModalOpenWithSelection";
    pub const UI_INGAME_PLAYER_MODERATION_MODAL_LAUNCH: &str =
        "uiInGamePlayerModerationModalLaunch";
    pub const UI_INGAME_PLAYER_MODERATION_MODAL_CLOSE: &str = "uiInGamePlayerModerationModalClose";
}

pub mod event_keys {
    pub const SESSION_LANGUAGE_READ_RESULT: &str = "sessionLanguageReadResult";
    pub const SESSION_LANGUAGE_CHANGED: &str = "sessionLanguageChanged";
    pub const SESSION_STORAGE_READ_RESULT: &str = "sessionStorageReadResult";
    pub const SESSION_STORAGE_CHANGED: &str = "sessionStorageChanged";
    pub const SESSION_MODAL_CLOSE: &str = "sessionModalClose";
    pub const SESSION_KEYBOARD_CHANGED: &str = "sessionKeyboardChanged";
    pub const SESSION_LIFECYCLE_BEFORE_UNLOAD: &str = "sessionLifecycleBeforeUnload";
    pub const SESSION_NAVIGATION_POPSTATE: &str = "sessionNavigationPopstate";
    pub const SESSION_NAVIGATION_HASHCHANGE: &str = "sessionNavigationHashchange";

    pub const UI_READ_STATS_LOADING: &str = "uiReadStatsLoading";
    pub const UI_READ_STATS_RETRY: &str = "uiReadStatsRetry";
    pub const UI_READ_STATS_ERROR: &str = "uiReadStatsError";
    pub const UI_READ_GAME_INFO_LOADING: &str = "uiReadGameInfoLoading";
    pub const UI_READ_GAME_INFO_RETRY: &str = "uiReadGameInfoRetry";
    pub const UI_READ_GAME_INFO_ERROR: &str = "uiReadGameInfoError";
    pub const UI_READ_LOBBY_EXISTS_LOADING: &str = "uiReadLobbyExistsLoading";
    pub const UI_READ_LOBBY_EXISTS_RETRY: &str = "uiReadLobbyExistsRetry";
    pub const UI_READ_LOBBY_EXISTS_ERROR: &str = "uiReadLobbyExistsError";
    pub const UI_READ_LOBBY_ARCHIVE_LOADING: &str = "uiReadLobbyArchiveLoading";
    pub const UI_READ_LOBBY_ARCHIVE_RETRY: &str = "uiReadLobbyArchiveRetry";
    pub const UI_READ_LOBBY_ARCHIVE_ERROR: &str = "uiReadLobbyArchiveError";
    pub const UI_READ_LOBBY_STATE_LOADING: &str = "uiReadLobbyStateLoading";
    pub const UI_READ_LOBBY_STATE_RETRY: &str = "uiReadLobbyStateRetry";
    pub const UI_READ_LOBBY_STATE_ERROR: &str = "uiReadLobbyStateError";
    pub const UI_MATCHMAKING_SEARCH_LOADING: &str = "uiMatchmakingSearchLoading";
    pub const UI_MATCHMAKING_SEARCH_RETRY: &str = "uiMatchmakingSearchRetry";
    pub const UI_MATCHMAKING_SEARCH_CANCEL: &str = "uiMatchmakingSearchCancel";
    pub const UI_MATCHMAKING_SEARCH_ERROR: &str = "uiMatchmakingSearchError";

    pub const UI_MUTATE_HOST_CREATE_LOADING: &str = "uiMutateHostCreateLoading";
    pub const UI_MUTATE_HOST_CREATE_RETRY: &str = "uiMutateHostCreateRetry";
    pub const UI_MUTATE_HOST_CREATE_ERROR: &str = "uiMutateHostCreateError";
    pub const UI_MUTATE_HOST_START_LOADING: &str = "uiMutateHostStartLoading";
    pub const UI_MUTATE_HOST_START_RETRY: &str = "uiMutateHostStartRetry";
    pub const UI_MUTATE_HOST_START_ERROR: &str = "uiMutateHostStartError";
    pub const UI_MUTATE_ACCOUNT_MAGIC_LINK_LOADING: &str = "uiMutateAccountMagicLinkLoading";
    pub const UI_MUTATE_ACCOUNT_MAGIC_LINK_RETRY: &str = "uiMutateAccountMagicLinkRetry";
    pub const UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR: &str = "uiMutateAccountMagicLinkError";

    pub const UI_INGAME_BUILD_MENU_SELECTED: &str = "uiInGameBuildMenuSelected";
    pub const UI_INGAME_BUILD_MENU_CLOSED: &str = "uiInGameBuildMenuClosed";
    pub const UI_INGAME_RADIAL_MENU_ITEM_CLICK: &str = "uiInGameRadialMenuItemClick";
    pub const UI_INGAME_RADIAL_MENU_CENTER_CLICK: &str = "uiInGameRadialMenuCenterClick";
    pub const UI_INGAME_RADIAL_MENU_CLOSE: &str = "uiInGameRadialMenuClose";
    pub const UI_INGAME_WIN_MODAL_EXIT: &str = "uiInGameWinModalExit";
    pub const UI_INGAME_WIN_MODAL_HIDE_REQUEST: &str = "uiInGameWinModalHideRequest";
    pub const UI_INGAME_WIN_MODAL_PURCHASE: &str = "uiInGameWinModalPurchase";
    pub const UI_INGAME_CHAT_MODAL_CLOSE_REQUEST: &str = "uiInGameChatModalCloseRequest";
    pub const UI_INGAME_CHAT_MODAL_SEND: &str = "uiInGameChatModalSend";
    pub const UI_INGAME_PLAYER_MODERATION_CLOSE_REQUEST: &str =
        "uiInGamePlayerModerationCloseRequest";
    pub const UI_INGAME_PLAYER_MODERATION_KICK: &str = "uiInGamePlayerModerationKick";
    pub const UI_INGAME_SEND_RESOURCE_CLOSE_REQUEST: &str = "uiInGameSendResourceCloseRequest";
    pub const UI_INGAME_SEND_RESOURCE_CONFIRM: &str = "uiInGameSendResourceConfirm";
    pub const UI_INGAME_MULTI_TAB_PENALTY_COMPLETE: &str = "uiInGameMultiTabPenaltyComplete";
    pub const UI_INGAME_PERFORMANCE_OVERLAY_RESET: &str = "uiInGamePerformanceOverlayReset";
    pub const UI_INGAME_PERFORMANCE_OVERLAY_COPY: &str = "uiInGamePerformanceOverlayCopy";
    pub const UI_INGAME_PERFORMANCE_OVERLAY_CLOSE_REQUEST: &str =
        "uiInGamePerformanceOverlayCloseRequest";
    pub const UI_INGAME_EVENTS_DISPLAY_TOGGLE_HIDDEN: &str =
        "uiInGameEventsDisplayToggleHidden";
    pub const UI_INGAME_EVENTS_DISPLAY_TOGGLE_FILTER: &str =
        "uiInGameEventsDisplayToggleFilter";
    pub const UI_INGAME_EVENTS_DISPLAY_FOCUS_PLAYER: &str =
        "uiInGameEventsDisplayFocusPlayer";
    pub const UI_INGAME_EVENTS_DISPLAY_FOCUS_UNIT: &str = "uiInGameEventsDisplayFocusUnit";
    pub const UI_INGAME_EVENTS_DISPLAY_BUTTON_CLICK: &str =
        "uiInGameEventsDisplayButtonClick";
    pub const UI_INGAME_EVENTS_DISPLAY_ATTACK_CLICK: &str =
        "uiInGameEventsDisplayAttackClick";
    pub const UI_INGAME_EVENTS_DISPLAY_RETALIATE: &str = "uiInGameEventsDisplayRetaliate";
    pub const UI_INGAME_EVENTS_DISPLAY_CANCEL_ATTACK: &str =
        "uiInGameEventsDisplayCancelAttack";
    pub const UI_INGAME_EVENTS_DISPLAY_FOCUS_BOAT: &str = "uiInGameEventsDisplayFocusBoat";
    pub const UI_INGAME_EVENTS_DISPLAY_CANCEL_BOAT: &str = "uiInGameEventsDisplayCancelBoat";
    pub const UI_INGAME_PLAYER_PANEL_CLOSE: &str = "uiInGamePlayerPanelClose";
    pub const UI_INGAME_PLAYER_PANEL_ACTION: &str = "uiInGamePlayerPanelAction";
    pub const UI_INGAME_PLAYER_PANEL_TOGGLE_ROCKET: &str = "uiInGamePlayerPanelToggleRocket";
    pub const UI_INGAME_PLAYER_INFO_TOGGLE_DETAILS: &str = "uiInGamePlayerInfoToggleDetails";
    pub const UI_INGAME_SETTINGS_MODAL_SETTING_CHANGE: &str =
        "uiInGameSettingsModalSettingChange";
    pub const UI_INGAME_SETTINGS_MODAL_CLOSE_REQUEST: &str =
        "uiInGameSettingsModalCloseRequest";
    pub const UI_INGAME_CHAT_DISPLAY_TOGGLE: &str = "uiInGameChatDisplayToggle";
    pub const UI_INGAME_CONTROL_PANEL_RATIO_CHANGE: &str = "uiInGameControlPanelRatioChange";
    pub const UI_INGAME_EMOJI_TABLE_SELECT: &str = "uiInGameEmojiTableSelect";
    pub const UI_INGAME_EMOJI_TABLE_CLOSE: &str = "uiInGameEmojiTableClose";
    pub const UI_INGAME_UNIT_DISPLAY_CLICK: &str = "uiInGameUnitDisplayClick";
    pub const UI_INGAME_UNIT_DISPLAY_HOVER: &str = "uiInGameUnitDisplayHover";
    pub const UI_INGAME_UNIT_DISPLAY_UNHOVER: &str = "uiInGameUnitDisplayUnhover";
    pub const UI_INGAME_LEADERBOARD_ROW_CLICK: &str = "uiInGameLeaderboardRowClick";
    pub const UI_INGAME_LEADERBOARD_SORT: &str = "uiInGameLeaderboardSort";
    pub const UI_INGAME_LEADERBOARD_TOGGLE: &str = "uiInGameLeaderboardToggle";
    pub const UI_INGAME_GAME_LEFT_SIDEBAR_TOGGLE_LEADERBOARD: &str =
        "uiInGameGameLeftSidebarToggleLeaderboard";
    pub const UI_INGAME_GAME_LEFT_SIDEBAR_TOGGLE_TEAM: &str =
        "uiInGameGameLeftSidebarToggleTeam";
    pub const UI_INGAME_REPLAY_PANEL_SPEED: &str = "uiInGameReplayPanelSpeed";
    pub const UI_INGAME_GAME_RIGHT_SIDEBAR_REPLAY: &str =
        "uiInGameGameRightSidebarReplay";
    pub const UI_INGAME_GAME_RIGHT_SIDEBAR_PAUSE: &str = "uiInGameGameRightSidebarPause";
    pub const UI_INGAME_GAME_RIGHT_SIDEBAR_SETTINGS: &str =
        "uiInGameGameRightSidebarSettings";
    pub const UI_INGAME_GAME_RIGHT_SIDEBAR_EXIT: &str = "uiInGameGameRightSidebarExit";
    pub const UI_LOBBY_HOST_MODAL_CLOSE_REQUEST: &str = "uiLobbyHostModalCloseRequest";
    pub const UI_LOBBY_HOST_MODAL_START_REQUEST: &str = "uiLobbyHostModalStartRequest";
    pub const UI_LOBBY_HOST_MODAL_FORM_CHANGE: &str = "uiLobbyHostModalFormChange";
    pub const UI_LOBBY_HOST_MODAL_COPY_LINK_REQUEST: &str = "uiLobbyHostModalCopyLinkRequest";
    pub const UI_LOBBY_HOST_MODAL_KICK_REQUEST: &str = "uiLobbyHostModalKickRequest";
    pub const UI_LOBBY_PUBLIC_CLICK: &str = "uiLobbyPublicClick";
    pub const UI_LOBBY_JOIN_PRIVATE_JOIN_LOBBY: &str = "uiLobbyJoinPrivateJoinLobby";
    pub const UI_LOBBY_JOIN_PRIVATE_PASTE_REQUEST: &str = "uiLobbyJoinPrivatePasteRequest";
    pub const UI_LOBBY_JOIN_PRIVATE_CLOSE_REQUEST: &str = "uiLobbyJoinPrivateCloseRequest";
}

pub mod snapshot_keys {
    pub const UI_SNAPSHOT_HUD_SPAWN_TIMER: &str = "uiSnapshotHudSpawnTimer";
    pub const UI_SNAPSHOT_HUD_IMMUNITY_TIMER: &str = "uiSnapshotHudImmunityTimer";
    pub const UI_SNAPSHOT_HUD_HEADS_UP_MESSAGE: &str = "uiSnapshotHudHeadsUpMessage";
    pub const UI_SNAPSHOT_HUD_ALERT_FRAME: &str = "uiSnapshotHudAlertFrame";

    pub const UI_SNAPSHOT_INGAME_CONTROL_PANEL: &str = "uiSnapshotInGameControlPanel";
    pub const UI_SNAPSHOT_INGAME_UNIT_DISPLAY: &str = "uiSnapshotInGameUnitDisplay";
    pub const UI_SNAPSHOT_INGAME_REPLAY_PANEL: &str = "uiSnapshotInGameReplayPanel";
    pub const UI_SNAPSHOT_INGAME_GAME_LEFT_SIDEBAR: &str = "uiSnapshotInGameGameLeftSidebar";
    pub const UI_SNAPSHOT_INGAME_GAME_RIGHT_SIDEBAR: &str = "uiSnapshotInGameGameRightSidebar";
    pub const UI_SNAPSHOT_INGAME_CHAT_DISPLAY: &str = "uiSnapshotInGameChatDisplay";
    pub const UI_SNAPSHOT_INGAME_CHAT_MODAL_PLAYERS: &str = "uiSnapshotInGameChatModalPlayers";
    pub const UI_SNAPSHOT_INGAME_EVENTS_DISPLAY: &str = "uiSnapshotInGameEventsDisplay";
    pub const UI_SNAPSHOT_INGAME_PLAYER_PANEL: &str = "uiSnapshotInGamePlayerPanel";
    pub const UI_SNAPSHOT_INGAME_PLAYER_INFO_OVERLAY: &str = "uiSnapshotInGamePlayerInfoOverlay";
    pub const UI_SNAPSHOT_INGAME_PERFORMANCE_OVERLAY: &str = "uiSnapshotInGamePerformanceOverlay";
    pub const UI_SNAPSHOT_INGAME_LEADERBOARD_ENTRIES: &str = "uiSnapshotInGameLeaderboardEntries";
    pub const UI_SNAPSHOT_INGAME_TEAM_STATS_ENTRIES: &str = "uiSnapshotInGameTeamStatsEntries";
    pub const UI_SNAPSHOT_INGAME_SEND_RESOURCE_TOTAL: &str = "uiSnapshotInGameSendResourceTotal";
    pub const UI_SNAPSHOT_LOBBY_HOST_PLAYERS: &str = "uiSnapshotLobbyHostPlayers";
    pub const UI_SNAPSHOT_LOBBY_JOIN_PRIVATE_CONFIG_HTML: &str =
        "uiSnapshotLobbyJoinPrivateConfigHtml";
    pub const UI_SNAPSHOT_LOBBY_JOIN_PRIVATE_PLAYERS_HTML: &str =
        "uiSnapshotLobbyJoinPrivatePlayersHtml";
    pub const UI_SNAPSHOT_LOBBY_PUBLIC_DATA: &str = "uiSnapshotLobbyPublicData";
    pub const UI_SNAPSHOT_LOBBY_PUBLIC_JOINING: &str = "uiSnapshotLobbyPublicJoining";
    pub const UI_SNAPSHOT_LAYOUT_FOOTER_STATE: &str = "uiSnapshotLayoutFooterState";
    pub const UI_SNAPSHOT_LAYOUT_MAIN_LAYOUT_STATE: &str = "uiSnapshotLayoutMainLayoutState";
    pub const UI_SNAPSHOT_LAYOUT_MOBILE_NAV_BAR_STATE: &str = "uiSnapshotLayoutMobileNavBarState";
    pub const UI_SNAPSHOT_LAYOUT_DESKTOP_NAV_BAR_STATE: &str = "uiSnapshotLayoutDesktopNavBarState";
    pub const UI_SNAPSHOT_LAYOUT_PLAY_PAGE_STATE: &str = "uiSnapshotLayoutPlayPageState";
    pub const UI_SNAPSHOT_PROFILE_ACCOUNT_MODAL_STATE: &str = "uiSnapshotProfileAccountModalState";
    pub const UI_SNAPSHOT_PROFILE_SINGLE_PLAYER_MODAL_STATE: &str =
        "uiSnapshotProfileSinglePlayerModalState";
    pub const UI_SNAPSHOT_PROFILE_LANG_SELECTOR_STATE: &str = "uiSnapshotProfileLangSelectorState";
    pub const UI_SNAPSHOT_PROFILE_TOKEN_LOGIN_MODAL_STATE: &str =
        "uiSnapshotProfileTokenLoginModalState";
    pub const UI_SNAPSHOT_PROFILE_NEWS_MODAL_STATE: &str = "uiSnapshotProfileNewsModalState";
    pub const UI_SNAPSHOT_PROFILE_HELP_MODAL_STATE: &str = "uiSnapshotProfileHelpModalState";
    pub const UI_SNAPSHOT_PROFILE_FLAG_INPUT_STATE: &str = "uiSnapshotProfileFlagInputState";
    pub const UI_SNAPSHOT_PROFILE_PATTERN_INPUT_STATE: &str = "uiSnapshotProfilePatternInputState";
    pub const UI_SNAPSHOT_PROFILE_USERNAME_INPUT_STATE: &str =
        "uiSnapshotProfileUsernameInputState";
    pub const UI_SNAPSHOT_PROFILE_TERRITORY_PATTERNS_MODAL_STATE: &str =
        "uiSnapshotProfileTerritoryPatternsModalState";
    pub const UI_SNAPSHOT_PROFILE_USER_SETTING_MODAL_STATE: &str =
        "uiSnapshotProfileUserSettingModalState";
    pub const UI_SNAPSHOT_PROFILE_MATCHMAKING_MODAL_STATE: &str =
        "uiSnapshotProfileMatchmakingModalState";
    pub const UI_SNAPSHOT_PROFILE_STATS_MODAL_STATE: &str = "uiSnapshotProfileStatsModalState";
    pub const UI_SNAPSHOT_PROFILE_GAME_INFO_MODAL_STATE: &str =
        "uiSnapshotProfileGameInfoModalState";
}

pub fn protocol_version() -> u32 {
    protocol_index().manifest.version
}

pub fn action_name(key: &str) -> &'static str {
    message_name(&protocol_index().manifest.actions, key, "action")
}

pub fn event_name(key: &str) -> &'static str {
    message_name(&protocol_index().manifest.events, key, "event")
}

pub fn snapshot_name(key: &str) -> &'static str {
    message_name(&protocol_index().manifest.snapshots, key, "snapshot")
}

pub fn action_matches(action_type: &str, key: &str) -> bool {
    action_type == action_name(key)
}

pub fn snapshot_matches(snapshot_type: &str, key: &str) -> bool {
    snapshot_type == snapshot_name(key)
}

pub fn validate_action_payload(action_type: &str, payload: &Value) -> Result<(), String> {
    let Some(spec) = protocol_index().action_by_name.get(action_type) else {
        return Ok(());
    };
    validate_payload(payload, spec, "action", action_type)
}

pub fn validate_event_payload(event_type: &str, payload: &Value) -> Result<(), String> {
    let Some(spec) = protocol_index().event_by_name.get(event_type) else {
        return Ok(());
    };
    validate_payload(payload, spec, "event", event_type)
}

pub fn validate_snapshot_payload(snapshot_type: &str, payload: &Value) -> Result<(), String> {
    let Some(spec) = protocol_index().snapshot_by_name.get(snapshot_type) else {
        return Ok(());
    };
    validate_payload(payload, spec, "snapshot", snapshot_type)
}

pub fn manifest_json() -> &'static str {
    PROTOCOL_MANIFEST_JSON
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_manifest_has_expected_core_entries() {
        assert_eq!(
            action_name(action_keys::SESSION_LANGUAGE_READ),
            "session.language.read"
        );
        assert_eq!(
            action_name(action_keys::SESSION_STORAGE_READ),
            "session.storage.read"
        );
        assert_eq!(
            action_name(action_keys::SESSION_STORAGE_REMOVE),
            "session.storage.remove"
        );
        assert_eq!(
            event_name(event_keys::SESSION_LANGUAGE_CHANGED),
            "session.language.changed"
        );
        assert_eq!(
            event_name(event_keys::SESSION_STORAGE_CHANGED),
            "session.storage.changed"
        );
        assert_eq!(
            action_name(action_keys::SESSION_KEYBOARD_STATE),
            "session.keyboard.state"
        );
        assert_eq!(
            event_name(event_keys::SESSION_KEYBOARD_CHANGED),
            "session.keyboard.changed"
        );
        assert_eq!(
            action_name(action_keys::SESSION_LIFECYCLE_BEFORE_UNLOAD),
            "session.lifecycle.before-unload"
        );
        assert_eq!(
            action_name(action_keys::SESSION_NAVIGATION_POPSTATE),
            "session.navigation.popstate"
        );
        assert_eq!(
            action_name(action_keys::SESSION_NAVIGATION_HASHCHANGE),
            "session.navigation.hashchange"
        );
        assert_eq!(
            action_name(action_keys::UI_MATCHMAKING_SEARCH_REQUEST),
            "ui.matchmaking.search.request"
        );
        assert_eq!(
            event_name(event_keys::SESSION_LIFECYCLE_BEFORE_UNLOAD),
            "session.lifecycle.before-unload"
        );
        assert_eq!(
            event_name(event_keys::UI_MATCHMAKING_SEARCH_LOADING),
            "ui.matchmaking.search.loading"
        );
        assert_eq!(
            event_name(event_keys::SESSION_NAVIGATION_POPSTATE),
            "session.navigation.popstate"
        );
        assert_eq!(
            event_name(event_keys::SESSION_NAVIGATION_HASHCHANGE),
            "session.navigation.hashchange"
        );
        assert_eq!(
            snapshot_name(snapshot_keys::UI_SNAPSHOT_HUD_SPAWN_TIMER),
            "ui.snapshot.hud.spawn-timer"
        );
        assert_eq!(
            snapshot_name(snapshot_keys::UI_SNAPSHOT_INGAME_CONTROL_PANEL),
            "ui.snapshot.ingame.control-panel"
        );
        assert_eq!(
            action_name(action_keys::UI_INGAME_BUILD_MENU_SHOW),
            "ui.ingame.build-menu.show"
        );
        assert_eq!(
            action_name(action_keys::UI_INGAME_BUILD_MENU_LAUNCH),
            "ui.ingame.build-menu.launch"
        );
        assert_eq!(
            event_name(event_keys::UI_INGAME_BUILD_MENU_SELECTED),
            "ui.ingame.build-menu.selected"
        );
        assert_eq!(
            event_name(event_keys::UI_INGAME_CHAT_MODAL_SEND),
            "ui.ingame.chat-modal.send"
        );
        assert_eq!(
            event_name(event_keys::UI_INGAME_EVENTS_DISPLAY_TOGGLE_FILTER),
            "ui.ingame.events-display.toggle-filter"
        );
        assert_eq!(
            event_name(event_keys::UI_INGAME_GAME_RIGHT_SIDEBAR_SETTINGS),
            "ui.ingame.game-right-sidebar.settings"
        );
        assert_eq!(
            event_name(event_keys::UI_LOBBY_PUBLIC_CLICK),
            "ui.lobby.public.click"
        );
    }

    #[test]
    fn action_payload_validation_rejects_missing_required_fields() {
        let action_type = action_name(action_keys::UI_READ_STATS_REQUEST);
        let result = validate_action_payload(action_type, &serde_json::json!({}));
        assert!(result.is_err());
    }

    #[test]
    fn action_payload_validation_accepts_optional_payload() {
        let action_type = action_name(action_keys::SESSION_LANGUAGE_READ);
        let result = validate_action_payload(action_type, &Value::Null);
        assert!(result.is_ok());
    }
}
