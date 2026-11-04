import {
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Trios,
} from "@openfront/engine-api/game/GameTypes";
import { MapManifest } from "@openfront/engine-api/game/MapFiles";
import { maps } from "@openfront/engine-api/game/Maps.gen";
import { GameConfig, TeamCountConfig } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { createNationsForGame } from "@openfront/engine/game/NationCreation";
import {
  createPartialGameRecord,
  replacer,
  toWireGameStartInfo,
} from "@openfront/shared/SharedUtil";
import {
  ArchivedAnalyticsRecordSchema,
  GameRecordSchema,
  PlayerRecord,
  WireGameStartInfo,
  WirePlayerSchema,
} from "@openfront/shared/WireSchemas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { setup } from "./util/Setup";
import { testGameConfig } from "./util/Wire";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real World manifest, so the game gets exactly the nations a live World
// game does (the record derives the count from Maps.gen).
const worldManifest = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../resources/maps/world/manifest.json"),
    "utf8",
  ),
) as MapManifest;

type Seat = {
  clan?: string;
  friends?: number[];
  teamIndex?: number;
};

const clientID = (i: number) => `Pl${String(i).padStart(6, "0")}`;

function startInfo(config: GameConfig, seats: Seat[]): WireGameStartInfo {
  return {
    gameID: "tEAm1234",
    lobbyCreatedAt: 0,
    config,
    players: seats.map((s, i) => ({
      clientID: clientID(i),
      username: `player${i}`,
      clanTag: s.clan ?? null,
      friends: s.friends?.map(clientID),
      teamIndex: s.teamIndex,
    })),
  };
}

// Builds the game the way every client does (createGameRunner): from the
// start info the server sends (clan tags and friends blanked as configured),
// with the map's nations.
async function playedTeams(info: WireGameStartInfo) {
  const gameStart = toWireGameStartInfo(info);
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const humans = gameStart.players.map(
    (p) =>
      new PlayerInfo(
        p.username,
        PlayerType.Human,
        p.clientID,
        random.nextID(),
        p.isLobbyCreator ?? false,
        p.clanTag,
        p.friends ?? [],
        p.teamIndex ?? null,
      ),
  );
  const nations = createNationsForGame(
    gameStart,
    worldManifest.nations,
    worldManifest.additionalNations ?? [],
    humans.length,
    random,
  );
  const game = await setup(
    "plains",
    gameStart.config,
    humans,
    undefined,
    undefined,
    true,
    nations,
  );
  return gameStart.players.map(
    (p) => game.playerByClientID(p.clientID)?.team() ?? undefined,
  );
}

// What GameServer.archiveGame records for the same start info.
function recordedTeams(info: WireGameStartInfo) {
  const players: PlayerRecord[] = info.players.map((p) => ({
    ...p,
    persistentID: null,
    stats: undefined,
  }));
  const record = createPartialGameRecord(
    info.gameID,
    info.config,
    players,
    [],
    0,
    1000,
    undefined,
  );
  return record.info.players.map((p) => p.team);
}

async function expectRecordMatchesGame(info: WireGameStartInfo) {
  const played = await playedTeams(info);
  expect(recordedTeams(info)).toEqual(played);
  return played;
}

const teamConfig = (
  playerTeams: TeamCountConfig,
  overrides: Partial<GameConfig> = {},
) =>
  testGameConfig({
    gameMap: GameMapType.World,
    gameMode: GameMode.Team,
    playerTeams,
    ...overrides,
  });

describe("recorded teams (match telemetry)", () => {
  it("assumes Maps.gen's nation count matches the World manifest", () => {
    const world = maps.find((m) => m.type === GameMapType.World)!;
    expect(world.defaultNationCount).toBe(worldManifest.nations.length);
  });

  it("records each player's in-game team: private Duos with clans and friends", async () => {
    const played = await expectRecordMatchesGame(
      startInfo(teamConfig(Duos), [
        { clan: "AAA" },
        { friends: [4] },
        { clan: "AAA" },
        { clan: "BBB" },
        { friends: [1] },
        {},
        { clan: "BBB" },
      ]),
    );
    expect(played.every((t) => t !== undefined)).toBe(true);
    // Clans and mutual friends share a team.
    expect(played[0]).toBe(played[2]);
    expect(played[3]).toBe(played[6]);
    expect(played[1]).toBe(played[4]);
  });

  it("records each player's in-game team: public numbered teams, uneven counts", async () => {
    await expectRecordMatchesGame(
      startInfo(teamConfig(3, { gameType: GameType.Public }), [
        { clan: "AAA" },
        { clan: "AAA" },
        { clan: "AAA" },
        { friends: [4, 5] },
        { friends: [5] },
        {},
        { clan: "CCC" },
        {},
        { friends: [0] },
        {},
      ]),
    );
  });

  it("records each player's in-game team: public compact Quads", async () => {
    await expectRecordMatchesGame(
      startInfo(
        teamConfig(Quads, {
          gameType: GameType.Public,
          gameMapSize: GameMapSize.Compact,
        }),
        [{ clan: "AAA" }, { clan: "AAA" }, {}, { friends: [4] }, {}, {}],
      ),
    );
  });

  it("records each player's in-game team: Trios with a custom nation count", async () => {
    await expectRecordMatchesGame(
      startInfo(teamConfig(Trios, { nations: 5 }), [
        { clan: "AAA" },
        {},
        { clan: "AAA" },
        { friends: [1] },
      ]),
    );
  });

  it("records Humans vs Nations as the Humans team", async () => {
    const played = await expectRecordMatchesGame(
      startInfo(teamConfig(HumansVsNations, { gameType: GameType.Public }), [
        { clan: "AAA" },
        {},
        { friends: [1] },
      ]),
    );
    expect(played).toEqual(["Humans", "Humans", "Humans"]);
  });

  it("records matchmade pins as their team", async () => {
    await expectRecordMatchesGame(
      startInfo(teamConfig(2, { nations: "disabled" }), [
        { clan: "AAA", teamIndex: 1 },
        { clan: "AAA", teamIndex: 1 },
        { clan: "BBB", teamIndex: 0 },
        { clan: "BBB", teamIndex: 0 },
      ]),
    );
  });

  it("records no team for clan overflow players the game kicks", async () => {
    const played = await expectRecordMatchesGame(
      startInfo(teamConfig(2, { nations: "disabled" }), [
        { clan: "AAA" },
        { clan: "AAA" },
        { clan: "AAA" },
        { clan: "AAA" },
        { clan: "AAA" },
        {},
      ]),
    );
    // Teams of 3: two of the clan don't fit and never spawn.
    expect(played.filter((t) => t === undefined)).toHaveLength(2);
  });

  it("uses the blanked clan tags and friends the clients simulated with", async () => {
    const seats: Seat[] = [
      { clan: "AAA" },
      { clan: "AAA", friends: [3] },
      { clan: "AAA" },
      { friends: [1] },
      {},
      {},
    ];
    for (const overrides of [
      { disableClanTags: true },
      { anonymizeNames: true },
    ]) {
      await expectRecordMatchesGame(
        startInfo(teamConfig(2, { nations: 2, ...overrides }), seats),
      );
    }
  });

  it("matches the game across many random lobbies", async () => {
    const random = new PseudoRandom(42);
    const teamConfigs: TeamCountConfig[] = [Duos, Trios, Quads, 2, 3, 5, 9];
    for (let lobby = 0; lobby < 40; lobby++) {
      const numPlayers = random.nextInt(1, 25);
      const seats: Seat[] = [];
      for (let i = 0; i < numPlayers; i++) {
        const seat: Seat = {};
        if (random.chance(3)) seat.clan = random.randElement(["AAA", "BB"]);
        if (random.chance(3)) seat.friends = [random.nextInt(0, numPlayers)];
        seats.push(seat);
      }
      const config = teamConfig(random.randElement(teamConfigs), {
        gameType: random.chance(2) ? GameType.Public : GameType.Private,
        gameMapSize: random.chance(2)
          ? GameMapSize.Compact
          : GameMapSize.Normal,
        nations: random.randElement<GameConfig["nations"]>([
          "default",
          "disabled",
          random.nextInt(1, 30),
        ]),
      });
      await expectRecordMatchesGame(startInfo(config, seats));
    }
  });

  it("records nothing in FFA", () => {
    expect(
      recordedTeams(startInfo(testGameConfig(), [{ clan: "AAA" }, {}])),
    ).toEqual([undefined, undefined]);
  });

  it("survives the archive round trip and stays off the start message", () => {
    const info = startInfo(teamConfig(2, { nations: "disabled" }), [
      { clan: "AAA" },
      {},
    ]);
    const record = createPartialGameRecord(
      info.gameID,
      info.config,
      info.players.map((p) => ({ ...p, persistentID: null, stats: {} })),
      [],
      0,
      1000,
      undefined,
    );
    const json = JSON.parse(
      JSON.stringify({ ...record, gitCommit: "DEV" }, replacer),
    );
    const teams = record.info.players.map((p) => p.team);
    expect(teams.every((t) => t !== undefined)).toBe(true);
    expect(
      GameRecordSchema.parse(json).info.players.map((p) => p.team),
    ).toEqual(teams);
    expect(
      ArchivedAnalyticsRecordSchema.parse(json).info.players.map((p) => p.team),
    ).toEqual(teams);
    // Only the record carries it: the binary start message is unchanged.
    expect("team" in WirePlayerSchema.shape).toBe(false);
  });
});
