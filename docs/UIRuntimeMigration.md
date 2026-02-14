# UI Runtime Migration Plan

## Goal

Move Dioxus bridge logic from many per-component TypeScript files into a unified Rust/WASM UI runtime while preserving existing behavior.
For consolidated Rust crate boundaries and cross-crate expansion paths, see `docs/RustArchitecture.md`.

## Constraints

1. Keep current game servers stateful for now.
2. Keep deployment portable and simple:
- Minimize process-specific assumptions.
- Keep all runtime config environment-driven.
- Avoid coupling migration work to one infrastructure stack.
3. Preserve compatibility during migration:
- Existing `launch_*` and `update_*` exports continue to work until each feature is migrated.

## Runtime Contract (Phase 1)

Add a generic UI contract alongside existing APIs:

1. `dispatch_ui_action(actionJson)`
2. `dispatch_ui_snapshot(snapshotJson)`
3. `take_ui_events()`

Type shapes:

1. `UiAction`: user/UI intents sent from TS host to Rust.
2. `UiSnapshot`: game/app state snapshots sent from TS host to Rust.
3. `UiEvent`: events emitted by Rust back to TS host.
4. `protocolVersion`: required on all runtime envelopes for forward compatibility.

Runtime diagnostics:

1. `ui_runtime_stats()` exposes accepted/rejected counters.
2. `lastErrorCode` exposes machine-readable parse/validation failures.

## Migration Waves

### Wave A: Foundation (in progress)

1. Introduce runtime module in `rust/dioxus-ui`.
2. Add TS wrappers in `src/client/UiRuntimeBridge.ts`.
3. Keep all legacy per-component exports intact.

Exit criteria:

1. Rust/TS compile passes.
2. No behavior change in existing UI components.

### Wave B: Browser/Session behavior

Move local browser responsibilities into Rust runtime in small slices:

1. Local storage reads/writes (language, username, settings).
2. Keyboard handlers for modal open/close and shortcuts.
3. DOM event wiring currently handled in TS bridges.

Exit criteria:

1. Removed duplicated listener logic from target TS bridges.
2. Existing UX behavior unchanged.

### Wave C: Game-loop/EventBus wiring

1. Replace per-bridge `tick()` push patterns with snapshot dispatch to runtime.
2. Rust runtime reduces snapshot payloads into Dioxus state.
3. Rust emits typed events that TS host routes to existing input/network code.

Exit criteria:

1. Fewer per-component `update_*` calls from TS.
2. Identical render/update cadence in active game.

### Wave D: API/Data orchestration

1. Move read-heavy orchestration first (stats/news/game-info/public-lobby read paths).
2. Then move mutation-heavy flows (joins, creates, account actions) with strict validation and error mapping.
3. Keep server endpoints unchanged during this wave.

Exit criteria:

1. API orchestration code removed from migrated TS bridges.
2. Error and retry behavior matches pre-migration.

### Wave E: Bridge collapse

1. Remove obsolete `Dioxus*.ts` bridge files feature-by-feature.
2. Shrink `UiRuntimeBridge.ts` to runtime-first API.
3. Delete unused Rust per-component exports as migrations complete.

Exit criteria:

1. Runtime API is primary integration path.
2. Legacy bridge calls reduced to zero for migrated features.

### Track E progress (current)

1. Removed unused legacy typings from `DioxusWasmModule` in `src/client/UiRuntimeBridge.ts` (dead methods with no host references).
2. Removed unused `launchHelloWorld`, `launchSettingsModal`, and `onDioxusEvent` exports from `src/client/UiRuntimeBridge.ts`.
3. Added `initDioxusRuntime()` in `src/client/UiRuntimeBridge.ts` and switched runtime-only modules (`src/client/runtime/UiApiReadRuntime.ts`, `src/client/runtime/UiApiMutationRuntime.ts`, `src/client/runtime/UiSessionRuntime.ts`) to it.
4. Added `tests/client/runtime/UiRuntimeBridgeSurface.test.ts` to lock runtime-core methods and prevent `launch_/update_/show_/hide_` legacy surface growth.
5. Migrated in-game/HUD launch and toggle paths in `src/client/graphics/layers/AdvancedLayerBridges.ts` to runtime actions (`events/chat/control/emoji/unit/spawn/immunity/heads-up/alert/left-sidebar/replay/right-sidebar`).
6. Removed matching Rust JS exports (`#[wasm_bindgen]`) and TS bridge typings for those methods.
7. Migrated `player-panel`, `player-info-overlay`, and `performance-overlay` launch/update flows to runtime action+snapshot paths.
8. Migrated `full-settings-modal`, `leaderboard`, and `team-stats` launch/update flows to runtime action+snapshot paths.
9. Migrated `send-resource-modal` and `multi-tab-modal` launch/show/hide/update flows to runtime action+snapshot paths.
10. Tightened legacy bridge cap from `110` to `53`, then to `15`, then to `4`, then to `1`, then to `0`, in `scripts/checkBridgeLegacySurface.mjs` and `tests/client/runtime/UiRuntimeBridgeSurface.test.ts`.
11. Migrated all host/join/public lobby bridge launch/update paths in `src/client/LobbyBridges.ts` to runtime actions/snapshots and removed matching TS bridge typings + Rust JS exports.
12. Migrated layout/navigation bridge launch/update paths (`play-page`, `desktop-nav-bar`, `mobile-nav-bar`, `main-layout`, `footer`) in `src/client/ProfileAndSettingsBridges.ts` to runtime actions/snapshots and removed matching TS bridge typings + Rust JS exports.
13. Migrated `account/single-player/lang-selector/game-starting/language/flag-input/token-login/news/help` and `flag-input/pattern-input/username-input` to runtime action/snapshot paths in `src/client/ProfileAndSettingsBridges.ts`, and removed matching Rust JS exports (`#[wasm_bindgen]`).
14. Migrated `territory-patterns`, `user-setting`, `matchmaking`, `stats`, and `game-info` to runtime action/snapshot paths in `src/client/ProfileAndSettingsBridges.ts`, and removed matching Rust JS exports (`#[wasm_bindgen]`).
15. Migrated chat/player-moderation (`src/client/InGameModalBridges.ts`) to runtime action/snapshot paths, and removed matching Rust JS exports (`#[wasm_bindgen]`).
16. Remaining legacy typed bridge surface has been removed; bridge surface is runtime dispatch-only.
17. Centralized browser/session globals in `src/client/runtime/UiSessionRuntime.ts` (`localStorage`, `keydown/keyup`, `beforeunload`, `popstate`, `hashchange`) and rewired `src/client/Main.ts` / `src/client/MultiTabDetector.ts` to runtime session host events.
18. Removed dead runtime bridge aliases (`initDioxusUI`, `isDioxusReady`, `getDioxusModule`) from `src/client/UiRuntimeBridge.ts`; runtime init is now `initDioxusRuntime()` only.
19. Moved profile-language and changelog asset fetches behind runtime read helpers in `src/client/runtime/UiContentReadRuntime.ts`, removing direct fetch orchestration from `src/client/ProfileAndSettingsBridges.ts`.
20. Moved profile matchmaking websocket + lobby-ready polling orchestration into `src/client/runtime/UiMatchmakingRuntime.ts` via shared runtime protocol actions/events (`ui.matchmaking.search.*`), and extracted `dioxus-matchmaking-modal` to `src/client/profile/DioxusMatchmakingModal.ts` to reduce core bridge surface.

## Server Direction (Stateful + Portable)

Near-term:

1. Keep current stateful realtime workers.
2. Keep worker behavior deterministic and config-driven.
3. Avoid embedding host-specific assumptions in server process logic.

Future option:

1. Introduce a stateless Axum control-plane service separately for metadata/auth-facing orchestration.
2. Do not combine this with realtime state migration in the same wave.
