export function joinLobby(
  lobbyConfig: LobbyConfig,
  onPrestart: () => void,
  onJoin: () => void,
): () => void {
  const eventBus = new EventBus();

  console.log(
    `joining lobby: gameID: ${lobbyConfig.gameID}, clientID: ${lobbyConfig.clientID}`,
  );

  const userSettings: UserSettings = new UserSettings();
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config ?? {});

  const transport = new Transport(lobbyConfig, eventBus);

  // Create and append modal
  const modal = document.createElement("game-starting-modal") as GameStartingModal;
  document.body.appendChild(modal);

  const onconnect = () => {
    console.log(`Joined game lobby ${lobbyConfig.gameID}`);
    transport.joinGame(0);
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type === "prestart") {
      console.log(`lobby: game prestarting: ${JSON.stringify(message)}`);
      terrainLoad = loadTerrainMap(message.gameMap);
      // Show modal during prestart
      modal.show();
      onPrestart();
    }
    if (message.type === "start") {
      // Ensure modal is shown for singleplayer games
      if (!modal.isVisible) {
        modal.show();
      }
      console.log(`lobby: game started: ${JSON.stringify(message, null, 2)}`);
      onJoin();
      lobbyConfig.gameStartInfo = message.gameStartInfo;
      createClientGame(
        lobbyConfig,
        eventBus,
        transport,
        userSettings,
        terrainLoad,
      ).then((r) => r.start());
    }
  };
  transport.connect(onconnect, onmessage);
  return () => {
    console.log("leaving game");
    transport.leaveGame();
    modal.remove(); // Clean up modal
  };
}
