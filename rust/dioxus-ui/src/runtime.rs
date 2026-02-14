//! Unified UI runtime scaffolding.
//!
//! This module introduces a generic action/snapshot/event contract so we can
//! progressively collapse per-component bridge APIs into a single runtime API.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::VecDeque;
use wasm_bindgen::prelude::*;

use crate::runtime_protocol::{self, action_keys, event_keys, snapshot_keys};

pub const UI_RUNTIME_PROTOCOL_VERSION: u32 = 1;

const ERROR_INVALID_ACTION_JSON: &str = "INVALID_ACTION_JSON";
const ERROR_INVALID_SNAPSHOT_JSON: &str = "INVALID_SNAPSHOT_JSON";
const ERROR_UNSUPPORTED_PROTOCOL_VERSION: &str = "UNSUPPORTED_PROTOCOL_VERSION";
const ERROR_INVALID_ACTION_TYPE: &str = "INVALID_ACTION_TYPE";
const ERROR_INVALID_ACTION_PAYLOAD: &str = "INVALID_ACTION_PAYLOAD";
const ERROR_INVALID_SNAPSHOT_TYPE: &str = "INVALID_SNAPSHOT_TYPE";
const ERROR_INVALID_SNAPSHOT_PAYLOAD: &str = "INVALID_SNAPSHOT_PAYLOAD";
const ERROR_STORAGE_UNAVAILABLE: &str = "STORAGE_UNAVAILABLE";
#[cfg(target_arch = "wasm32")]
const ERROR_STORAGE_OPERATION_FAILED: &str = "STORAGE_OPERATION_FAILED";
const ERROR_EVENT_SERIALIZATION: &str = "EVENT_SERIALIZATION_FAILED";

const DEFAULT_LANGUAGE_STORAGE_KEY: &str = "lang";
const STORAGE_KEY_FIELD: &str = "storageKey";
const LANGUAGE_FIELD: &str = "lang";
const STORAGE_VALUE_FIELD: &str = "value";
const MODAL_FIELD: &str = "modal";
const IS_OPEN_FIELD: &str = "isOpen";
const REASON_FIELD: &str = "reason";
const KEY_FIELD: &str = "key";
const CODE_FIELD: &str = "code";
const IS_DOWN_FIELD: &str = "isDown";
const HREF_FIELD: &str = "href";
const DEFAULT_MODAL_CLOSE_REASON: &str = "request";
const ESCAPE_MODAL_CLOSE_REASON: &str = "escape";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiAction {
    pub protocol_version: u32,
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub at_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiSnapshot {
    pub protocol_version: u32,
    #[serde(rename = "type")]
    pub snapshot_type: String,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub tick: Option<u32>,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub at_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiEvent {
    pub protocol_version: u32,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub at_ms: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpawnTimerSegmentPayload {
    ratio: f64,
    color: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpawnTimerSnapshotPayload {
    visible: bool,
    #[serde(default)]
    segments: Vec<SpawnTimerSegmentPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImmunityTimerSnapshotPayload {
    active: bool,
    progress_ratio: f64,
    top_offset: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HeadsUpSnapshotPayload {
    is_visible: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AlertFrameSnapshotPayload {
    action: String,
    #[serde(default)]
    alert_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InGameStateSnapshotPayload {
    state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildMenuLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildMenuShowActionPayload {
    items: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RadialMenuLaunchActionPayload {
    config: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RadialMenuShowActionPayload {
    items: Value,
    center_button: Value,
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RadialMenuUpdateItemsActionPayload {
    items: Value,
    center_button: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RadialMenuPushSubmenuActionPayload {
    items: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WinModalLaunchActionPayload {
    translations: Value,
    is_in_iframe: bool,
    games_played: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WinModalShowActionPayload {
    title: String,
    is_win: bool,
    content_type: String,
    cosmetics: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WinModalUpdateCosmeticsActionPayload {
    cosmetics: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmojiTableLaunchActionPayload {
    emojis: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HeadsUpToastShowActionPayload {
    message: String,
    color: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FullSettingsModalLaunchActionPayload {
    settings: Value,
    translations: Value,
    icons: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LeaderboardLaunchActionPayload {
    entries: Value,
    translations: Value,
    show_top_five: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TeamStatsLaunchActionPayload {
    entries: Value,
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InGameEntriesSnapshotPayload {
    entries: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChatModalPlayersSnapshotPayload {
    players: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendResourceModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendResourceModalShowActionPayload {
    state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MultiTabModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MultiTabModalShowActionPayload {
    duration_ms: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChatModalLaunchActionPayload {
    state: Value,
    players: Value,
    quick_chat_phrases: Value,
    translations: Value,
    phrase_translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChatModalOpenWithSelectionActionPayload {
    category_id: String,
    phrase_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlayerModerationModalLaunchActionPayload {
    state: Value,
    my_player: Value,
    target_player: Value,
    translations: Value,
    kick_icon: String,
    shield_icon: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostLobbyModalLaunchActionPayload {
    translations: Value,
    maps: Value,
    difficulties: Value,
    unit_options: Value,
    team_count_options: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JoinPrivateLobbyModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JoinPrivateLobbyUpdateLobbyIdActionPayload {
    lobby_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JoinPrivateLobbyUpdateJoinedActionPayload {
    has_joined: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicLobbyLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SinglePlayerModalLaunchActionPayload {
    translations: Value,
    maps: Value,
    difficulties: Value,
    unit_options: Value,
    team_count_options: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LangSelectorLaunchActionPayload {
    initial_flag_svg: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GameStartingModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LanguageModalLaunchActionPayload {
    language_list: Value,
    current_lang: String,
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FlagInputModalLaunchActionPayload {
    countries: Value,
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TokenLoginModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NewsModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelpModalLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FlagInputLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PatternInputLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UsernameInputLaunchActionPayload {
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileModalLaunchActionPayload {
    state: Value,
    translations: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendResourceTotalSnapshotPayload {
    total: f64,
    mode: String,
    capacity_left: f64,
    has_capacity: bool,
    target_alive: bool,
    sender_alive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostLobbyPlayersSnapshotPayload {
    players: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JoinPrivateLobbyHtmlSnapshotPayload {
    html: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicLobbyDataSnapshotPayload {
    data: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicLobbyJoiningSnapshotPayload {
    state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountModalStateSnapshotPayload {
    state: AccountModalSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountModalSnapshotState {
    #[serde(default)]
    loading: Option<bool>,
    #[serde(default)]
    content_html: Option<String>,
    #[serde(default)]
    header_right_html: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SinglePlayerModalStateSnapshotPayload {
    state: SinglePlayerModalSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SinglePlayerModalSnapshotState {
    #[serde(default)]
    form: Option<Value>,
    #[serde(default)]
    achievements: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LangSelectorStateSnapshotPayload {
    state: LangSelectorSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LangSelectorSnapshotState {
    #[serde(default)]
    flag_svg: Option<String>,
    #[serde(default)]
    is_visible: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TokenLoginModalStateSnapshotPayload {
    state: TokenLoginModalSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TokenLoginModalSnapshotState {
    #[serde(default)]
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NewsModalStateSnapshotPayload {
    state: NewsModalSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NewsModalSnapshotState {
    #[serde(default)]
    content_html: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelpModalStateSnapshotPayload {
    state: HelpModalSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelpModalSnapshotState {
    #[serde(default)]
    content_html: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FlagInputStateSnapshotPayload {
    state: FlagInputSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FlagInputSnapshotState {
    #[serde(default)]
    flag: Option<String>,
    #[serde(default)]
    show_select_label: Option<bool>,
    #[serde(default)]
    translations: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PatternInputStateSnapshotPayload {
    state: PatternInputSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PatternInputSnapshotState {
    #[serde(default)]
    preview_url: Option<String>,
    #[serde(default)]
    show_select_label: Option<bool>,
    #[serde(default)]
    loading: Option<bool>,
    #[serde(default)]
    translations: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UsernameInputStateSnapshotPayload {
    state: UsernameInputSnapshotState,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UsernameInputSnapshotState {
    #[serde(default)]
    clan_tag: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    validation_error: Option<String>,
    #[serde(default)]
    translations: Option<Value>,
}

#[derive(Debug, Default)]
struct UiRuntimeState {
    pending_actions: VecDeque<UiAction>,
    pending_snapshots: VecDeque<UiSnapshot>,
    outbound_events: VecDeque<UiEvent>,
    accepted_actions: u64,
    accepted_snapshots: u64,
    rejected_actions: u64,
    rejected_snapshots: u64,
    emitted_events: u64,
    drained_actions: u64,
    drained_snapshots: u64,
    drained_events: u64,
    open_modal_stack: Vec<String>,
    last_error: Option<String>,
    last_error_code: Option<String>,
}

thread_local! {
    static UI_RUNTIME: RefCell<UiRuntimeState> = RefCell::new(UiRuntimeState::default());
}

pub fn initialize() {
    clear_ui_runtime();
}

fn runtime_now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

fn set_last_error(code: &str, msg: String) {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.last_error = Some(msg);
        runtime.last_error_code = Some(code.to_string());
    });
}

fn clear_last_error() {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.last_error = None;
        runtime.last_error_code = None;
    });
}

fn validate_protocol_version(version: u32) -> Result<(), String> {
    let expected = runtime_protocol::protocol_version();
    if version == expected {
        Ok(())
    } else {
        Err(format!(
            "unsupported protocolVersion: expected {}, got {}",
            expected, version
        ))
    }
}

fn validate_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    validate_protocol_version(action.protocol_version)
        .map_err(|message| (ERROR_UNSUPPORTED_PROTOCOL_VERSION, message))?;

    if action.action_type.trim().is_empty() {
        return Err((
            ERROR_INVALID_ACTION_TYPE,
            "action type must be a non-empty string".to_string(),
        ));
    }

    runtime_protocol::validate_action_payload(action.action_type.as_str(), &action.payload)
        .map_err(|message| (ERROR_INVALID_ACTION_PAYLOAD, message))?;

    Ok(())
}

fn validate_snapshot(snapshot: &UiSnapshot) -> Result<(), (&'static str, String)> {
    validate_protocol_version(snapshot.protocol_version)
        .map_err(|message| (ERROR_UNSUPPORTED_PROTOCOL_VERSION, message))?;

    if snapshot.snapshot_type.trim().is_empty() {
        return Err((
            ERROR_INVALID_SNAPSHOT_TYPE,
            "snapshot type must be a non-empty string".to_string(),
        ));
    }

    runtime_protocol::validate_snapshot_payload(snapshot.snapshot_type.as_str(), &snapshot.payload)
        .map_err(|message| (ERROR_INVALID_SNAPSHOT_PAYLOAD, message))?;

    Ok(())
}

fn action_payload_or_empty(action: &UiAction) -> Value {
    if action.payload.is_null() {
        json!({})
    } else {
        action.payload.clone()
    }
}

fn action_matches(action_type: &str, key: &str) -> bool {
    runtime_protocol::action_matches(action_type, key)
}

fn event_name(key: &str) -> &'static str {
    runtime_protocol::event_name(key)
}

fn snapshot_matches(snapshot_type: &str, key: &str) -> bool {
    runtime_protocol::snapshot_matches(snapshot_type, key)
}

fn parse_optional_non_empty_string(
    payload: &Value,
    field: &str,
) -> Result<Option<String>, (&'static str, String)> {
    let Some(payload_object) = payload.as_object() else {
        return Ok(None);
    };

    match payload_object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err((
                    ERROR_INVALID_ACTION_PAYLOAD,
                    format!("payload.{field} must be a non-empty string"),
                ));
            }
            Ok(Some(trimmed.to_string()))
        }
        Some(_) => Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            format!("payload.{field} must be a non-empty string"),
        )),
    }
}

fn parse_modal_state_payload(payload: &Value) -> Result<(String, bool), (&'static str, String)> {
    let Some(payload_object) = payload.as_object() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "session.modal.state payload must be an object".to_string(),
        ));
    };

    let Some(Value::String(modal)) = payload_object.get(MODAL_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.modal must be a non-empty string".to_string(),
        ));
    };
    let modal = modal.trim();
    if modal.is_empty() {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.modal must be a non-empty string".to_string(),
        ));
    }

    let Some(Value::Bool(is_open)) = payload_object.get(IS_OPEN_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.isOpen must be a boolean".to_string(),
        ));
    };

    Ok((modal.to_string(), *is_open))
}

fn parse_modal_close_payload(
    payload: &Value,
) -> Result<(Option<String>, String), (&'static str, String)> {
    let modal = parse_optional_non_empty_string(payload, MODAL_FIELD)?;
    let reason = parse_optional_non_empty_string(payload, REASON_FIELD)?
        .unwrap_or_else(|| DEFAULT_MODAL_CLOSE_REASON.to_string());
    Ok((modal, reason))
}

fn parse_keyboard_state_payload(
    payload: &Value,
) -> Result<(String, String, bool), (&'static str, String)> {
    let Some(payload_object) = payload.as_object() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "session.keyboard.state payload must be an object".to_string(),
        ));
    };

    let Some(Value::String(key)) = payload_object.get(KEY_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.key must be a non-empty string".to_string(),
        ));
    };
    if key.is_empty() {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.key must be a non-empty string".to_string(),
        ));
    }

    let Some(Value::String(code)) = payload_object.get(CODE_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.code must be a non-empty string".to_string(),
        ));
    };
    let trimmed_code = code.trim();
    if trimmed_code.is_empty() {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.code must be a non-empty string".to_string(),
        ));
    }

    let Some(Value::Bool(is_down)) = payload_object.get(IS_DOWN_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.isDown must be a boolean".to_string(),
        ));
    };

    Ok((key.to_string(), trimmed_code.to_string(), *is_down))
}

fn parse_required_href_payload(
    payload: &Value,
    action_name: &str,
) -> Result<String, (&'static str, String)> {
    let Some(payload_object) = payload.as_object() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            format!("{action_name} payload must be an object"),
        ));
    };

    let Some(Value::String(href)) = payload_object.get(HREF_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.href must be a non-empty string".to_string(),
        ));
    };

    let href = href.trim();
    if href.is_empty() {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.href must be a non-empty string".to_string(),
        ));
    }

    Ok(href.to_string())
}

fn update_modal_state(modal: &str, is_open: bool) {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.open_modal_stack.retain(|entry| entry != modal);
        if is_open {
            runtime.open_modal_stack.push(modal.to_string());
        }
    });
}

fn pop_modal_for_close(requested_modal: Option<&str>) -> Option<String> {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        match requested_modal {
            Some(modal) => {
                let index = runtime
                    .open_modal_stack
                    .iter()
                    .rposition(|entry| entry == modal)?;
                Some(runtime.open_modal_stack.remove(index))
            }
            None => runtime.open_modal_stack.pop(),
        }
    })
}

fn emit_modal_close(modal: String, reason: String) {
    emit_ui_event(
        event_name(event_keys::SESSION_MODAL_CLOSE),
        Some("runtime.session.modal"),
        json!({
            "modal": modal,
            "reason": reason,
        }),
    );
}

fn emit_keyboard_changed(key: String, code: String, is_down: bool) {
    emit_ui_event(
        event_name(event_keys::SESSION_KEYBOARD_CHANGED),
        Some("runtime.session.keyboard"),
        json!({
            "key": key,
            "code": code,
            "isDown": is_down,
        }),
    );
}

fn emit_lifecycle_before_unload(href: String) {
    emit_ui_event(
        event_name(event_keys::SESSION_LIFECYCLE_BEFORE_UNLOAD),
        Some("runtime.session.lifecycle"),
        json!({
            "href": href,
        }),
    );
}

fn emit_navigation_popstate(href: String) {
    emit_ui_event(
        event_name(event_keys::SESSION_NAVIGATION_POPSTATE),
        Some("runtime.session.navigation"),
        json!({
            "href": href,
        }),
    );
}

fn emit_navigation_hashchange(href: String) {
    emit_ui_event(
        event_name(event_keys::SESSION_NAVIGATION_HASHCHANGE),
        Some("runtime.session.navigation"),
        json!({
            "href": href,
        }),
    );
}

fn route_session_modal_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    let action_type = action.action_type.as_str();

    if action_matches(action_type, action_keys::SESSION_MODAL_STATE) {
        let (modal, is_open) = parse_modal_state_payload(&action.payload)?;
        update_modal_state(&modal, is_open);
        return Ok(());
    }

    if action_matches(action_type, action_keys::SESSION_MODAL_CLOSE_REQUEST) {
        let (requested_modal, reason) = parse_modal_close_payload(&action.payload)?;
        if let Some(modal) = pop_modal_for_close(requested_modal.as_deref()) {
            emit_modal_close(modal, reason);
        }
        return Ok(());
    }

    if action_matches(action_type, action_keys::SESSION_KEYBOARD_ESCAPE) {
        if let Some(modal) = pop_modal_for_close(None) {
            emit_modal_close(modal, ESCAPE_MODAL_CLOSE_REASON.to_string());
        }
        return Ok(());
    }

    Ok(())
}

fn route_session_keyboard_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    if !action_matches(
        action.action_type.as_str(),
        action_keys::SESSION_KEYBOARD_STATE,
    ) {
        return Ok(());
    }

    let (key, code, is_down) = parse_keyboard_state_payload(&action.payload)?;
    emit_keyboard_changed(key, code, is_down);
    Ok(())
}

fn route_session_navigation_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    let action_type = action.action_type.as_str();

    if action_matches(action_type, action_keys::SESSION_LIFECYCLE_BEFORE_UNLOAD) {
        let href = parse_required_href_payload(&action.payload, "session.lifecycle.before-unload")?;
        emit_lifecycle_before_unload(href);
        return Ok(());
    }

    if action_matches(action_type, action_keys::SESSION_NAVIGATION_POPSTATE) {
        let href = parse_required_href_payload(&action.payload, "session.navigation.popstate")?;
        emit_navigation_popstate(href);
        return Ok(());
    }

    if action_matches(action_type, action_keys::SESSION_NAVIGATION_HASHCHANGE) {
        let href = parse_required_href_payload(&action.payload, "session.navigation.hashchange")?;
        emit_navigation_hashchange(href);
        return Ok(());
    }

    Ok(())
}

fn route_api_action(action: &UiAction) {
    let action_type = action.action_type.as_str();
    let source = match action_type {
        _ if action_matches(action_type, action_keys::UI_READ_STATS_REQUEST)
            || action_matches(action_type, action_keys::UI_READ_STATS_RETRY)
            || action_matches(action_type, action_keys::UI_READ_STATS_ERROR) =>
        {
            Some("runtime.api.stats")
        }
        _ if action_matches(action_type, action_keys::UI_READ_GAME_INFO_REQUEST)
            || action_matches(action_type, action_keys::UI_READ_GAME_INFO_RETRY)
            || action_matches(action_type, action_keys::UI_READ_GAME_INFO_ERROR) =>
        {
            Some("runtime.api.game-info")
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_EXISTS_REQUEST)
            || action_matches(action_type, action_keys::UI_READ_LOBBY_EXISTS_RETRY)
            || action_matches(action_type, action_keys::UI_READ_LOBBY_EXISTS_ERROR) =>
        {
            Some("runtime.api.lobby.exists")
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_ARCHIVE_REQUEST)
            || action_matches(action_type, action_keys::UI_READ_LOBBY_ARCHIVE_RETRY)
            || action_matches(action_type, action_keys::UI_READ_LOBBY_ARCHIVE_ERROR) =>
        {
            Some("runtime.api.lobby.archive")
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_STATE_REQUEST)
            || action_matches(action_type, action_keys::UI_READ_LOBBY_STATE_RETRY)
            || action_matches(action_type, action_keys::UI_READ_LOBBY_STATE_ERROR) =>
        {
            Some("runtime.api.lobby.state")
        }
        _ if action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_REQUEST)
            || action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_RETRY)
            || action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_CANCEL)
            || action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_ERROR) =>
        {
            Some("runtime.api.matchmaking.search")
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_CREATE_REQUEST)
            || action_matches(action_type, action_keys::UI_MUTATE_HOST_CREATE_RETRY)
            || action_matches(action_type, action_keys::UI_MUTATE_HOST_CREATE_ERROR) =>
        {
            Some("runtime.api.host-lobby.create")
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_START_REQUEST)
            || action_matches(action_type, action_keys::UI_MUTATE_HOST_START_RETRY)
            || action_matches(action_type, action_keys::UI_MUTATE_HOST_START_ERROR) =>
        {
            Some("runtime.api.host-lobby.start")
        }
        _ if action_matches(
            action_type,
            action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_REQUEST,
        ) || action_matches(action_type, action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_RETRY)
            || action_matches(action_type, action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR) =>
        {
            Some("runtime.api.account.magic-link")
        }
        _ => None,
    };

    let Some(source) = source else {
        return;
    };

    let payload = action_payload_or_empty(action);
    match action_type {
        _ if action_matches(action_type, action_keys::UI_READ_STATS_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_STATS_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_STATS_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_STATS_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_READ_STATS_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_STATS_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_STATS_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_GAME_INFO_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_GAME_INFO_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_GAME_INFO_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_GAME_INFO_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_READ_GAME_INFO_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_GAME_INFO_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_GAME_INFO_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_EXISTS_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_EXISTS_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_EXISTS_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_EXISTS_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_EXISTS_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_EXISTS_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_EXISTS_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_ARCHIVE_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_ARCHIVE_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_ARCHIVE_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_ARCHIVE_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_ARCHIVE_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_ARCHIVE_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_ARCHIVE_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_STATE_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_STATE_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_STATE_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_STATE_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_STATE_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_READ_LOBBY_STATE_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_READ_LOBBY_STATE_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_MATCHMAKING_SEARCH_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_MATCHMAKING_SEARCH_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_MATCHMAKING_SEARCH_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_CANCEL) => {
            emit_ui_event(
                event_name(event_keys::UI_MATCHMAKING_SEARCH_CANCEL),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MATCHMAKING_SEARCH_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_MATCHMAKING_SEARCH_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_CREATE_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_CREATE_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_CREATE_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_CREATE_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_CREATE_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_CREATE_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_CREATE_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_START_REQUEST) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_START_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_START_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_START_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_START_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_HOST_START_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_HOST_START_ERROR),
                Some(source),
                payload,
            );
        }
        _ if action_matches(
            action_type,
            action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_REQUEST,
        ) =>
        {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_RETRY) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_RETRY),
                Some(source),
                payload.clone(),
            );
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_LOADING),
                Some(source),
                payload,
            );
        }
        _ if action_matches(action_type, action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR) => {
            emit_ui_event(
                event_name(event_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR),
                Some(source),
                payload,
            );
        }
        _ => {}
    }
}

fn serialize_action_payload_value(
    value: &Value,
    field_name: &str,
) -> Result<String, (&'static str, String)> {
    serde_json::to_string(value).map_err(|err| {
        (
            ERROR_INVALID_ACTION_PAYLOAD,
            format!("failed to serialize payload.{field_name}: {err}"),
        )
    })
}

fn route_ingame_component_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    let action_type = action.action_type.as_str();
    match action_type {
        _ if action_matches(action_type, action_keys::UI_HOST_LOBBY_MODAL_LAUNCH) => {
            let payload: HostLobbyModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid host lobby modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            let maps_json = serialize_action_payload_value(&payload.maps, "maps")?;
            let difficulties_json =
                serialize_action_payload_value(&payload.difficulties, "difficulties")?;
            let unit_options_json =
                serialize_action_payload_value(&payload.unit_options, "unitOptions")?;
            let team_count_options_json =
                serialize_action_payload_value(&payload.team_count_options, "teamCountOptions")?;
            crate::components::launch_host_lobby_modal(
                &translations_json,
                &maps_json,
                &difficulties_json,
                &unit_options_json,
                &team_count_options_json,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HOST_LOBBY_MODAL_SHOW) => {
            crate::components::show_host_lobby_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HOST_LOBBY_MODAL_HIDE) => {
            crate::components::hide_host_lobby_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_JOIN_PRIVATE_LOBBY_MODAL_LAUNCH) => {
            let payload: JoinPrivateLobbyModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid join private lobby modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_join_private_lobby_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_JOIN_PRIVATE_LOBBY_MODAL_OPEN) => {
            crate::components::open_join_private_lobby_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_JOIN_PRIVATE_LOBBY_MODAL_CLOSE) => {
            crate::components::close_join_private_lobby_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_JOIN_PRIVATE_LOBBY_UPDATE_LOBBY_ID,
        ) =>
        {
            let payload: JoinPrivateLobbyUpdateLobbyIdActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid join private lobby id payload: {err}"),
                    )
                })?;
            crate::components::update_join_private_lobby_id(&payload.lobby_id);
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_JOIN_PRIVATE_LOBBY_UPDATE_JOINED,
        ) =>
        {
            let payload: JoinPrivateLobbyUpdateJoinedActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid join private lobby joined payload: {err}"),
                    )
                })?;
            crate::components::update_join_private_lobby_joined(payload.has_joined);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PUBLIC_LOBBY_LAUNCH) => {
            let payload: PublicLobbyLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid public lobby launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_public_lobby(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_LAYOUT_FOOTER_LAUNCH) => {
            crate::components::launch_footer();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_LAYOUT_MAIN_LAYOUT_LAUNCH) => {
            crate::components::launch_main_layout();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_LAYOUT_MOBILE_NAV_BAR_LAUNCH) => {
            crate::components::launch_mobile_nav_bar();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_LAYOUT_DESKTOP_NAV_BAR_LAUNCH) => {
            crate::components::launch_desktop_nav_bar();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_LAYOUT_PLAY_PAGE_LAUNCH) => {
            crate::components::launch_play_page();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_ACCOUNT_MODAL_LAUNCH) => {
            let payload: AccountModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid account modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_account_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_ACCOUNT_MODAL_OPEN) => {
            crate::components::open_account_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_ACCOUNT_MODAL_CLOSE) => {
            crate::components::close_account_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_SINGLE_PLAYER_MODAL_LAUNCH,
        ) =>
        {
            let payload: SinglePlayerModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid single player modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            let maps_json = serialize_action_payload_value(&payload.maps, "maps")?;
            let difficulties_json =
                serialize_action_payload_value(&payload.difficulties, "difficulties")?;
            let unit_options_json =
                serialize_action_payload_value(&payload.unit_options, "unitOptions")?;
            let team_count_options_json =
                serialize_action_payload_value(&payload.team_count_options, "teamCountOptions")?;
            crate::components::launch_single_player_modal(
                &translations_json,
                &maps_json,
                &difficulties_json,
                &unit_options_json,
                &team_count_options_json,
            );
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_SINGLE_PLAYER_MODAL_SHOW,
        ) =>
        {
            crate::components::show_single_player_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_SINGLE_PLAYER_MODAL_HIDE,
        ) =>
        {
            crate::components::hide_single_player_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_LANG_SELECTOR_LAUNCH) => {
            let payload: LangSelectorLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid lang selector launch payload: {err}"),
                    )
                })?;
            crate::components::launch_lang_selector(&payload.initial_flag_svg);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_LANG_SELECTOR_SHOW) => {
            crate::components::show_lang_selector();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_LANG_SELECTOR_HIDE) => {
            crate::components::hide_lang_selector();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_GAME_STARTING_MODAL_LAUNCH,
        ) =>
        {
            let payload: GameStartingModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid game starting modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_game_starting_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_GAME_STARTING_MODAL_SHOW,
        ) =>
        {
            crate::components::show_game_starting_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_GAME_STARTING_MODAL_HIDE,
        ) =>
        {
            crate::components::hide_game_starting_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_LANGUAGE_MODAL_LAUNCH) => {
            let payload: LanguageModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid language modal launch payload: {err}"),
                    )
                })?;
            let language_list_json =
                serialize_action_payload_value(&payload.language_list, "languageList")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_language_modal(
                &language_list_json,
                &payload.current_lang,
                &translations_json,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_LANGUAGE_MODAL_OPEN) => {
            crate::components::open_language_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_LANGUAGE_MODAL_CLOSE) => {
            crate::components::close_language_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_FLAG_INPUT_MODAL_LAUNCH) => {
            let payload: FlagInputModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid flag input modal launch payload: {err}"),
                    )
                })?;
            let countries_json = serialize_action_payload_value(&payload.countries, "countries")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_flag_input_modal(&countries_json, &translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_FLAG_INPUT_MODAL_OPEN) => {
            crate::components::open_flag_input_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_FLAG_INPUT_MODAL_CLOSE) => {
            crate::components::close_flag_input_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_TOKEN_LOGIN_MODAL_LAUNCH,
        ) =>
        {
            let payload: TokenLoginModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid token login modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_token_login_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_TOKEN_LOGIN_MODAL_OPEN) => {
            crate::components::open_token_login_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_TOKEN_LOGIN_MODAL_CLOSE) => {
            crate::components::close_token_login_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_NEWS_MODAL_LAUNCH) => {
            let payload: NewsModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid news modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_news_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_NEWS_MODAL_OPEN) => {
            crate::components::open_news_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_NEWS_MODAL_CLOSE) => {
            crate::components::close_news_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_HELP_MODAL_LAUNCH) => {
            let payload: HelpModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid help modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_help_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_HELP_MODAL_OPEN) => {
            crate::components::open_help_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_HELP_MODAL_CLOSE) => {
            crate::components::close_help_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_FLAG_INPUT_LAUNCH) => {
            let payload: FlagInputLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid flag input launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_flag_input(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_PATTERN_INPUT_LAUNCH) => {
            let payload: PatternInputLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid pattern input launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_pattern_input(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_USERNAME_INPUT_LAUNCH) => {
            let payload: UsernameInputLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid username input launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_username_input(&translations_json);
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_TERRITORY_PATTERNS_MODAL_LAUNCH,
        ) =>
        {
            let payload: ProfileModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid territory patterns modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_territory_patterns_modal(&state_json, &translations_json);
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_USER_SETTING_MODAL_LAUNCH,
        ) =>
        {
            let payload: ProfileModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid user setting modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_user_setting_modal(&state_json, &translations_json);
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_PROFILE_MATCHMAKING_MODAL_LAUNCH,
        ) =>
        {
            let payload: ProfileModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid matchmaking modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_matchmaking_modal(&state_json, &translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_STATS_MODAL_LAUNCH) => {
            let payload: ProfileModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid stats modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_stats_modal(&state_json, &translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_GAME_INFO_MODAL_LAUNCH) => {
            let payload: ProfileModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid game info modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_game_info_modal(&state_json, &translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_PROFILE_GAME_INFO_MODAL_HIDE) => {
            crate::components::hide_game_info_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_BUILD_MENU_LAUNCH) => {
            let payload: BuildMenuLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid build menu launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_build_menu(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_BUILD_MENU_SHOW) => {
            let payload: BuildMenuShowActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid build menu show payload: {err}"),
                    )
                })?;
            let items_json = serialize_action_payload_value(&payload.items, "items")?;
            crate::components::show_build_menu(&items_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_BUILD_MENU_HIDE) => {
            crate::components::hide_build_menu();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_RADIAL_MENU_LAUNCH) => {
            let payload: RadialMenuLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid radial menu launch payload: {err}"),
                    )
                })?;
            let config_json = serialize_action_payload_value(&payload.config, "config")?;
            crate::components::launch_radial_menu(&config_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_RADIAL_MENU_SHOW) => {
            let payload: RadialMenuShowActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid radial menu show payload: {err}"),
                    )
                })?;
            let items_json = serialize_action_payload_value(&payload.items, "items")?;
            let center_button_json =
                serialize_action_payload_value(&payload.center_button, "centerButton")?;
            crate::components::show_radial_menu(
                &items_json,
                &center_button_json,
                payload.x,
                payload.y,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_RADIAL_MENU_UPDATE_ITEMS) => {
            let payload: RadialMenuUpdateItemsActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid radial menu update payload: {err}"),
                    )
                })?;
            let items_json = serialize_action_payload_value(&payload.items, "items")?;
            let center_button_json =
                serialize_action_payload_value(&payload.center_button, "centerButton")?;
            crate::components::update_radial_items(&items_json, &center_button_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_RADIAL_MENU_PUSH_SUBMENU) => {
            let payload: RadialMenuPushSubmenuActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid radial menu submenu payload: {err}"),
                    )
                })?;
            let items_json = serialize_action_payload_value(&payload.items, "items")?;
            crate::components::push_submenu(&items_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_RADIAL_MENU_POP_SUBMENU) => {
            crate::components::pop_submenu();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_RADIAL_MENU_HIDE) => {
            crate::components::hide_radial_menu();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_WIN_MODAL_LAUNCH) => {
            let payload: WinModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid win modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_win_modal(
                &translations_json,
                payload.is_in_iframe,
                payload.games_played,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_WIN_MODAL_SHOW) => {
            let payload: WinModalShowActionPayload = serde_json::from_value(action.payload.clone())
                .map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid win modal show payload: {err}"),
                    )
                })?;
            let content_type_json =
                serde_json::to_string(&payload.content_type).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("failed to serialize payload.contentType: {err}"),
                    )
                })?;
            let cosmetics_json = serialize_action_payload_value(&payload.cosmetics, "cosmetics")?;
            crate::components::show_win_modal(
                &payload.title,
                payload.is_win,
                &content_type_json,
                &cosmetics_json,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_WIN_MODAL_HIDE) => {
            crate::components::hide_win_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_WIN_MODAL_UPDATE_COSMETICS,
        ) =>
        {
            let payload: WinModalUpdateCosmeticsActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid win modal cosmetics payload: {err}"),
                    )
                })?;
            let cosmetics_json = serialize_action_payload_value(&payload.cosmetics, "cosmetics")?;
            crate::components::update_win_modal_cosmetics(&cosmetics_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_EVENTS_DISPLAY_LAUNCH) => {
            crate::components::launch_events_display();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_CHAT_DISPLAY_LAUNCH) => {
            crate::components::launch_chat_display();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_CONTROL_PANEL_LAUNCH) => {
            crate::components::launch_control_panel();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_EMOJI_TABLE_LAUNCH) => {
            let payload: EmojiTableLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid emoji table launch payload: {err}"),
                    )
                })?;
            let emojis_json = serialize_action_payload_value(&payload.emojis, "emojis")?;
            crate::components::launch_emoji_table(&emojis_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_EMOJI_TABLE_SHOW) => {
            crate::components::show_emoji_table();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_EMOJI_TABLE_HIDE) => {
            crate::components::hide_emoji_table();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_UNIT_DISPLAY_LAUNCH) => {
            crate::components::launch_unit_display();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_SPAWN_TIMER_LAUNCH) => {
            crate::components::launch_spawn_timer();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_SPAWN_TIMER_SHOW) => {
            crate::components::show_spawn_timer();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_IMMUNITY_TIMER_LAUNCH) => {
            crate::components::launch_immunity_timer();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_HEADS_UP_MESSAGE_LAUNCH) => {
            crate::components::launch_heads_up_message();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_HEADS_UP_TOAST_SHOW) => {
            let payload: HeadsUpToastShowActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid heads up toast payload: {err}"),
                    )
                })?;
            crate::components::show_heads_up_toast(&payload.message, &payload.color);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_HEADS_UP_TOAST_HIDE) => {
            crate::components::hide_heads_up_toast();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_HUD_ALERT_FRAME_LAUNCH) => {
            crate::components::launch_alert_frame();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_GAME_LEFT_SIDEBAR_LAUNCH) => {
            crate::components::launch_game_left_sidebar();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_REPLAY_PANEL_LAUNCH) => {
            crate::components::launch_replay_panel();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_GAME_RIGHT_SIDEBAR_LAUNCH,
        ) =>
        {
            crate::components::launch_game_right_sidebar();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_PLAYER_PANEL_LAUNCH) => {
            crate::components::launch_player_panel();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_PLAYER_INFO_OVERLAY_LAUNCH,
        ) =>
        {
            crate::components::launch_player_info_overlay();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_PERFORMANCE_OVERLAY_LAUNCH,
        ) =>
        {
            crate::components::launch_performance_overlay();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_FULL_SETTINGS_MODAL_LAUNCH,
        ) =>
        {
            let payload: FullSettingsModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid full settings modal launch payload: {err}"),
                    )
                })?;
            let settings_json = serialize_action_payload_value(&payload.settings, "settings")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            let icons_json = serialize_action_payload_value(&payload.icons, "icons")?;
            crate::components::launch_full_settings_modal(
                &settings_json,
                &translations_json,
                &icons_json,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_LEADERBOARD_LAUNCH) => {
            let payload: LeaderboardLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid leaderboard launch payload: {err}"),
                    )
                })?;
            let entries_json = serialize_action_payload_value(&payload.entries, "entries")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_leaderboard(
                &entries_json,
                &translations_json,
                payload.show_top_five,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_TEAM_STATS_LAUNCH) => {
            let payload: TeamStatsLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid team stats launch payload: {err}"),
                    )
                })?;
            let entries_json = serialize_action_payload_value(&payload.entries, "entries")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_team_stats(&entries_json, &translations_json);
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_SEND_RESOURCE_MODAL_LAUNCH,
        ) =>
        {
            let payload: SendResourceModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid send resource modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_send_resource_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_SEND_RESOURCE_MODAL_SHOW) => {
            let payload: SendResourceModalShowActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid send resource modal show payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            crate::components::show_send_resource_modal(&state_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_SEND_RESOURCE_MODAL_HIDE) => {
            crate::components::hide_send_resource_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_MULTI_TAB_MODAL_LAUNCH) => {
            let payload: MultiTabModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid multi-tab modal launch payload: {err}"),
                    )
                })?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_multi_tab_modal(&translations_json);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_MULTI_TAB_MODAL_SHOW) => {
            let payload: MultiTabModalShowActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid multi-tab modal show payload: {err}"),
                    )
                })?;
            crate::components::show_multi_tab_modal(payload.duration_ms);
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_MULTI_TAB_MODAL_HIDE) => {
            crate::components::hide_multi_tab_modal();
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_CHAT_MODAL_LAUNCH) => {
            let payload: ChatModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid chat modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let players_json = serialize_action_payload_value(&payload.players, "players")?;
            let quick_chat_phrases_json =
                serialize_action_payload_value(&payload.quick_chat_phrases, "quickChatPhrases")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            let phrase_translations_json =
                serialize_action_payload_value(&payload.phrase_translations, "phraseTranslations")?;
            crate::components::launch_chat_modal(
                &state_json,
                &players_json,
                &quick_chat_phrases_json,
                &translations_json,
                &phrase_translations_json,
            );
            Ok(())
        }
        _ if action_matches(action_type, action_keys::UI_INGAME_CHAT_MODAL_CLOSE) => {
            crate::components::close_chat_modal();
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_CHAT_MODAL_OPEN_WITH_SELECTION,
        ) =>
        {
            let payload: ChatModalOpenWithSelectionActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid chat modal open-with-selection payload: {err}"),
                    )
                })?;
            crate::components::open_chat_modal_with_selection(
                &payload.category_id,
                &payload.phrase_key,
            );
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_PLAYER_MODERATION_MODAL_LAUNCH,
        ) =>
        {
            let payload: PlayerModerationModalLaunchActionPayload =
                serde_json::from_value(action.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_ACTION_PAYLOAD,
                        format!("invalid player moderation modal launch payload: {err}"),
                    )
                })?;
            let state_json = serialize_action_payload_value(&payload.state, "state")?;
            let my_player_json = serialize_action_payload_value(&payload.my_player, "myPlayer")?;
            let target_player_json =
                serialize_action_payload_value(&payload.target_player, "targetPlayer")?;
            let translations_json =
                serialize_action_payload_value(&payload.translations, "translations")?;
            crate::components::launch_player_moderation_modal(
                &state_json,
                &my_player_json,
                &target_player_json,
                &translations_json,
                &payload.kick_icon,
                &payload.shield_icon,
            );
            Ok(())
        }
        _ if action_matches(
            action_type,
            action_keys::UI_INGAME_PLAYER_MODERATION_MODAL_CLOSE,
        ) =>
        {
            crate::components::close_player_moderation_modal();
            Ok(())
        }
        _ => Ok(()),
    }
}

fn parse_storage_key_with_default(
    payload: &Value,
    default_storage_key: Option<&str>,
    action_name: &str,
) -> Result<String, (&'static str, String)> {
    if payload.is_null() {
        if let Some(default_storage_key) = default_storage_key {
            return Ok(default_storage_key.to_string());
        }
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            format!("action payload must be an object for {action_name}"),
        ));
    }

    let Some(payload_object) = payload.as_object() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            format!("action payload must be an object for {action_name}"),
        ));
    };

    match payload_object.get(STORAGE_KEY_FIELD) {
        None | Some(Value::Null) => {
            if let Some(default_storage_key) = default_storage_key {
                Ok(default_storage_key.to_string())
            } else {
                Err((
                    ERROR_INVALID_ACTION_PAYLOAD,
                    format!("payload.storageKey is required for {action_name}"),
                ))
            }
        }
        Some(Value::String(storage_key)) => {
            let trimmed = storage_key.trim();
            if trimmed.is_empty() {
                return Err((
                    ERROR_INVALID_ACTION_PAYLOAD,
                    "payload.storageKey must be a non-empty string".to_string(),
                ));
            }
            Ok(trimmed.to_string())
        }
        Some(_) => Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.storageKey must be a non-empty string".to_string(),
        )),
    }
}

fn parse_storage_key_from_payload(payload: &Value) -> Result<String, (&'static str, String)> {
    parse_storage_key_with_default(
        payload,
        Some(DEFAULT_LANGUAGE_STORAGE_KEY),
        "session language actions",
    )
}

fn parse_required_storage_key_from_payload(
    payload: &Value,
    action_name: &str,
) -> Result<String, (&'static str, String)> {
    parse_storage_key_with_default(payload, None, action_name)
}

fn parse_language_write_payload(
    payload: &Value,
) -> Result<(String, String), (&'static str, String)> {
    let storage_key = parse_storage_key_from_payload(payload)?;
    let Some(payload_object) = payload.as_object() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "action payload must be an object for session.language.write".to_string(),
        ));
    };

    let Some(language_value) = payload_object.get(LANGUAGE_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.lang is required for session.language.write".to_string(),
        ));
    };

    let Some(language) = language_value.as_str() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.lang must be a non-empty string".to_string(),
        ));
    };

    let trimmed = language.trim();
    if trimmed.is_empty() {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.lang must be a non-empty string".to_string(),
        ));
    }

    Ok((storage_key, trimmed.to_string()))
}

fn parse_session_storage_write_payload(
    payload: &Value,
) -> Result<(String, String), (&'static str, String)> {
    let storage_key = parse_required_storage_key_from_payload(payload, "session.storage.write")?;
    let Some(payload_object) = payload.as_object() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "action payload must be an object for session.storage.write".to_string(),
        ));
    };

    let Some(value) = payload_object.get(STORAGE_VALUE_FIELD) else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.value is required for session.storage.write".to_string(),
        ));
    };

    let Some(value) = value.as_str() else {
        return Err((
            ERROR_INVALID_ACTION_PAYLOAD,
            "payload.value must be a string".to_string(),
        ));
    };

    Ok((storage_key, value.to_string()))
}

#[cfg(target_arch = "wasm32")]
fn read_local_storage_value(storage_key: &str) -> Result<Option<String>, (&'static str, String)> {
    let Some(window) = web_sys::window() else {
        return Err((
            ERROR_STORAGE_UNAVAILABLE,
            "window is unavailable while reading localStorage".to_string(),
        ));
    };

    let storage = window
        .local_storage()
        .map_err(|err| {
            (
                ERROR_STORAGE_OPERATION_FAILED,
                format!("failed to access localStorage: {err:?}"),
            )
        })?
        .ok_or_else(|| {
            (
                ERROR_STORAGE_UNAVAILABLE,
                "localStorage is unavailable for this document".to_string(),
            )
        })?;

    storage.get_item(storage_key).map_err(|err| {
        (
            ERROR_STORAGE_OPERATION_FAILED,
            format!("failed to read localStorage key `{storage_key}`: {err:?}"),
        )
    })
}

#[cfg(not(target_arch = "wasm32"))]
fn read_local_storage_value(_storage_key: &str) -> Result<Option<String>, (&'static str, String)> {
    Err((
        ERROR_STORAGE_UNAVAILABLE,
        "localStorage is only available in wasm builds".to_string(),
    ))
}

#[cfg(target_arch = "wasm32")]
fn write_local_storage_value(storage_key: &str, value: &str) -> Result<(), (&'static str, String)> {
    let Some(window) = web_sys::window() else {
        return Err((
            ERROR_STORAGE_UNAVAILABLE,
            "window is unavailable while writing localStorage".to_string(),
        ));
    };

    let storage = window
        .local_storage()
        .map_err(|err| {
            (
                ERROR_STORAGE_OPERATION_FAILED,
                format!("failed to access localStorage: {err:?}"),
            )
        })?
        .ok_or_else(|| {
            (
                ERROR_STORAGE_UNAVAILABLE,
                "localStorage is unavailable for this document".to_string(),
            )
        })?;

    storage.set_item(storage_key, value).map_err(|err| {
        (
            ERROR_STORAGE_OPERATION_FAILED,
            format!("failed to write localStorage key `{storage_key}`: {err:?}"),
        )
    })
}

#[cfg(target_arch = "wasm32")]
fn remove_local_storage_value(storage_key: &str) -> Result<(), (&'static str, String)> {
    let Some(window) = web_sys::window() else {
        return Err((
            ERROR_STORAGE_UNAVAILABLE,
            "window is unavailable while removing localStorage".to_string(),
        ));
    };

    let storage = window
        .local_storage()
        .map_err(|err| {
            (
                ERROR_STORAGE_OPERATION_FAILED,
                format!("failed to access localStorage: {err:?}"),
            )
        })?
        .ok_or_else(|| {
            (
                ERROR_STORAGE_UNAVAILABLE,
                "localStorage is unavailable for this document".to_string(),
            )
        })?;

    storage.remove_item(storage_key).map_err(|err| {
        (
            ERROR_STORAGE_OPERATION_FAILED,
            format!("failed to remove localStorage key `{storage_key}`: {err:?}"),
        )
    })
}

#[cfg(not(target_arch = "wasm32"))]
fn write_local_storage_value(
    _storage_key: &str,
    _value: &str,
) -> Result<(), (&'static str, String)> {
    Err((
        ERROR_STORAGE_UNAVAILABLE,
        "localStorage is only available in wasm builds".to_string(),
    ))
}

#[cfg(not(target_arch = "wasm32"))]
fn remove_local_storage_value(_storage_key: &str) -> Result<(), (&'static str, String)> {
    Err((
        ERROR_STORAGE_UNAVAILABLE,
        "localStorage is only available in wasm builds".to_string(),
    ))
}

fn route_session_language_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    match action.action_type.as_str() {
        _ if action_matches(
            action.action_type.as_str(),
            action_keys::SESSION_LANGUAGE_READ,
        ) =>
        {
            let storage_key = parse_storage_key_from_payload(&action.payload)?;
            let lang = read_local_storage_value(&storage_key)?;
            emit_ui_event(
                event_name(event_keys::SESSION_LANGUAGE_READ_RESULT),
                Some("runtime.session.language"),
                json!({
                    "storageKey": storage_key,
                    "lang": lang,
                }),
            );
            Ok(())
        }
        _ if action_matches(
            action.action_type.as_str(),
            action_keys::SESSION_LANGUAGE_WRITE,
        ) =>
        {
            let (storage_key, lang) = parse_language_write_payload(&action.payload)?;
            write_local_storage_value(&storage_key, &lang)?;
            emit_ui_event(
                event_name(event_keys::SESSION_LANGUAGE_CHANGED),
                Some("runtime.session.language"),
                json!({
                    "storageKey": storage_key,
                    "lang": lang,
                }),
            );
            Ok(())
        }
        _ => Ok(()),
    }
}

fn route_session_storage_action(action: &UiAction) -> Result<(), (&'static str, String)> {
    match action.action_type.as_str() {
        _ if action_matches(
            action.action_type.as_str(),
            action_keys::SESSION_STORAGE_READ,
        ) =>
        {
            let storage_key =
                parse_required_storage_key_from_payload(&action.payload, "session.storage.read")?;
            let value = read_local_storage_value(&storage_key)?;
            emit_ui_event(
                event_name(event_keys::SESSION_STORAGE_READ_RESULT),
                Some("runtime.session.storage"),
                json!({
                    "storageKey": storage_key,
                    "value": value,
                }),
            );
            Ok(())
        }
        _ if action_matches(
            action.action_type.as_str(),
            action_keys::SESSION_STORAGE_WRITE,
        ) =>
        {
            let (storage_key, value) = parse_session_storage_write_payload(&action.payload)?;
            write_local_storage_value(&storage_key, &value)?;
            emit_ui_event(
                event_name(event_keys::SESSION_STORAGE_CHANGED),
                Some("runtime.session.storage"),
                json!({
                    "storageKey": storage_key,
                    "value": value,
                }),
            );
            Ok(())
        }
        _ if action_matches(
            action.action_type.as_str(),
            action_keys::SESSION_STORAGE_REMOVE,
        ) =>
        {
            let storage_key =
                parse_required_storage_key_from_payload(&action.payload, "session.storage.remove")?;
            remove_local_storage_value(&storage_key)?;
            emit_ui_event(
                event_name(event_keys::SESSION_STORAGE_CHANGED),
                Some("runtime.session.storage"),
                json!({
                    "storageKey": storage_key,
                    "value": Value::Null,
                }),
            );
            Ok(())
        }
        _ => Ok(()),
    }
}

fn serialize_ingame_state_payload(
    snapshot: &UiSnapshot,
    snapshot_label: &str,
) -> Result<String, (&'static str, String)> {
    let payload: InGameStateSnapshotPayload = serde_json::from_value(snapshot.payload.clone())
        .map_err(|err| {
            (
                ERROR_INVALID_SNAPSHOT_PAYLOAD,
                format!("invalid {snapshot_label} snapshot payload: {err}"),
            )
        })?;

    serde_json::to_string(&payload.state).map_err(|err| {
        (
            ERROR_INVALID_SNAPSHOT_PAYLOAD,
            format!("failed to serialize {snapshot_label} snapshot state: {err}"),
        )
    })
}

fn apply_ingame_state_snapshot(
    snapshot: &UiSnapshot,
    snapshot_key: &str,
    snapshot_label: &str,
    update_component: fn(&str),
) -> Result<bool, (&'static str, String)> {
    if !snapshot_matches(snapshot.snapshot_type.as_str(), snapshot_key) {
        return Ok(false);
    }

    let serialized_state = serialize_ingame_state_payload(snapshot, snapshot_label)?;
    update_component(&serialized_state);
    Ok(true)
}

fn serialize_ingame_entries_payload(
    snapshot: &UiSnapshot,
    snapshot_label: &str,
) -> Result<String, (&'static str, String)> {
    let payload: InGameEntriesSnapshotPayload = serde_json::from_value(snapshot.payload.clone())
        .map_err(|err| {
            (
                ERROR_INVALID_SNAPSHOT_PAYLOAD,
                format!("invalid {snapshot_label} snapshot payload: {err}"),
            )
        })?;

    serde_json::to_string(&payload.entries).map_err(|err| {
        (
            ERROR_INVALID_SNAPSHOT_PAYLOAD,
            format!("failed to serialize {snapshot_label} snapshot entries: {err}"),
        )
    })
}

fn serialize_snapshot_state_value(
    value: &Value,
    snapshot_label: &str,
    field_name: &str,
) -> Result<String, (&'static str, String)> {
    serde_json::to_string(value).map_err(|err| {
        (
            ERROR_INVALID_SNAPSHOT_PAYLOAD,
            format!("failed to serialize {snapshot_label} field `{field_name}`: {err}"),
        )
    })
}

fn apply_ingame_entries_snapshot(
    snapshot: &UiSnapshot,
    snapshot_key: &str,
    snapshot_label: &str,
    update_component: fn(&str),
) -> Result<bool, (&'static str, String)> {
    if !snapshot_matches(snapshot.snapshot_type.as_str(), snapshot_key) {
        return Ok(false);
    }

    let serialized_entries = serialize_ingame_entries_payload(snapshot, snapshot_label)?;
    update_component(&serialized_entries);
    Ok(true)
}

fn apply_hud_snapshot(snapshot: &UiSnapshot) -> Result<(), (&'static str, String)> {
    match snapshot.snapshot_type.as_str() {
        _ if snapshot_matches(
            snapshot.snapshot_type.as_str(),
            snapshot_keys::UI_SNAPSHOT_HUD_SPAWN_TIMER,
        ) =>
        {
            let payload: SpawnTimerSnapshotPayload =
                serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_SNAPSHOT_PAYLOAD,
                        format!("invalid spawn timer snapshot payload: {err}"),
                    )
                })?;

            if payload.visible {
                crate::components::show_spawn_timer();
            } else {
                crate::components::hide_spawn_timer();
            }

            let serialized_segments = serde_json::to_string(&payload.segments).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("failed to serialize spawn timer segments: {err}"),
                )
            })?;
            crate::components::update_spawn_timer(&serialized_segments);
            Ok(())
        }
        _ if snapshot_matches(
            snapshot.snapshot_type.as_str(),
            snapshot_keys::UI_SNAPSHOT_HUD_IMMUNITY_TIMER,
        ) =>
        {
            let payload: ImmunityTimerSnapshotPayload =
                serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_SNAPSHOT_PAYLOAD,
                        format!("invalid immunity timer snapshot payload: {err}"),
                    )
                })?;

            if payload.active {
                crate::components::show_immunity_timer();
                crate::components::update_immunity_timer(
                    payload.progress_ratio,
                    &payload.top_offset,
                );
            } else {
                crate::components::hide_immunity_timer();
            }
            Ok(())
        }
        _ if snapshot_matches(
            snapshot.snapshot_type.as_str(),
            snapshot_keys::UI_SNAPSHOT_HUD_HEADS_UP_MESSAGE,
        ) =>
        {
            let payload: HeadsUpSnapshotPayload = serde_json::from_value(snapshot.payload.clone())
                .map_err(|err| {
                    (
                        ERROR_INVALID_SNAPSHOT_PAYLOAD,
                        format!("invalid heads-up snapshot payload: {err}"),
                    )
                })?;
            crate::components::update_heads_up_message(payload.is_visible, &payload.message);
            Ok(())
        }
        _ if snapshot_matches(
            snapshot.snapshot_type.as_str(),
            snapshot_keys::UI_SNAPSHOT_HUD_ALERT_FRAME,
        ) =>
        {
            let payload: AlertFrameSnapshotPayload =
                serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                    (
                        ERROR_INVALID_SNAPSHOT_PAYLOAD,
                        format!("invalid alert frame snapshot payload: {err}"),
                    )
                })?;

            match payload.action.as_str() {
                "show" => {
                    let alert_type = payload
                        .alert_type
                        .unwrap_or_else(|| "land-attack".to_string());
                    crate::components::show_alert_frame(&alert_type);
                    Ok(())
                }
                "hide" => {
                    crate::components::hide_alert_frame();
                    Ok(())
                }
                other => Err((
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid alert frame action: {other}"),
                )),
            }
        }
        _ => Ok(()),
    }
}

fn apply_ingame_snapshot(snapshot: &UiSnapshot) -> Result<(), (&'static str, String)> {
    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_CONTROL_PANEL,
        "ingame control panel",
        crate::components::update_control_panel,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_UNIT_DISPLAY,
        "ingame unit display",
        crate::components::update_unit_display,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_REPLAY_PANEL,
        "ingame replay panel",
        crate::components::update_replay_panel,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_GAME_LEFT_SIDEBAR,
        "ingame game left sidebar",
        crate::components::update_game_left_sidebar,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_GAME_RIGHT_SIDEBAR,
        "ingame game right sidebar",
        crate::components::update_game_right_sidebar,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_CHAT_DISPLAY,
        "ingame chat display",
        crate::components::update_chat_display,
    )? {
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_INGAME_CHAT_MODAL_PLAYERS,
    ) {
        let payload: ChatModalPlayersSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid ingame chat modal players snapshot payload: {err}"),
                )
            })?;
        let players_json = serde_json::to_string(&payload.players).map_err(|err| {
            (
                ERROR_INVALID_SNAPSHOT_PAYLOAD,
                format!("failed to serialize ingame chat modal players snapshot: {err}"),
            )
        })?;
        crate::components::update_chat_modal_players(&players_json);
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_EVENTS_DISPLAY,
        "ingame events display",
        crate::components::update_events_display,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_PLAYER_PANEL,
        "ingame player panel",
        crate::components::update_player_panel,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_PLAYER_INFO_OVERLAY,
        "ingame player info overlay",
        crate::components::update_player_info_overlay,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_PERFORMANCE_OVERLAY,
        "ingame performance overlay",
        crate::components::update_performance_overlay,
    )? {
        return Ok(());
    }

    if apply_ingame_entries_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_LEADERBOARD_ENTRIES,
        "ingame leaderboard entries",
        crate::components::update_leaderboard_entries,
    )? {
        return Ok(());
    }

    if apply_ingame_entries_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_INGAME_TEAM_STATS_ENTRIES,
        "ingame team stats entries",
        crate::components::update_team_stats_entries,
    )? {
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_INGAME_SEND_RESOURCE_TOTAL,
    ) {
        let payload: SendResourceTotalSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid ingame send resource total snapshot payload: {err}"),
                )
            })?;
        crate::components::update_send_resource_total(
            payload.total,
            &payload.mode,
            payload.capacity_left,
            payload.has_capacity,
            payload.target_alive,
            payload.sender_alive,
        );
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_LOBBY_HOST_PLAYERS,
    ) {
        let payload: HostLobbyPlayersSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid lobby host players snapshot payload: {err}"),
                )
            })?;
        let players_json = serde_json::to_string(&payload.players).map_err(|err| {
            (
                ERROR_INVALID_SNAPSHOT_PAYLOAD,
                format!("failed to serialize lobby host players snapshot: {err}"),
            )
        })?;
        crate::components::update_host_lobby_players(&players_json);
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_LOBBY_JOIN_PRIVATE_CONFIG_HTML,
    ) {
        let payload: JoinPrivateLobbyHtmlSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid lobby join private config html snapshot payload: {err}"),
                )
            })?;
        crate::components::update_join_private_lobby_config_html(&payload.html);
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_LOBBY_JOIN_PRIVATE_PLAYERS_HTML,
    ) {
        let payload: JoinPrivateLobbyHtmlSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid lobby join private players html snapshot payload: {err}"),
                )
            })?;
        crate::components::update_join_private_lobby_players_html(&payload.html);
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_LOBBY_PUBLIC_DATA,
    ) {
        let payload: PublicLobbyDataSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid lobby public data snapshot payload: {err}"),
                )
            })?;
        let data_json = serde_json::to_string(&payload.data).map_err(|err| {
            (
                ERROR_INVALID_SNAPSHOT_PAYLOAD,
                format!("failed to serialize lobby public data snapshot: {err}"),
            )
        })?;
        crate::components::update_public_lobby_data(&data_json);
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_LOBBY_PUBLIC_JOINING,
    ) {
        let payload: PublicLobbyJoiningSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid lobby public joining snapshot payload: {err}"),
                )
            })?;
        let state_json = serde_json::to_string(&payload.state).map_err(|err| {
            (
                ERROR_INVALID_SNAPSHOT_PAYLOAD,
                format!("failed to serialize lobby public joining snapshot: {err}"),
            )
        })?;
        crate::components::update_public_lobby_joining(&state_json);
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_LAYOUT_FOOTER_STATE,
        "layout footer",
        crate::components::update_footer,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_LAYOUT_MAIN_LAYOUT_STATE,
        "layout main layout",
        crate::components::update_main_layout,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_LAYOUT_MOBILE_NAV_BAR_STATE,
        "layout mobile nav bar",
        crate::components::update_mobile_nav_bar,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_LAYOUT_DESKTOP_NAV_BAR_STATE,
        "layout desktop nav bar",
        crate::components::update_desktop_nav_bar,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_LAYOUT_PLAY_PAGE_STATE,
        "layout play page",
        crate::components::update_play_page,
    )? {
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_ACCOUNT_MODAL_STATE,
    ) {
        let payload: AccountModalStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile account modal state snapshot payload: {err}"),
                )
            })?;
        if let Some(loading) = payload.state.loading {
            crate::components::update_account_modal_loading(loading);
        }
        if let Some(content_html) = payload.state.content_html {
            crate::components::update_account_modal_content(&content_html);
        }
        if let Some(header_right_html) = payload.state.header_right_html {
            crate::components::update_account_modal_header_right(&header_right_html);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_SINGLE_PLAYER_MODAL_STATE,
    ) {
        let payload: SinglePlayerModalStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile single player modal state snapshot payload: {err}"),
                )
            })?;
        if let Some(form) = payload.state.form {
            let form_json = serialize_snapshot_state_value(
                &form,
                "profile single player modal state snapshot",
                "form",
            )?;
            crate::components::update_single_player_form(&form_json);
        }
        if let Some(achievements) = payload.state.achievements {
            let achievements_json = serialize_snapshot_state_value(
                &achievements,
                "profile single player modal state snapshot",
                "achievements",
            )?;
            crate::components::update_single_player_achievements(&achievements_json);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_LANG_SELECTOR_STATE,
    ) {
        let payload: LangSelectorStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile lang selector state snapshot payload: {err}"),
                )
            })?;
        if let Some(flag_svg) = payload.state.flag_svg {
            crate::components::update_lang_selector_flag(&flag_svg);
        }
        if let Some(is_visible) = payload.state.is_visible {
            if is_visible {
                crate::components::show_lang_selector();
            } else {
                crate::components::hide_lang_selector();
            }
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_TOKEN_LOGIN_MODAL_STATE,
    ) {
        let payload: TokenLoginModalStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile token login modal state snapshot payload: {err}"),
                )
            })?;
        if let Some(email) = payload.state.email {
            crate::components::update_token_login_email(&email);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_NEWS_MODAL_STATE,
    ) {
        let payload: NewsModalStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile news modal state snapshot payload: {err}"),
                )
            })?;
        if let Some(content_html) = payload.state.content_html {
            crate::components::update_news_modal_content(&content_html);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_HELP_MODAL_STATE,
    ) {
        let payload: HelpModalStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile help modal state snapshot payload: {err}"),
                )
            })?;
        if let Some(content_html) = payload.state.content_html {
            crate::components::update_help_modal_content(&content_html);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_FLAG_INPUT_STATE,
    ) {
        let payload: FlagInputStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile flag input state snapshot payload: {err}"),
                )
            })?;
        if let Some(flag) = payload.state.flag {
            crate::components::update_flag_input(&flag);
        }
        if let Some(show_select_label) = payload.state.show_select_label {
            crate::components::update_flag_input_show_select_label(show_select_label);
        }
        if let Some(translations) = payload.state.translations {
            let translations_json = serialize_snapshot_state_value(
                &translations,
                "profile flag input state snapshot",
                "translations",
            )?;
            crate::components::update_flag_input_translations(&translations_json);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_PATTERN_INPUT_STATE,
    ) {
        let payload: PatternInputStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile pattern input state snapshot payload: {err}"),
                )
            })?;
        if let Some(preview_url) = payload.state.preview_url {
            crate::components::update_pattern_input_preview(&preview_url);
        }
        if let Some(show_select_label) = payload.state.show_select_label {
            crate::components::update_pattern_input_show_select_label(show_select_label);
        }
        if let Some(loading) = payload.state.loading {
            crate::components::update_pattern_input_loading(loading);
        }
        if let Some(translations) = payload.state.translations {
            let translations_json = serialize_snapshot_state_value(
                &translations,
                "profile pattern input state snapshot",
                "translations",
            )?;
            crate::components::update_pattern_input_translations(&translations_json);
        }
        return Ok(());
    }

    if snapshot_matches(
        snapshot.snapshot_type.as_str(),
        snapshot_keys::UI_SNAPSHOT_PROFILE_USERNAME_INPUT_STATE,
    ) {
        let payload: UsernameInputStateSnapshotPayload =
            serde_json::from_value(snapshot.payload.clone()).map_err(|err| {
                (
                    ERROR_INVALID_SNAPSHOT_PAYLOAD,
                    format!("invalid profile username input state snapshot payload: {err}"),
                )
            })?;
        if let Some(clan_tag) = payload.state.clan_tag {
            crate::components::update_username_input_clan_tag(&clan_tag);
        }
        if let Some(username) = payload.state.username {
            crate::components::update_username_input_username(&username);
        }
        if let Some(validation_error) = payload.state.validation_error {
            crate::components::update_username_input_validation_error(&validation_error);
        }
        if let Some(translations) = payload.state.translations {
            let translations_json = serialize_snapshot_state_value(
                &translations,
                "profile username input state snapshot",
                "translations",
            )?;
            crate::components::update_username_input_translations(&translations_json);
        }
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_PROFILE_TERRITORY_PATTERNS_MODAL_STATE,
        "profile territory patterns modal state",
        crate::components::update_territory_patterns_modal,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_PROFILE_USER_SETTING_MODAL_STATE,
        "profile user setting modal state",
        crate::components::update_user_setting_modal,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_PROFILE_MATCHMAKING_MODAL_STATE,
        "profile matchmaking modal state",
        crate::components::update_matchmaking_state,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_PROFILE_STATS_MODAL_STATE,
        "profile stats modal state",
        crate::components::update_stats_modal,
    )? {
        return Ok(());
    }

    if apply_ingame_state_snapshot(
        snapshot,
        snapshot_keys::UI_SNAPSHOT_PROFILE_GAME_INFO_MODAL_STATE,
        "profile game info modal state",
        crate::components::update_game_info_modal,
    )? {
        return Ok(());
    }

    Ok(())
}

pub fn emit_ui_event(event_type: &str, source: Option<&str>, payload: Value) {
    if let Err(message) = runtime_protocol::validate_event_payload(event_type, &payload) {
        log::warn!("event payload does not match protocol manifest: {message}");
    }

    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.outbound_events.push_back(UiEvent {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
            event_type: event_type.to_string(),
            source: source.map(str::to_string),
            payload,
            at_ms: Some(runtime_now_ms()),
        });
        runtime.emitted_events += 1;
    });
}

pub fn take_pending_actions() -> Vec<UiAction> {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let mut actions = Vec::with_capacity(runtime.pending_actions.len());
        while let Some(action) = runtime.pending_actions.pop_front() {
            actions.push(action);
        }
        runtime.drained_actions += actions.len() as u64;
        actions
    })
}

pub fn take_pending_snapshots() -> Vec<UiSnapshot> {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let mut snapshots = Vec::with_capacity(runtime.pending_snapshots.len());
        while let Some(snapshot) = runtime.pending_snapshots.pop_front() {
            snapshots.push(snapshot);
        }
        runtime.drained_snapshots += snapshots.len() as u64;
        snapshots
    })
}

#[wasm_bindgen]
pub fn dispatch_ui_action(action_json: &str) -> bool {
    let parsed_action = match serde_json::from_str::<UiAction>(action_json) {
        Ok(action) => action,
        Err(err) => {
            let msg = format!("failed to parse ui action: {err}");
            log::error!("{msg}");
            set_last_error(ERROR_INVALID_ACTION_JSON, msg);
            UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
            return false;
        }
    };

    if let Err((code, message)) = validate_action(&parsed_action) {
        log::warn!("invalid ui action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    let mut parsed_action = parsed_action;
    if parsed_action.at_ms.is_none() {
        parsed_action.at_ms = Some(runtime_now_ms());
    }

    if let Err((code, message)) = route_session_language_action(&parsed_action) {
        log::warn!("failed to process session language action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    if let Err((code, message)) = route_session_storage_action(&parsed_action) {
        log::warn!("failed to process session storage action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    if let Err((code, message)) = route_session_keyboard_action(&parsed_action) {
        log::warn!("failed to process session keyboard action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    if let Err((code, message)) = route_session_navigation_action(&parsed_action) {
        log::warn!("failed to process session navigation action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    if let Err((code, message)) = route_session_modal_action(&parsed_action) {
        log::warn!("failed to process session modal action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    if let Err((code, message)) = route_ingame_component_action(&parsed_action) {
        log::warn!("failed to process ingame ui action: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_actions += 1);
        return false;
    }

    let emitted_action = parsed_action.clone();
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.pending_actions.push_back(parsed_action);
        runtime.accepted_actions += 1;
    });
    route_api_action(&emitted_action);
    clear_last_error();

    true
}

#[wasm_bindgen]
pub fn dispatch_ui_snapshot(snapshot_json: &str) -> bool {
    let parsed_snapshot = match serde_json::from_str::<UiSnapshot>(snapshot_json) {
        Ok(snapshot) => snapshot,
        Err(err) => {
            let msg = format!("failed to parse ui snapshot: {err}");
            log::error!("{msg}");
            set_last_error(ERROR_INVALID_SNAPSHOT_JSON, msg);
            UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_snapshots += 1);
            return false;
        }
    };

    if let Err((code, message)) = validate_snapshot(&parsed_snapshot) {
        log::warn!("invalid ui snapshot: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_snapshots += 1);
        return false;
    }

    let mut parsed_snapshot = parsed_snapshot;
    if parsed_snapshot.at_ms.is_none() {
        parsed_snapshot.at_ms = Some(runtime_now_ms());
    }

    if let Err((code, message)) = apply_hud_snapshot(&parsed_snapshot) {
        log::warn!("failed to process hud snapshot: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_snapshots += 1);
        return false;
    }

    if let Err((code, message)) = apply_ingame_snapshot(&parsed_snapshot) {
        log::warn!("failed to process ingame snapshot: {message}");
        set_last_error(code, message);
        UI_RUNTIME.with(|runtime| runtime.borrow_mut().rejected_snapshots += 1);
        return false;
    }

    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        runtime.pending_snapshots.push_back(parsed_snapshot);
        runtime.accepted_snapshots += 1;
    });
    clear_last_error();

    true
}

#[wasm_bindgen]
pub fn take_ui_events() -> String {
    UI_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let mut events = Vec::with_capacity(runtime.outbound_events.len());
        while let Some(event) = runtime.outbound_events.pop_front() {
            events.push(event);
        }
        runtime.drained_events += events.len() as u64;

        match serde_json::to_string(&events) {
            Ok(serialized) => serialized,
            Err(err) => {
                let msg = format!("failed to serialize ui events: {err}");
                log::error!("{msg}");
                runtime.last_error = Some(msg);
                runtime.last_error_code = Some(ERROR_EVENT_SERIALIZATION.to_string());
                "[]".to_string()
            }
        }
    })
}

#[wasm_bindgen]
pub fn clear_ui_runtime() {
    UI_RUNTIME.with(|runtime| {
        *runtime.borrow_mut() = UiRuntimeState::default();
    });
}

#[wasm_bindgen]
pub fn ui_runtime_stats() -> String {
    UI_RUNTIME.with(|runtime| {
        let runtime = runtime.borrow();
        json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "pendingActions": runtime.pending_actions.len(),
            "pendingSnapshots": runtime.pending_snapshots.len(),
            "pendingEvents": runtime.outbound_events.len(),
            "acceptedActions": runtime.accepted_actions,
            "acceptedSnapshots": runtime.accepted_snapshots,
            "rejectedActions": runtime.rejected_actions,
            "rejectedSnapshots": runtime.rejected_snapshots,
            "emittedEvents": runtime.emitted_events,
            "drainedActions": runtime.drained_actions,
            "drainedSnapshots": runtime.drained_snapshots,
            "drainedEvents": runtime.drained_events,
            "openModals": runtime.open_modal_stack,
            "lastError": runtime.last_error,
            "lastErrorCode": runtime.last_error_code,
        })
        .to_string()
    })
}

#[wasm_bindgen]
pub fn ui_runtime_protocol_version() -> u32 {
    runtime_protocol::protocol_version()
}

#[wasm_bindgen]
pub fn ui_runtime_protocol_manifest() -> String {
    runtime_protocol::manifest_json().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_requires_protocol_version() {
        let action = serde_json::json!({
            "type": "ui.action",
            "payload": {}
        });
        let parsed = serde_json::from_value::<UiAction>(action);
        assert!(parsed.is_err());
    }

    #[test]
    fn action_rejects_unknown_fields() {
        let action = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": "ui.action",
            "payload": {},
            "unexpectedField": true
        });
        let parsed = serde_json::from_value::<UiAction>(action);
        assert!(parsed.is_err());
    }

    #[test]
    fn action_validation_rejects_empty_type() {
        let action = UiAction {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
            action_type: " ".to_string(),
            target: None,
            payload: serde_json::json!({}),
            at_ms: None,
        };
        let result = validate_action(&action);
        assert!(result.is_err());
    }

    #[test]
    fn action_validation_rejects_unsupported_protocol() {
        let action = UiAction {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION + 1,
            action_type: "ui.action".to_string(),
            target: None,
            payload: serde_json::json!({}),
            at_ms: None,
        };
        let result = validate_action(&action);
        assert!(result.is_err());
    }

    #[test]
    fn action_validation_accepts_valid_payload() {
        let action = UiAction {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
            action_type: "ui.action".to_string(),
            target: Some("runtime".to_string()),
            payload: serde_json::json!({"x": 1}),
            at_ms: Some(1.0),
        };
        let result = validate_action(&action);
        assert!(result.is_ok());
    }

    #[test]
    fn snapshot_requires_protocol_version() {
        let snapshot = serde_json::json!({
            "type": "ui.snapshot",
            "payload": {}
        });
        let parsed = serde_json::from_value::<UiSnapshot>(snapshot);
        assert!(parsed.is_err());
    }

    #[test]
    fn snapshot_validation_rejects_empty_type() {
        let snapshot = UiSnapshot {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
            snapshot_type: "".to_string(),
            scope: None,
            tick: None,
            payload: serde_json::json!({}),
            at_ms: None,
        };
        let result = validate_snapshot(&snapshot);
        assert!(result.is_err());
    }

    #[test]
    fn snapshot_validation_accepts_valid_payload() {
        let snapshot = UiSnapshot {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
            snapshot_type: "ui.snapshot".to_string(),
            scope: Some("game".to_string()),
            tick: Some(10),
            payload: serde_json::json!({"y": 2}),
            at_ms: Some(2.0),
        };
        let result = validate_snapshot(&snapshot);
        assert!(result.is_ok());
    }

    #[test]
    fn dispatch_ingame_control_panel_snapshot_requires_state_payload() {
        clear_ui_runtime();
        let snapshot_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::snapshot_name(snapshot_keys::UI_SNAPSHOT_INGAME_CONTROL_PANEL),
            "scope": "ingame",
            "tick": 55,
            "payload": {}
        })
        .to_string();

        assert!(!dispatch_ui_snapshot(&snapshot_json));
        let stats: serde_json::Value =
            serde_json::from_str(&ui_runtime_stats()).expect("runtime stats should deserialize");
        assert_eq!(
            stats
                .get("rejectedSnapshots")
                .and_then(serde_json::Value::as_u64),
            Some(1)
        );
        assert_eq!(
            stats
                .get("lastErrorCode")
                .and_then(serde_json::Value::as_str),
            Some(ERROR_INVALID_SNAPSHOT_PAYLOAD)
        );
    }

    #[test]
    fn dispatch_ingame_control_panel_snapshot_accepts_state_payload() {
        clear_ui_runtime();
        let snapshot_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::snapshot_name(snapshot_keys::UI_SNAPSHOT_INGAME_CONTROL_PANEL),
            "scope": "ingame",
            "tick": 56,
            "payload": {
                "state": {
                    "isVisible": true,
                    "troops": "4,500",
                    "maxTroops": "9,000",
                    "troopRate": "120",
                    "troopRateIncreasing": true,
                    "gold": "2,200",
                    "attackRatio": 0.2,
                    "attackTroops": "900",
                    "troopsLabel": "Troops",
                    "goldLabel": "Gold",
                    "attackRatioLabel": "Attack Ratio"
                }
            }
        })
        .to_string();

        assert!(dispatch_ui_snapshot(&snapshot_json));
        let snapshots = take_pending_snapshots();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(
            snapshots[0].snapshot_type,
            runtime_protocol::snapshot_name(snapshot_keys::UI_SNAPSHOT_INGAME_CONTROL_PANEL)
        );
        assert_eq!(snapshots[0].scope.as_deref(), Some("ingame"));
        assert_eq!(snapshots[0].tick, Some(56));
    }

    #[test]
    fn dispatch_ingame_build_menu_show_requires_items_payload() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_INGAME_BUILD_MENU_SHOW),
            "payload": {}
        })
        .to_string();

        assert!(!dispatch_ui_action(&action_json));
        let stats: serde_json::Value =
            serde_json::from_str(&ui_runtime_stats()).expect("runtime stats should deserialize");
        assert_eq!(
            stats
                .get("rejectedActions")
                .and_then(serde_json::Value::as_u64),
            Some(1)
        );
        assert_eq!(
            stats
                .get("lastErrorCode")
                .and_then(serde_json::Value::as_str),
            Some(ERROR_INVALID_ACTION_PAYLOAD)
        );
    }

    #[test]
    fn dispatch_ingame_radial_menu_show_accepts_payload() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_INGAME_RADIAL_MENU_SHOW),
            "payload": {
                "items": [],
                "centerButton": {
                    "icon": "/images/SwordIconWhite.svg",
                    "color": "#2c3e50",
                    "iconSize": 48,
                    "disabled": false
                },
                "x": 100,
                "y": 200
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let actions = take_pending_actions();
        assert_eq!(actions.len(), 1);
        assert_eq!(
            actions[0].action_type,
            runtime_protocol::action_name(action_keys::UI_INGAME_RADIAL_MENU_SHOW)
        );
    }

    #[test]
    fn event_serialization_includes_protocol_version() {
        let event = UiEvent {
            protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
            event_type: "ui.event".to_string(),
            source: Some("runtime".to_string()),
            payload: serde_json::json!({}),
            at_ms: Some(1.0),
        };

        let serialized = serde_json::to_value(event).expect("event should serialize");
        assert_eq!(
            serialized.get("protocolVersion").and_then(|v| v.as_u64()),
            Some(UI_RUNTIME_PROTOCOL_VERSION as u64)
        );
    }

    #[test]
    fn dispatch_stats_request_emits_loading_event() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_READ_STATS_REQUEST),
            "payload": {
                "requestId": 11,
                "reason": "open",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_READ_STATS_LOADING)
        );
    }

    #[test]
    fn dispatch_stats_retry_emits_retry_and_loading_events() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_READ_STATS_RETRY),
            "payload": {
                "requestId": 12,
                "reason": "retry",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_READ_STATS_RETRY)
        );
        assert_eq!(
            events[1].event_type,
            event_name(event_keys::UI_READ_STATS_LOADING)
        );
    }

    #[test]
    fn dispatch_matchmaking_request_emits_loading_event() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_MATCHMAKING_SEARCH_REQUEST),
            "payload": {
                "requestId": 31,
                "reason": "open",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_MATCHMAKING_SEARCH_LOADING)
        );
    }

    #[test]
    fn dispatch_matchmaking_cancel_emits_cancel_event() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_MATCHMAKING_SEARCH_CANCEL),
            "payload": {
                "requestId": 32,
                "reason": "component",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_MATCHMAKING_SEARCH_CANCEL)
        );
    }

    #[test]
    fn dispatch_game_info_error_emits_error_event() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_READ_GAME_INFO_ERROR),
            "payload": {
                "requestId": 13,
                "gameId": "abc123",
                "message": "failed",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_READ_GAME_INFO_ERROR)
        );
    }

    #[test]
    fn dispatch_host_create_request_emits_loading_event() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_MUTATE_HOST_CREATE_REQUEST),
            "payload": {
                "requestId": 21,
                "reason": "open",
                "creatorClientID": "creator-1",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_MUTATE_HOST_CREATE_LOADING)
        );
    }

    #[test]
    fn dispatch_magic_link_error_emits_error_event() {
        clear_ui_runtime();
        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR),
            "payload": {
                "requestId": 22,
                "email": "player@example.com",
                "message": "request-failed",
            }
        })
        .to_string();

        assert!(dispatch_ui_action(&action_json));
        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            event_name(event_keys::UI_MUTATE_ACCOUNT_MAGIC_LINK_ERROR)
        );
    }

    #[test]
    fn dispatch_escape_closes_top_modal_via_runtime_event() {
        clear_ui_runtime();

        let open_chat_action = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::SESSION_MODAL_STATE),
            "payload": {
                "modal": "chat",
                "isOpen": true
            }
        })
        .to_string();
        assert!(dispatch_ui_action(&open_chat_action));

        let open_moderation_action = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::SESSION_MODAL_STATE),
            "payload": {
                "modal": "player-moderation",
                "isOpen": true
            }
        })
        .to_string();
        assert!(dispatch_ui_action(&open_moderation_action));

        let escape_action = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::SESSION_KEYBOARD_ESCAPE),
            "payload": {
                "reason": "escape"
            }
        })
        .to_string();
        assert!(dispatch_ui_action(&escape_action));

        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        let close_event = events
            .iter()
            .find(|event| event.event_type == event_name(event_keys::SESSION_MODAL_CLOSE))
            .expect("expected session modal close event");
        assert_eq!(
            close_event.payload.get("modal").and_then(Value::as_str),
            Some("player-moderation")
        );
        assert_eq!(
            close_event.payload.get("reason").and_then(Value::as_str),
            Some("escape")
        );
    }

    #[test]
    fn dispatch_keyboard_state_emits_runtime_keyboard_event() {
        clear_ui_runtime();

        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::SESSION_KEYBOARD_STATE),
            "payload": {
                "key": "t",
                "code": "KeyT",
                "isDown": true
            }
        })
        .to_string();
        assert!(dispatch_ui_action(&action_json));

        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        let keyboard_event = events
            .iter()
            .find(|event| event.event_type == event_name(event_keys::SESSION_KEYBOARD_CHANGED))
            .expect("expected session keyboard changed event");
        assert_eq!(
            keyboard_event.payload.get("key").and_then(Value::as_str),
            Some("t")
        );
        assert_eq!(
            keyboard_event.payload.get("code").and_then(Value::as_str),
            Some("KeyT")
        );
        assert_eq!(
            keyboard_event
                .payload
                .get("isDown")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn dispatch_navigation_popstate_emits_runtime_navigation_event() {
        clear_ui_runtime();

        let action_json = serde_json::json!({
            "protocolVersion": UI_RUNTIME_PROTOCOL_VERSION,
            "type": runtime_protocol::action_name(action_keys::SESSION_NAVIGATION_POPSTATE),
            "payload": {
                "href": "https://openfront.io/game/abc123"
            }
        })
        .to_string();
        assert!(dispatch_ui_action(&action_json));

        let events_json = take_ui_events();
        let events: Vec<UiEvent> =
            serde_json::from_str(&events_json).expect("events should deserialize");
        let navigation_event = events
            .iter()
            .find(|event| event.event_type == event_name(event_keys::SESSION_NAVIGATION_POPSTATE))
            .expect("expected session navigation popstate event");
        assert_eq!(
            navigation_event.payload.get("href").and_then(Value::as_str),
            Some("https://openfront.io/game/abc123")
        );
    }

    #[test]
    fn protocol_version_matches_manifest_version() {
        assert_eq!(
            UI_RUNTIME_PROTOCOL_VERSION,
            runtime_protocol::protocol_version()
        );
    }

    #[test]
    fn parse_storage_key_defaults_to_lang() {
        let key = parse_storage_key_from_payload(&serde_json::json!({}))
            .expect("storage key should default");
        assert_eq!(key, "lang");
    }

    #[test]
    fn parse_storage_key_rejects_invalid_type() {
        let result = parse_storage_key_from_payload(&serde_json::json!({
            "storageKey": 42
        }));
        assert!(result.is_err());
    }

    #[test]
    fn parse_language_write_payload_requires_lang() {
        let result = parse_language_write_payload(&serde_json::json!({
            "storageKey": "lang"
        }));
        assert!(result.is_err());
    }

    #[test]
    fn parse_language_write_payload_trims_values() {
        let (storage_key, lang) = parse_language_write_payload(&serde_json::json!({
            "storageKey": " lang ",
            "lang": " en-US "
        }))
        .expect("write payload should parse");
        assert_eq!(storage_key, "lang");
        assert_eq!(lang, "en-US");
    }

    #[test]
    fn parse_required_storage_key_requires_key_field() {
        let result =
            parse_required_storage_key_from_payload(&serde_json::json!({}), "session.storage.read");
        assert!(result.is_err());
    }

    #[test]
    fn parse_session_storage_write_payload_parses_string_value() {
        let (storage_key, value) = parse_session_storage_write_payload(&serde_json::json!({
            "storageKey": " gamesPlayed ",
            "value": "42"
        }))
        .expect("storage write payload should parse");
        assert_eq!(storage_key, "gamesPlayed");
        assert_eq!(value, "42");
    }

    #[test]
    fn parse_keyboard_state_payload_requires_key() {
        let result = parse_keyboard_state_payload(&serde_json::json!({
            "code": "KeyT",
            "isDown": true
        }));
        assert!(result.is_err());
    }

    #[test]
    fn parse_required_href_payload_requires_href() {
        let result =
            parse_required_href_payload(&serde_json::json!({}), "session.navigation.popstate");
        assert!(result.is_err());
    }
}
