use dioxus_ui::runtime::{
    clear_ui_runtime, dispatch_ui_action, dispatch_ui_snapshot, emit_ui_event,
    take_pending_actions, take_pending_snapshots, take_ui_events, ui_runtime_stats, UiAction,
    UiEvent, UiSnapshot, UI_RUNTIME_PROTOCOL_VERSION,
};
use serde_json::{json, Value};

struct RuntimeQueueHarness;

impl RuntimeQueueHarness {
    fn reset() {
        clear_ui_runtime();
    }

    fn dispatch_action(action: UiAction) {
        let serialized = serde_json::to_string(&action).expect("action should serialize");
        assert!(
            dispatch_ui_action(&serialized),
            "action dispatch should succeed"
        );
    }

    fn dispatch_snapshot(snapshot: UiSnapshot) {
        let serialized = serde_json::to_string(&snapshot).expect("snapshot should serialize");
        assert!(
            dispatch_ui_snapshot(&serialized),
            "snapshot dispatch should succeed"
        );
    }

    fn emit_event(event_type: &str, source: Option<&str>, payload: Value) {
        emit_ui_event(event_type, source, payload);
    }

    fn drain_actions() -> Vec<UiAction> {
        take_pending_actions()
    }

    fn drain_snapshots() -> Vec<UiSnapshot> {
        take_pending_snapshots()
    }

    fn drain_events() -> Vec<UiEvent> {
        serde_json::from_str(&take_ui_events()).expect("events should parse")
    }

    fn stats() -> Value {
        serde_json::from_str(&ui_runtime_stats()).expect("runtime stats should parse")
    }

    fn stat_count(stats: &Value, key: &str) -> u64 {
        stats.get(key).and_then(Value::as_u64).unwrap_or(0)
    }
}

fn action_fixture(action_type: &str, target: Option<&str>, payload: Value) -> UiAction {
    UiAction {
        protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
        action_type: action_type.to_string(),
        target: target.map(str::to_string),
        payload,
        at_ms: None,
    }
}

fn snapshot_fixture(
    snapshot_type: &str,
    scope: Option<&str>,
    tick: Option<u32>,
    payload: Value,
) -> UiSnapshot {
    UiSnapshot {
        protocol_version: UI_RUNTIME_PROTOCOL_VERSION,
        snapshot_type: snapshot_type.to_string(),
        scope: scope.map(str::to_string),
        tick,
        payload,
        at_ms: None,
    }
}

#[test]
fn runtime_queue_semantics_are_fifo_and_drained_metrics_track_flow() {
    RuntimeQueueHarness::reset();

    RuntimeQueueHarness::dispatch_action(action_fixture(
        "ui.hud.intent.toggle",
        Some("heads-up-message"),
        json!({ "visible": true }),
    ));
    RuntimeQueueHarness::dispatch_action(action_fixture(
        "ui.modal.intent.open",
        Some("settings"),
        json!({ "source": "hotkey" }),
    ));

    RuntimeQueueHarness::dispatch_snapshot(snapshot_fixture(
        "ui.hud.snapshot",
        Some("hud"),
        Some(88),
        json!({ "gold": 5500 }),
    ));
    RuntimeQueueHarness::dispatch_snapshot(snapshot_fixture(
        "ui.modal.snapshot",
        Some("settings"),
        Some(89),
        json!({ "open": true }),
    ));

    RuntimeQueueHarness::emit_event(
        "ui.hud.updated",
        Some("hud"),
        json!({ "leaderboardVisible": true }),
    );
    RuntimeQueueHarness::emit_event(
        "ui.modal.updated",
        Some("settings"),
        json!({ "open": true, "activeTab": "audio" }),
    );

    let pre_drain_stats = RuntimeQueueHarness::stats();
    assert_eq!(
        RuntimeQueueHarness::stat_count(&pre_drain_stats, "pendingActions"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&pre_drain_stats, "pendingSnapshots"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&pre_drain_stats, "pendingEvents"),
        2
    );

    let drained_actions = RuntimeQueueHarness::drain_actions();
    assert_eq!(drained_actions.len(), 2);
    assert_eq!(drained_actions[0].action_type, "ui.hud.intent.toggle");
    assert_eq!(drained_actions[1].action_type, "ui.modal.intent.open");
    assert!(drained_actions[0].at_ms.is_some());
    assert!(drained_actions[1].at_ms.is_some());
    assert!(RuntimeQueueHarness::drain_actions().is_empty());

    let drained_snapshots = RuntimeQueueHarness::drain_snapshots();
    assert_eq!(drained_snapshots.len(), 2);
    assert_eq!(drained_snapshots[0].snapshot_type, "ui.hud.snapshot");
    assert_eq!(drained_snapshots[1].snapshot_type, "ui.modal.snapshot");
    assert!(drained_snapshots[0].at_ms.is_some());
    assert!(drained_snapshots[1].at_ms.is_some());
    assert!(RuntimeQueueHarness::drain_snapshots().is_empty());

    let drained_events = RuntimeQueueHarness::drain_events();
    assert_eq!(drained_events.len(), 2);
    assert_eq!(drained_events[0].event_type, "ui.hud.updated");
    assert_eq!(drained_events[1].event_type, "ui.modal.updated");
    assert!(drained_events[0].at_ms.is_some());
    assert!(drained_events[1].at_ms.is_some());
    assert!(RuntimeQueueHarness::drain_events().is_empty());

    let post_drain_stats = RuntimeQueueHarness::stats();
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "acceptedActions"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "acceptedSnapshots"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "emittedEvents"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "drainedActions"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "drainedSnapshots"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "drainedEvents"),
        2
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "pendingActions"),
        0
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "pendingSnapshots"),
        0
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&post_drain_stats, "pendingEvents"),
        0
    );
}

#[test]
fn hud_snapshot_parity_is_preserved_across_runtime_queue() {
    RuntimeQueueHarness::reset();

    let hud_before = json!({
        "leftSidebar": {
            "gold": 7840,
            "incomePerSecond": 32,
            "selectedTerritory": 41
        },
        "rightSidebar": {
            "alivePlayers": 7,
            "deadPlayers": 2
        },
        "notifications": {
            "headsUpMessage": {
                "visible": true,
                "message": "Attack incoming on eastern border"
            }
        }
    });

    RuntimeQueueHarness::dispatch_snapshot(snapshot_fixture(
        "ui.hud.snapshot",
        Some("hud"),
        Some(4012),
        hud_before.clone(),
    ));

    let snapshots = RuntimeQueueHarness::drain_snapshots();
    assert_eq!(snapshots.len(), 1);
    let hud_after = &snapshots[0];

    assert_eq!(hud_after.protocol_version, UI_RUNTIME_PROTOCOL_VERSION);
    assert_eq!(hud_after.snapshot_type, "ui.hud.snapshot");
    assert_eq!(hud_after.scope.as_deref(), Some("hud"));
    assert_eq!(hud_after.tick, Some(4012));
    assert_eq!(hud_after.payload, hud_before);
}

#[test]
fn modal_action_and_snapshot_parity_are_preserved_across_runtime_queue() {
    RuntimeQueueHarness::reset();

    let modal_before_action_payload = json!({
        "open": true,
        "activeTab": "graphics",
        "trigger": "settings-button"
    });
    let modal_before_snapshot_payload = json!({
        "open": true,
        "activeTab": "graphics",
        "sliderValues": {
            "music": 0.35,
            "sfx": 0.8
        },
        "toggles": {
            "showFps": true,
            "soundEnabled": true
        }
    });

    RuntimeQueueHarness::dispatch_action(action_fixture(
        "ui.modal.intent.open",
        Some("settings"),
        modal_before_action_payload.clone(),
    ));
    RuntimeQueueHarness::dispatch_snapshot(snapshot_fixture(
        "ui.modal.snapshot",
        Some("settings"),
        Some(9021),
        modal_before_snapshot_payload.clone(),
    ));

    let actions = RuntimeQueueHarness::drain_actions();
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].protocol_version, UI_RUNTIME_PROTOCOL_VERSION);
    assert_eq!(actions[0].action_type, "ui.modal.intent.open");
    assert_eq!(actions[0].target.as_deref(), Some("settings"));
    assert_eq!(actions[0].payload, modal_before_action_payload);

    let snapshots = RuntimeQueueHarness::drain_snapshots();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].protocol_version, UI_RUNTIME_PROTOCOL_VERSION);
    assert_eq!(snapshots[0].snapshot_type, "ui.modal.snapshot");
    assert_eq!(snapshots[0].scope.as_deref(), Some("settings"));
    assert_eq!(snapshots[0].tick, Some(9021));
    assert_eq!(snapshots[0].payload, modal_before_snapshot_payload);
}

#[test]
fn invalid_payloads_increment_rejection_counters_without_affecting_throughput() {
    RuntimeQueueHarness::reset();

    assert!(!dispatch_ui_action("not-json"));
    assert!(!dispatch_ui_snapshot("not-json"));

    let stats = RuntimeQueueHarness::stats();
    assert_eq!(
        RuntimeQueueHarness::stat_count(&stats, "acceptedActions"),
        0
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&stats, "acceptedSnapshots"),
        0
    );
    assert_eq!(RuntimeQueueHarness::stat_count(&stats, "emittedEvents"), 0);
    assert_eq!(RuntimeQueueHarness::stat_count(&stats, "drainedActions"), 0);
    assert_eq!(
        RuntimeQueueHarness::stat_count(&stats, "drainedSnapshots"),
        0
    );
    assert_eq!(RuntimeQueueHarness::stat_count(&stats, "drainedEvents"), 0);
    assert_eq!(
        RuntimeQueueHarness::stat_count(&stats, "rejectedActions"),
        1
    );
    assert_eq!(
        RuntimeQueueHarness::stat_count(&stats, "rejectedSnapshots"),
        1
    );
    assert_eq!(RuntimeQueueHarness::stat_count(&stats, "pendingActions"), 0);
    assert_eq!(
        RuntimeQueueHarness::stat_count(&stats, "pendingSnapshots"),
        0
    );
    assert_eq!(RuntimeQueueHarness::stat_count(&stats, "pendingEvents"), 0);
}
