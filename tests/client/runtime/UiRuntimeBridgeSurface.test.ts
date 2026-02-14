import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRIDGE_PATH = resolve(process.cwd(), "src/client/UiRuntimeBridge.ts");

function parseBridgeMethodNames(source: string): string[] {
  const interfaceMatch = source.match(
    /export interface DioxusWasmModule \{([\s\S]*?)\n\}/,
  );
  if (!interfaceMatch) {
    throw new Error("DioxusWasmModule interface was not found");
  }

  const methodMatches = interfaceMatch[1].matchAll(
    /^\s{2}([A-Za-z0-9_]+):/gm,
  );
  return [...methodMatches].map((entry) => entry[1]);
}

describe("UiRuntimeBridge surface", () => {
  test("retains runtime-core bridge methods", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");
    const methods = parseBridgeMethodNames(source);

    expect(methods).toEqual(
      expect.arrayContaining([
        "dispatch_ui_action",
        "dispatch_ui_snapshot",
        "take_ui_events",
        "ui_runtime_stats",
        "ui_runtime_protocol_version",
        "ui_runtime_protocol_manifest",
      ]),
    );
  });

  test("does not re-expand launch/update/show/hide legacy surface", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");
    const methods = parseBridgeMethodNames(source);
    const legacyMethods = methods.filter((name) =>
      /^(launch|update|show|hide)_/.test(name),
    );

    // Keep shrinking this cap as runtime migration removes legacy bridge calls.
    expect(legacyMethods.length).toBe(0);
  });

  test("keeps pruned dead methods out of bridge typings", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");
    const methods = parseBridgeMethodNames(source);

    for (const methodName of [
      "launch_modal_overlay",
      "show_modal_overlay",
      "hide_modal_overlay",
      "hide_public_lobby",
      "update_host_lobby_form",
      "update_host_lobby_info",
      "update_language_modal_current_lang",
      "update_player_moderation_already_kicked",
      "update_build_menu_items",
      "update_center_button",
      "launch_build_menu",
      "launch_radial_menu",
      "launch_win_modal",
      "show_build_menu",
      "hide_build_menu",
      "show_radial_menu",
      "push_submenu",
      "pop_submenu",
      "update_radial_items",
      "hide_radial_menu",
      "show_win_modal",
      "hide_win_modal",
      "update_win_modal_cosmetics",
      "open_chat_modal",
      "open_player_moderation_modal",
      "launch_events_display",
      "launch_chat_display",
      "launch_control_panel",
      "launch_emoji_table",
      "show_emoji_table",
      "hide_emoji_table",
      "launch_unit_display",
      "launch_spawn_timer",
      "show_spawn_timer",
      "launch_immunity_timer",
      "launch_heads_up_message",
      "show_heads_up_toast",
      "hide_heads_up_toast",
      "launch_alert_frame",
      "launch_game_left_sidebar",
      "launch_replay_panel",
      "launch_game_right_sidebar",
      "launch_player_panel",
      "update_player_panel",
      "launch_player_info_overlay",
      "update_player_info_overlay",
      "launch_performance_overlay",
      "update_performance_overlay",
      "launch_full_settings_modal",
      "launch_leaderboard",
      "update_leaderboard_entries",
      "launch_team_stats",
      "update_team_stats_entries",
      "launch_send_resource_modal",
      "show_send_resource_modal",
      "hide_send_resource_modal",
      "update_send_resource_total",
      "launch_multi_tab_modal",
      "show_multi_tab_modal",
      "hide_multi_tab_modal",
      "launch_host_lobby_modal",
      "show_host_lobby_modal",
      "hide_host_lobby_modal",
      "update_host_lobby_players",
      "launch_join_private_lobby_modal",
      "open_join_private_lobby_modal",
      "close_join_private_lobby_modal",
      "update_join_private_lobby_joined",
      "update_join_private_lobby_id",
      "update_join_private_lobby_config_html",
      "update_join_private_lobby_players_html",
      "launch_public_lobby",
      "update_public_lobby_data",
      "update_public_lobby_joining",
      "launch_play_page",
      "update_play_page",
      "launch_desktop_nav_bar",
      "update_desktop_nav_bar",
      "launch_mobile_nav_bar",
      "update_mobile_nav_bar",
      "launch_main_layout",
      "update_main_layout",
      "launch_footer",
      "update_footer",
      "launch_account_modal",
      "open_account_modal",
      "close_account_modal",
      "update_account_modal_loading",
      "update_account_modal_content",
      "update_account_modal_header_right",
      "launch_single_player_modal",
      "show_single_player_modal",
      "hide_single_player_modal",
      "update_single_player_form",
      "update_single_player_achievements",
      "launch_lang_selector",
      "update_lang_selector_flag",
      "show_lang_selector",
      "hide_lang_selector",
      "launch_game_starting_modal",
      "show_game_starting_modal",
      "hide_game_starting_modal",
      "launch_language_modal",
      "open_language_modal",
      "close_language_modal",
      "launch_flag_input_modal",
      "open_flag_input_modal",
      "close_flag_input_modal",
      "launch_token_login_modal",
      "open_token_login_modal",
      "close_token_login_modal",
      "update_token_login_email",
      "launch_news_modal",
      "open_news_modal",
      "close_news_modal",
      "update_news_modal_content",
      "launch_help_modal",
      "open_help_modal",
      "close_help_modal",
      "update_help_modal_content",
      "launch_flag_input",
      "update_flag_input",
      "update_flag_input_show_select_label",
      "update_flag_input_translations",
      "launch_pattern_input",
      "update_pattern_input_preview",
      "update_pattern_input_show_select_label",
      "update_pattern_input_loading",
      "update_pattern_input_translations",
      "launch_username_input",
      "update_username_input_clan_tag",
      "update_username_input_username",
      "update_username_input_validation_error",
      "update_username_input_translations",
      "launch_territory_patterns_modal",
      "update_territory_patterns_modal",
      "launch_user_setting_modal",
      "update_user_setting_modal",
      "launch_matchmaking_modal",
      "update_matchmaking_state",
      "launch_stats_modal",
      "update_stats_modal",
      "launch_game_info_modal",
      "hide_game_info_modal",
      "update_game_info_modal",
      "launch_chat_modal",
      "close_chat_modal",
      "update_chat_modal_players",
      "open_chat_modal_with_selection",
      "launch_player_moderation_modal",
      "close_player_moderation_modal",
      "launch_ui_app",
    ]) {
      expect(methods).not.toContain(methodName);
    }
  });
});
