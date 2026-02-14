import {
  getUiRuntimeProtocolManifest,
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_PROTOCOL_VERSION,
  UI_RUNTIME_SNAPSHOTS,
  validateUiRuntimeActionPayload,
  validateUiRuntimeSnapshotPayload,
} from "../../../src/client/runtime/UiRuntimeProtocol";

describe("UiRuntimeProtocol shared manifest", () => {
  test("exports action/event names from shared manifest", () => {
    const manifest = getUiRuntimeProtocolManifest();

    expect(UI_RUNTIME_PROTOCOL_VERSION).toBe(manifest.version);
    expect(UI_RUNTIME_ACTIONS.sessionLanguageRead).toBe("session.language.read");
    expect(UI_RUNTIME_ACTIONS.sessionStorageRead).toBe("session.storage.read");
    expect(UI_RUNTIME_ACTIONS.sessionStorageRemove).toBe(
      "session.storage.remove",
    );
    expect(UI_RUNTIME_ACTIONS.sessionKeyboardState).toBe(
      "session.keyboard.state",
    );
    expect(UI_RUNTIME_ACTIONS.sessionLifecycleBeforeUnload).toBe(
      "session.lifecycle.before-unload",
    );
    expect(UI_RUNTIME_ACTIONS.sessionNavigationPopstate).toBe(
      "session.navigation.popstate",
    );
    expect(UI_RUNTIME_ACTIONS.sessionNavigationHashchange).toBe(
      "session.navigation.hashchange",
    );
    expect(UI_RUNTIME_ACTIONS.uiReadStatsRequest).toBe(
      "ui.read.stats.request",
    );
    expect(UI_RUNTIME_ACTIONS.uiReadLobbyExistsRequest).toBe(
      "ui.read.lobby-exists.request",
    );
    expect(UI_RUNTIME_ACTIONS.uiMatchmakingSearchRequest).toBe(
      "ui.matchmaking.search.request",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameBuildMenuShow).toBe(
      "ui.ingame.build-menu.show",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameBuildMenuLaunch).toBe(
      "ui.ingame.build-menu.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameWinModalShow).toBe(
      "ui.ingame.win-modal.show",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameWinModalLaunch).toBe(
      "ui.ingame.win-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameControlPanelLaunch).toBe(
      "ui.ingame.control-panel.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiHudHeadsUpToastShow).toBe(
      "ui.hud.heads-up-message.toast-show",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGamePlayerPanelLaunch).toBe(
      "ui.ingame.player-panel.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameLeaderboardLaunch).toBe(
      "ui.ingame.leaderboard.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameSendResourceModalShow).toBe(
      "ui.ingame.send-resource-modal.show",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameChatModalLaunch).toBe(
      "ui.ingame.chat-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameChatModalClose).toBe(
      "ui.ingame.chat-modal.close",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGameChatModalOpenWithSelection).toBe(
      "ui.ingame.chat-modal.open-with-selection",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGamePlayerModerationModalLaunch).toBe(
      "ui.ingame.player-moderation-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiInGamePlayerModerationModalClose).toBe(
      "ui.ingame.player-moderation-modal.close",
    );
    expect(UI_RUNTIME_ACTIONS.uiHostLobbyModalLaunch).toBe(
      "ui.lobby.host-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyModalOpen).toBe(
      "ui.lobby.join-private-modal.open",
    );
    expect(UI_RUNTIME_ACTIONS.uiPublicLobbyLaunch).toBe(
      "ui.lobby.public.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiLayoutPlayPageLaunch).toBe(
      "ui.layout.play-page.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiLayoutDesktopNavBarLaunch).toBe(
      "ui.layout.desktop-nav-bar.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileAccountModalLaunch).toBe(
      "ui.profile.account-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileSinglePlayerModalLaunch).toBe(
      "ui.profile.single-player-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileLanguageModalOpen).toBe(
      "ui.profile.language-modal.open",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileTerritoryPatternsModalLaunch).toBe(
      "ui.profile.territory-patterns-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileUserSettingModalLaunch).toBe(
      "ui.profile.user-setting-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileMatchmakingModalLaunch).toBe(
      "ui.profile.matchmaking-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileStatsModalLaunch).toBe(
      "ui.profile.stats-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileGameInfoModalLaunch).toBe(
      "ui.profile.game-info-modal.launch",
    );
    expect(UI_RUNTIME_ACTIONS.uiProfileGameInfoModalHide).toBe(
      "ui.profile.game-info-modal.hide",
    );
    expect(UI_RUNTIME_EVENTS.sessionModalClose).toBe("session.modal.close");
    expect(UI_RUNTIME_EVENTS.sessionStorageChanged).toBe(
      "session.storage.changed",
    );
    expect(UI_RUNTIME_EVENTS.sessionKeyboardChanged).toBe(
      "session.keyboard.changed",
    );
    expect(UI_RUNTIME_EVENTS.sessionLifecycleBeforeUnload).toBe(
      "session.lifecycle.before-unload",
    );
    expect(UI_RUNTIME_EVENTS.sessionNavigationPopstate).toBe(
      "session.navigation.popstate",
    );
    expect(UI_RUNTIME_EVENTS.sessionNavigationHashchange).toBe(
      "session.navigation.hashchange",
    );
    expect(UI_RUNTIME_EVENTS.uiReadLobbyStateLoading).toBe(
      "ui.read.lobby-state.loading",
    );
    expect(UI_RUNTIME_EVENTS.uiMatchmakingSearchLoading).toBe(
      "ui.matchmaking.search.loading",
    );
    expect(UI_RUNTIME_EVENTS.uiInGameBuildMenuSelected).toBe(
      "ui.ingame.build-menu.selected",
    );
    expect(UI_RUNTIME_EVENTS.uiInGameEventsDisplayToggleHidden).toBe(
      "ui.ingame.events-display.toggle-hidden",
    );
    expect(UI_RUNTIME_EVENTS.uiInGamePlayerPanelAction).toBe(
      "ui.ingame.player-panel.action",
    );
    expect(UI_RUNTIME_EVENTS.uiInGameSettingsModalSettingChange).toBe(
      "ui.ingame.settings-modal.setting-change",
    );
    expect(UI_RUNTIME_EVENTS.uiInGameUnitDisplayClick).toBe(
      "ui.ingame.unit-display.click",
    );
    expect(UI_RUNTIME_EVENTS.uiInGameLeaderboardSort).toBe(
      "ui.ingame.leaderboard.sort",
    );
    expect(UI_RUNTIME_EVENTS.uiInGameGameRightSidebarPause).toBe(
      "ui.ingame.game-right-sidebar.pause",
    );
    expect(UI_RUNTIME_EVENTS.uiInGamePerformanceOverlayReset).toBe(
      "ui.ingame.performance-overlay.reset",
    );
    expect(UI_RUNTIME_EVENTS.uiLobbyHostModalFormChange).toBe(
      "ui.lobby.host-modal.form-change",
    );
    expect(UI_RUNTIME_EVENTS.uiLobbyPublicClick).toBe("ui.lobby.public.click");
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameControlPanel).toBe(
      "ui.snapshot.ingame.control-panel",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePlayerPanel).toBe(
      "ui.snapshot.ingame.player-panel",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameLeaderboardEntries).toBe(
      "ui.snapshot.ingame.leaderboard-entries",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameSendResourceTotal).toBe(
      "ui.snapshot.ingame.send-resource-total",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameChatModalPlayers).toBe(
      "ui.snapshot.ingame.chat-modal.players",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyHostPlayers).toBe(
      "ui.snapshot.lobby.host-players",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyPublicData).toBe(
      "ui.snapshot.lobby.public.data",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutPlayPageState).toBe(
      "ui.snapshot.layout.play-page-state",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutFooterState).toBe(
      "ui.snapshot.layout.footer-state",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileAccountModalState).toBe(
      "ui.snapshot.profile.account-modal-state",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotProfilePatternInputState).toBe(
      "ui.snapshot.profile.pattern-input-state",
    );
    expect(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileTerritoryPatternsModalState,
    ).toBe("ui.snapshot.profile.territory-patterns-modal-state");
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileUserSettingModalState).toBe(
      "ui.snapshot.profile.user-setting-modal-state",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileMatchmakingModalState).toBe(
      "ui.snapshot.profile.matchmaking-modal-state",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileStatsModalState).toBe(
      "ui.snapshot.profile.stats-modal-state",
    );
    expect(UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileGameInfoModalState).toBe(
      "ui.snapshot.profile.game-info-modal-state",
    );
  });

  test("validates payloads for known action types", () => {
    expect(
      validateUiRuntimeActionPayload(UI_RUNTIME_ACTIONS.uiReadStatsRequest, {
        requestId: 1,
        reason: "open",
      }).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(UI_RUNTIME_ACTIONS.sessionStorageWrite, {
        storageKey: "gamesPlayed",
        value: "42",
      }).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(UI_RUNTIME_ACTIONS.sessionKeyboardState, {
        key: "t",
        code: "KeyT",
        isDown: true,
      }).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.sessionNavigationPopstate,
        {
          href: "https://openfront.io/#test",
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiReadLobbyStateRequest,
        {
          requestId: 1,
          reason: "open",
          lobbyId: "abc123",
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiMatchmakingSearchRequest,
        {
          requestId: 3,
          reason: "open",
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameBuildMenuLaunch,
        {
          translations: {
            notEnoughMoney: "Not enough money",
          },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameRadialMenuLaunch,
        {
          config: {
            backIcon: "/images/back.svg",
          },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameWinModalLaunch,
        {
          translations: {
            died: "You died",
            exit: "Exit",
          },
          isInIframe: false,
          gamesPlayed: 3,
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameRadialMenuShow,
        {
          items: [],
          centerButton: {
            icon: "icon",
            color: "#000000",
            iconSize: 42,
            disabled: false,
          },
          x: 10,
          y: 20,
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameWinModalShow,
        {
          title: "Victory",
          isWin: true,
          contentType: "pattern_button",
          cosmetics: { purchasablePatterns: [] },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameEmojiTableLaunch,
        {
          emojis: ["\ud83d\ude00", "\ud83d\udc4d"],
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiHudHeadsUpToastShow,
        {
          message: "Hello",
          color: "green",
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameLeaderboardLaunch,
        {
          entries: [],
          translations: {
            player: "Player",
          },
          showTopFive: true,
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameSendResourceModalShow,
        {
          state: {
            mode: "troops",
            total: 10,
          },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameChatModalLaunch,
        {
          state: { isOpen: true },
          players: [],
          quickChatPhrases: {},
          translations: {},
          phraseTranslations: {},
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGamePlayerModerationModalLaunch,
        {
          state: { isOpen: true },
          myPlayer: { id: "1" },
          targetPlayer: { id: "2" },
          translations: {},
          kickIcon: "/images/kick.svg",
          shieldIcon: "/images/shield.svg",
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiInGameMultiTabModalShow,
        {
          durationMs: 5000,
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiHostLobbyModalLaunch,
        {
          translations: { title: "Host" },
          maps: [],
          difficulties: [],
          unitOptions: [],
          teamCountOptions: [],
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyUpdateLobbyId,
        {
          lobbyId: "abc123",
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(UI_RUNTIME_ACTIONS.uiPublicLobbyLaunch, {
        translations: { join: "Join" },
      }).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(UI_RUNTIME_ACTIONS.uiLayoutPlayPageLaunch, {})
        .ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiProfileSinglePlayerModalLaunch,
        {
          translations: { title: "Singleplayer" },
          maps: [],
          difficulties: [],
          unitOptions: [],
          teamCountOptions: [],
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiProfileTerritoryPatternsModalLaunch,
        {
          state: { isVisible: true },
          translations: { title: "Patterns" },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeActionPayload(
        UI_RUNTIME_ACTIONS.uiProfileGameInfoModalHide,
        {},
      ).ok,
    ).toBe(true);

    const missingRequired = validateUiRuntimeActionPayload(
      UI_RUNTIME_ACTIONS.uiReadStatsRequest,
      {},
    );
    expect(missingRequired.ok).toBe(false);

    const missingInGameRequired = validateUiRuntimeActionPayload(
      UI_RUNTIME_ACTIONS.uiInGameBuildMenuShow,
      {},
    );
    expect(missingInGameRequired.ok).toBe(false);
    const missingChatLaunchRequired = validateUiRuntimeActionPayload(
      UI_RUNTIME_ACTIONS.uiInGameChatModalLaunch,
      {
        state: {},
        players: [],
      },
    );
    expect(missingChatLaunchRequired.ok).toBe(false);
    const missingLaunchRequired = validateUiRuntimeActionPayload(
      UI_RUNTIME_ACTIONS.uiInGameWinModalLaunch,
      {
        translations: {},
      },
    );
    expect(missingLaunchRequired.ok).toBe(false);
    const missingProfileLaunchRequired = validateUiRuntimeActionPayload(
      UI_RUNTIME_ACTIONS.uiProfileLanguageModalLaunch,
      {
        languageList: [],
      },
    );
    expect(missingProfileLaunchRequired.ok).toBe(false);
    const missingProfileStateRequired = validateUiRuntimeActionPayload(
      UI_RUNTIME_ACTIONS.uiProfileStatsModalLaunch,
      {
        translations: {},
      },
    );
    expect(missingProfileStateRequired.ok).toBe(false);

    const unknownAction = validateUiRuntimeActionPayload(
      "ui.unknown.custom-action",
      null,
    );
    expect(unknownAction.ok).toBe(true);
  });

  test("validates payloads for known snapshot types", () => {
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameControlPanel,
        {
          state: { isVisible: true },
        },
      ).ok,
    ).toBe(true);

    const missingRequired = validateUiRuntimeSnapshotPayload(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameControlPanel,
      {},
    );
    expect(missingRequired.ok).toBe(false);

    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotInGamePlayerPanel,
        {
          state: { isVisible: false },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameLeaderboardEntries,
        {
          entries: [],
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameSendResourceTotal,
        {
          total: 1,
          mode: "troops",
          capacityLeft: 2,
          hasCapacity: true,
          targetAlive: true,
          senderAlive: true,
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameChatModalPlayers,
        {
          players: [],
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyHostPlayers,
        {
          players: [],
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyPublicData,
        {
          data: {
            gameId: "abc123",
            isVisible: true,
          },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotLayoutPlayPageState,
        {
          state: { isVisible: true },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileFlagInputState,
        {
          state: {
            flag: "us",
            showSelectLabel: true,
          },
        },
      ).ok,
    ).toBe(true);
    expect(
      validateUiRuntimeSnapshotPayload(
        UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileGameInfoModalState,
        {
          state: {
            isVisible: true,
          },
        },
      ).ok,
    ).toBe(true);
    const missingProfileSnapshotState = validateUiRuntimeSnapshotPayload(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileMatchmakingModalState,
      {},
    );
    expect(missingProfileSnapshotState.ok).toBe(false);
  });
});
