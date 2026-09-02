import { anonWordName } from "../core/AnonNames";
import { GameMode } from "../core/game/Game";
import { ClientID, GameConfig, GameInfo, GameStartInfo } from "../core/Schemas";
import { simpleHash } from "../core/Util";
import { Client } from "./Client";

// Who may see whose real identity, and what each viewer is shown instead.
//
// The NameVisibility rules are display-only: they shape the per-viewer wire
// payloads (the lobby roster and the start message), never the simulation or
// the archived record, so they cannot desync (see #4426). friendsLookup is
// the one thing here the simulation does read — start() writes its result
// into gameStartInfo.players[].friends, which feeds team assignment — which
// is why it takes no viewer and is identical on every client.

// What the rules read from the game. Thunks rather than values: the config
// is edited in the lobby and the roster grows, and both are read at the
// moment a payload is built.
export interface NameVisibilityView {
  gameID: string;
  config: () => Pick<
    GameConfig,
    | "anonymizeNames"
    | "nameReveals"
    | "nameRevealPublicIds"
    | "gameMode"
    | "disableClanTags"
  >;
  // Every client that ever joined, in join order — the order fixes each
  // player's anonymous-name slot.
  clients: () => ReadonlyMap<ClientID, Client>;
  // The client's pinned matchmade team, or undefined outside one.
  teamIndex: (client: Client) => number | undefined;
}

export type LobbyClient = NonNullable<GameInfo["clients"]>[number];

export class NameVisibility {
  constructor(private readonly view: NameVisibilityView) {}

  // anonymizeNames: only players the host granted (nameReveals, or by account via
  // nameRevealPublicIds) see real names. Nobody is exempt by default, not even the
  // host, until he grants them.
  private viewerSeesAllNames(viewer: ClientID | undefined): boolean {
    if (viewer === undefined) return false;
    const config = this.view.config();
    if (config.nameReveals?.includes(viewer) ?? false) return true;
    // Resolve the per-game clientID to its stable account publicId so a host that
    // only knows publicIds (the admin bot) can grant reveal access at create_game.
    const publicId = this.view.clients().get(viewer)?.publicId;
    return (
      publicId !== undefined &&
      (config.nameRevealPublicIds?.includes(publicId) ?? false)
    );
  }

  // Same (viewer, target) -> same name in the lobby and in-game.
  //
  // The target's slot is its join-order position in the client map (an
  // insertion-ordered Map): stable for the whole game, and late-joiners simply
  // append, so existing players' names never shift. Distinct targets have
  // distinct slots, and anonWordName maps distinct slots (at a fixed offset) to
  // distinct handles — so within any one viewer's view no two players ever share
  // a name. The per-viewer offset rotates the animal assignment, so different
  // viewers still see different names for the same player (the anti-team point).
  anonName(viewer: ClientID | undefined, target: ClientID): string {
    let slot = 0;
    for (const id of this.view.clients().keys()) {
      if (id === target) break;
      slot++;
    }
    return anonWordName(slot, this.anonOffsetSeed(viewer));
  }

  // Rotates the animal assignment so viewers see different fake names for the
  // same player. Seeded by TEAM for a matchmade viewer: teammates already see
  // each other's real names, but were still shown different fake names for the
  // same opponent, so they could not call a target. Everyone outside the team
  // keeps their own rotation, so anti-teaming holds across the boundary.
  private anonOffsetSeed(viewer: ClientID | undefined): number {
    if (viewer === undefined) return 0;
    const client = this.view.clients().get(viewer);
    const team = client === undefined ? undefined : this.view.teamIndex(client);
    return team === undefined
      ? simpleHash(viewer)
      : simpleHash(`${this.view.gameID}:team:${team}`);
  }

  // Teammates in a matchmade game. Anonymizing a player from their own team makes
  // the team unplayable — you cannot coordinate with someone you cannot identify —
  // so a pinned team sees itself, exactly as a player already sees themselves.
  // Only PINNED teams: those are assigned server-side, so the server knows them
  // here. A team game that groups by clanTag/friends is resolved on the clients,
  // and the server has no answer to give.
  private sameMatchmadeTeam(
    viewer: ClientID | undefined,
    target: ClientID,
  ): boolean {
    if (viewer === undefined) return false;
    const clients = this.view.clients();
    const viewerClient = clients.get(viewer);
    const targetClient = clients.get(target);
    if (viewerClient === undefined || targetClient === undefined) return false;
    const viewerTeam = this.view.teamIndex(viewerClient);
    return (
      viewerTeam !== undefined &&
      viewerTeam === this.view.teamIndex(targetClient)
    );
  }

  // The reveal reasons that predate teammate visibility: names are not
  // anonymized at all, the viewer is looking at themselves, or the host granted
  // reveal access (nameReveals). Split out because these carry the FULL identity,
  // while a teammate reveal is deliberately narrower — see lobbyClients.
  seesRealBeyondTeam(viewer: ClientID | undefined, target: ClientID): boolean {
    return (
      !this.view.config().anonymizeNames ||
      target === viewer ||
      this.viewerSeesAllNames(viewer)
    );
  }

  // Whether the viewer should see the target's real identity: names aren't
  // anonymized, when looking at themselves, when on the same pinned team, or when
  // the host granted the viewer reveal access (nameReveals).
  seesReal(viewer: ClientID | undefined, target: ClientID): boolean {
    return (
      this.seesRealBeyondTeam(viewer, target) ||
      this.sameMatchmadeTeam(viewer, target)
    );
  }

  // Per-viewer start info. `real` is the game's own start info and is never
  // touched, so the archived record keeps real identities; `wire` is the
  // shared copy clients receive (clan tags already stripped when the lobby
  // disables them). clanTag and friends feed the deterministic team
  // assignment (TeamAssignment.ts), so they are blanked for every player
  // here, identical on every client, never per-viewer, or clients desync.
  // Only the username of players this viewer can't see is anonymized, and
  // their cosmetics hidden, neither of which the simulation reads.
  //
  // Exception: admins in FFA get the real clan tags (the display pipeline then
  // shows them everywhere) so they can spot teaming live. Safe ONLY in FFA —
  // that mode never runs assignTeams, so clanTag never reaches the simulation,
  // and the desync hash (Player.hash) excludes names. Gated on FFA, NOT
  // disableClanTags: a Team game with tags disabled DOES assign teams by
  // clanTag, so a per-viewer reveal there would desync.
  startInfoFor(
    viewer: ClientID,
    isAdmin: boolean,
    real: GameStartInfo,
    wire: GameStartInfo,
  ): GameStartInfo {
    const config = this.view.config();
    const revealClanTags = isAdmin && config.gameMode === GameMode.FFA;
    if (!config.anonymizeNames) {
      return revealClanTags ? real : wire;
    }
    return {
      ...wire,
      players: wire.players.map((p, i) => {
        const seesReal = this.seesReal(viewer, p.clientID);
        return {
          ...p,
          username: seesReal ? p.username : this.anonName(viewer, p.clientID),
          clanTag: revealClanTags ? real.players[i].clanTag : null,
          friends: undefined,
          cosmetics: seesReal ? p.cosmetics : undefined,
        };
      }),
    };
  }

  // The lobby roster as `viewer` may see it. Everyone connected, spectators
  // included and flagged: they are not in the simulation, but the lobby is
  // the same view for them as for a player — filtering them out emptied the
  // roster of a lobby they were alone in. Omitting the viewer (the HTTP
  // /api/game/:id and link-preview routes) anonymizes all names when the
  // option is on.
  lobbyClients(
    viewer: ClientID | undefined,
    active: readonly Client[],
  ): LobbyClient[] {
    const friendsFor = friendsLookup(active);
    const config = this.view.config();
    const hideClanTags = config.disableClanTags ?? false;
    return active.map((c) => {
      if (!this.seesReal(viewer, c.clientID)) {
        return {
          username: this.anonName(viewer, c.clientID),
          clanTag: null,
          clientID: c.clientID,
          spectator: c.spectator || undefined,
          teamIndex: this.view.teamIndex(c),
        };
      }
      // A TEAMMATE reveal is deliberately narrower than the others. Seeing a
      // teammate's clanTag and friends would hand out more than the identity
      // needed to coordinate: `friends` in particular names a THIRD party —
      // the viewer would learn their teammate is friends with a specific
      // still-anonymized opponent, which the host never granted. The wider
      // reveals (self, or host-granted nameReveals) keep the full payload.
      const teammateOnly =
        config.anonymizeNames && !this.seesRealBeyondTeam(viewer, c.clientID);
      return {
        username: c.username,
        clanTag: teammateOnly || hideClanTags ? null : (c.clanTag ?? null),
        clientID: c.clientID,
        friends: teammateOnly ? undefined : friendsFor(c),
        verified: c.cosmetics?.verified,
        spectator: c.spectator || undefined,
        teamIndex: this.view.teamIndex(c),
      };
    });
  }
}

// Maps each active client's publicId-based friends list to in-game
// clientIDs, dropping friends not present in this game. Returns undefined
// when no friends are present so the field can be omitted from the wire
// payload.
export function friendsLookup(
  active: readonly Client[],
): (client: Client) => ClientID[] | undefined {
  const publicIdToClientID = new Map<string, ClientID>();
  for (const c of active) {
    // Spectators are not in the simulation, and friends feed team assignment —
    // a player befriending a caster would be teamed with a clientID that never
    // spawns.
    if (c.publicId && !c.spectator)
      publicIdToClientID.set(c.publicId, c.clientID);
  }
  return (client: Client) => {
    const friendClientIDs = client.friends
      .map((pid) => publicIdToClientID.get(pid))
      .filter((id): id is ClientID => id !== undefined);
    return friendClientIDs.length > 0 ? friendClientIDs : undefined;
  };
}
