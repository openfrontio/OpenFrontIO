import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  GameConfig,
  GameID,
  Tribe,
  Turn,
  Winner,
} from "@openfront/engine-api/Schemas";
import { resolveTribeNameData } from "@openfront/engine-lib/execution/utils/TribeNames";
import { LOBBY_LABEL_MAX, simpleHash } from "@openfront/engine-lib/Util";
import DOMPurify from "dompurify";
import { customAlphabet } from "nanoid";
import {
  GameRecord,
  PartialGameRecord,
  PlayerRecord,
  PlayerReport,
  PublicGameType,
  WireGameStartInfo,
} from "./WireSchemas";

export function sanitize(name: string): string {
  return Array.from(name)
    .join("")
    .replace(/[^\p{L}\p{N}\s\p{Emoji}\p{Emoji_Component}[\]_]/gu, "");
}

export function onlyImages(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span", "img"],
    ALLOWED_ATTR: ["src", "alt", "class", "style"],
    ALLOWED_URI_REGEXP: /^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji/,
    ADD_ATTR: ["style"],
  });
}

// Replays rebuild GameStartInfo from the archived record, which keeps
// players' real clanTag and friends (analytics reads them). Live clients
// never simulated with those: the server blanks clanTag when clan tags are
// disabled, and clanTag + friends when names are anonymized — identically
// for every client, because both feed deterministic team assignment
// (TeamAssignment.ts). Mirrors GameServer.start() (wireGameStartInfo) and
// startInfoFor(); replays must apply the same blanking before simulating,
// or team games with either setting diverge from the recorded hashes.
// Singleplayer records were simulated (and archived) with the real values —
// no server, no blanking — so they replay as-is.
export function toWireGameStartInfo(
  info: WireGameStartInfo,
): WireGameStartInfo {
  const config = info.config;
  if (config.gameType === GameType.Singleplayer) {
    return info;
  }
  const blankClanTags =
    (config.disableClanTags ?? false) || (config.anonymizeNames ?? false);
  const blankFriends = config.anonymizeNames ?? false;
  if (!blankClanTags && !blankFriends) {
    return info;
  }
  return {
    ...info,
    players: info.players.map((p) => ({
      ...p,
      clanTag: blankClanTags ? null : p.clanTag,
      friends: blankFriends ? undefined : p.friends,
    })),
  };
}

export function createPartialGameRecord(
  gameID: GameID,
  config: GameConfig,
  // username does not need to be set.
  players: PlayerRecord[],
  allTurns: Turn[],
  start: number,
  end: number,
  winner: Winner,
  // lobby creation time (ms). Defaults to start time for singleplayer.
  lobbyCreatedAt?: number,
  // Time the lobby became visible to players (ms).
  visibleAt?: number,
  // Purchased bot tribe names in use this game (public games only). Infra
  // ingest reads them from the record for owner appearance stats, and
  // replays rebuild GameStartInfo from the record so the same names spawn.
  tribes?: Tribe[],
  // Player reports filed during the game (multiplayer only; see
  // GameServer.handleReport). The API ingests them for moderation.
  reports?: PlayerReport[],
  // Public lobbies only (see GameEndInfoSchema.publicGameType).
  publicGameType?: PublicGameType,
  // Game servers only (see GameEndInfoSchema.statsAgreed).
  statsAgreed?: boolean,
): PartialGameRecord {
  const duration = Math.floor((end - start) / 1000);
  const num_turns = allTurns.length;
  const turns = allTurns.filter(
    (t) => t.intents.length !== 0 || t.hash !== undefined,
  );

  // Use start time as lobby creation time for singleplayer
  const actualLobbyCreatedAt = lobbyCreatedAt ?? start;
  const lobbyFillTime = Math.max(
    0,
    start - (visibleAt ?? actualLobbyCreatedAt),
  );

  const record: PartialGameRecord = {
    info: {
      gameID,
      lobbyCreatedAt: actualLobbyCreatedAt,
      visibleAt,
      lobbyFillTime,
      config,
      players,
      start,
      end,
      duration,
      num_turns,
      winner,
      tribes,
      reports,
      publicGameType,
      statsAgreed,
    },
    version: "v0.0.2",
    turns,
  };
  return record;
}

export function decompressGameRecord(gameRecord: GameRecord) {
  const turns: Turn[] = [];
  let lastTurnNum = -1;
  for (const turn of gameRecord.turns) {
    while (lastTurnNum < turn.turnNumber - 1) {
      lastTurnNum++;
      turns.push({
        turnNumber: lastTurnNum,
        intents: [],
      });
    }
    turns.push(turn);
    lastTurnNum = turn.turnNumber;
  }
  const turnLength = turns.length;
  for (let i = turnLength; i < gameRecord.info.num_turns; i++) {
    turns.push({
      turnNumber: i,
      intents: [],
    });
  }
  gameRecord.turns = turns;
  return gameRecord;
}

export function generateID(): GameID {
  const nanoid = customAlphabet(
    "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
    8,
  );
  return nanoid();
}

// Multi-server game id (docs/MultiServer.md): the minting deployment's
// instance letter + 9 random chars. The 9 random chars carry uniqueness
// (game ids are permanent archive keys, sized against every game ever
// minted) and private-lobby unguessability; worker routing hashes the full
// id, extracting the worker index from entropy that must exist anyway.
// generateID() stays 8 chars for the ids that never leave one server or one
// client: client ids, singleplayer games, worker message ids.
export function generateGameID(instanceLetter: string): GameID {
  const nanoid = customAlphabet(
    "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
    9,
  );
  return instanceLetter + nanoid();
}

export function createRandomName(
  name: string,
  playerType: PlayerType,
): string | null {
  let randomName: string | null = null;
  if (playerType === PlayerType.Human) {
    const { prefixes, suffixes } = resolveTribeNameData();
    const hash = simpleHash(name);
    const prefixIndex = hash % prefixes.length;
    const suffixIndex = Math.floor(hash / prefixes.length) % suffixes.length;

    randomName = `👤 ${prefixes[prefixIndex]} ${suffixes[suffixIndex]}`;
  }
  return randomName;
}

/**
 * JSON.stringify replacer function that converts bigint values to strings.
 */
export function replacer(_key: string, value: any): any {
  return typeof value === "bigint" ? value.toString() : value;
}

const CLAN_TAG_CHARS = "a-zA-Z0-9";

const CLAN_TAG_INVALID_CHARS = new RegExp(`[^${CLAN_TAG_CHARS}]`, "g");

export function sanitizeClanTag(tag: string): string {
  return tag.replace(CLAN_TAG_INVALID_CHARS, "").substring(0, 5).toUpperCase();
}

// A featured lobby's label is host-supplied text shown in the lobby browser, so
// it is sanitised before it can reach anyone: control characters and bidi
// overrides stripped (they let text render as something entirely different),
// whitespace collapsed, then length-capped. Rendered as TEXT, never markup —
// emoji work because they are ordinary codepoints.
export function sanitizeLobbyLabel(raw: string): string {
  const kept: string[] = [];
  // Iterated by CODE POINT, not code unit: an emoji is a surrogate pair, and
  // slicing one in half is how a label turns into a replacement glyph.
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    // Tab/newline/vertical tab/form feed/carriage return are C0 controls, but
    // they are also word separators: dropping them outright would weld
    // "Europe\nScrims" into "EuropeScrims". They become spaces, and the
    // collapse below folds any run of them into one.
    if (cp === 0x09 || (cp >= 0x0a && cp <= 0x0d)) {
      kept.push(" ");
      continue;
    }
    if (cp < 0x20 || cp === 0x7f) continue; // other C0 controls and DEL
    if (cp >= 0x80 && cp <= 0x9f) continue; // C1 controls
    // Bidi overrides, isolates and marks: they make following text render in
    // another direction, which is how a label claims to be something it isn't.
    if (cp >= 0x202a && cp <= 0x202e) continue;
    if (cp >= 0x2066 && cp <= 0x2069) continue;
    if (cp === 0x200e || cp === 0x200f) continue;
    if (cp === 0x061c) continue; // ARABIC LETTER MARK — zero-width, bidi-active
    // NB: U+200D ZERO WIDTH JOINER is deliberately KEPT — emoji sequences like
    // 👨‍👩‍👧 are built from it, and stripping it would break them apart.
    kept.push(ch);
  }
  return Array.from(kept.join("").replace(/\s+/g, " ").trim())
    .slice(0, LOBBY_LABEL_MAX)
    .join("");
}
