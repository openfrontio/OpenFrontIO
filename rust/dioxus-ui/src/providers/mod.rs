//! Provider modules for Dioxus UI components

pub mod chat_modal_provider;
pub mod leaderboard_provider;
pub mod multi_tab_provider;
pub mod player_moderation_provider;
pub mod settings_provider;
pub mod team_stats_provider;
pub mod win_modal_provider;

pub use chat_modal_provider::{ChatModalProvider, ChatModalProviderProps, ChatModalRoot};
pub use leaderboard_provider::{LeaderboardProvider, LeaderboardProviderProps, LeaderboardRoot};
pub use multi_tab_provider::{MultiTabProvider, MultiTabProviderProps, MultiTabRoot};
pub use player_moderation_provider::{
    PlayerModerationProvider, PlayerModerationProviderProps, PlayerModerationRoot,
};
pub use settings_provider::{SettingsProvider, SettingsProviderProps, SettingsRoot};
pub use team_stats_provider::{TeamStatsProvider, TeamStatsProviderProps, TeamStatsRoot};
pub use win_modal_provider::{WinModalProvider, WinModalProviderProps, WinModalRoot};
