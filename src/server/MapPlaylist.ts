import { GameMapType, GameMode } from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";

enum PlaylistType {
  BigMaps,
  SmallMaps,
}

const random = new PseudoRandom(123);

export class MapPlaylist {
  private gameModeRotation = [GameMode.FFA, GameMode.FFA, GameMode.Team];
  private currentGameModeIndex = 0;

  private mapsPlaylistBig: GameMapType[] = [];
  private mapsPlaylistSmall: GameMapType[] = [];
  private currentPlaylistCounter = 0;

  // Get the next map in rotation
  public getNextMap(): GameMapType {
    const playlistType: PlaylistType = this.getNextPlaylistType();
    const mapsPlaylist: GameMapType[] = this.getNextMapsPlayList(playlistType);
    return mapsPlaylist.shift()!;
  }

  private gameModeHistory: GameMode[] = [];

  public getNextGameMode(): GameMode {
    const FFA_WEIGHT = 2;
    const TEAM_WEIGHT = 1;
    const MAX_HISTORY = 2;

    const last = this.gameModeHistory[this.gameModeHistory.length - 1];
    const secondLast = this.gameModeHistory[this.gameModeHistory.length - 2];

    // Avoid repeating the same game mode 3 times in a row
    if (last === secondLast && last !== undefined) {
      const opposite = last === GameMode.FFA ? GameMode.Team : GameMode.FFA;
      this.gameModeHistory.push(opposite);
      if (this.gameModeHistory.length > MAX_HISTORY)
        this.gameModeHistory.shift();
      return opposite;
    }

    const roll = Math.floor(Math.random() * (FFA_WEIGHT + TEAM_WEIGHT));
    const next = roll < FFA_WEIGHT ? GameMode.FFA : GameMode.Team;

    this.gameModeHistory.push(next);
    if (this.gameModeHistory.length > MAX_HISTORY) this.gameModeHistory.shift();

    return next;
  }

  private getNextMapsPlayList(playlistType: PlaylistType): GameMapType[] {
    switch (playlistType) {
      case PlaylistType.BigMaps:
        if (!(this.mapsPlaylistBig.length > 0)) {
          this.fillMapsPlaylist(playlistType, this.mapsPlaylistBig);
        }
        return this.mapsPlaylistBig;

      case PlaylistType.SmallMaps:
        if (!(this.mapsPlaylistSmall.length > 0)) {
          this.fillMapsPlaylist(playlistType, this.mapsPlaylistSmall);
        }
        return this.mapsPlaylistSmall;
    }
  }

  private fillMapsPlaylist(
    playlistType: PlaylistType,
    mapsPlaylist: GameMapType[],
  ): void {
    const frequency = this.getFrequency(playlistType);
    Object.keys(GameMapType).forEach((key) => {
      let count = parseInt(frequency[key]);
      while (count > 0) {
        mapsPlaylist.push(GameMapType[key]);
        count--;
      }
    });
    do {
      random.shuffleArray(mapsPlaylist);
    } while (!this.allNonConsecutive(mapsPlaylist));
  }

  private mapHistory: PlaylistType[] = [];

  private getNextPlaylistType(): PlaylistType {
    // Keep approx. 2/3 BigMaps, 1/3 SmallMaps
    const BIG_WEIGHT = 2;
    const SMALL_WEIGHT = 1;
    const MAX_HISTORY = 2;

    const last = this.mapHistory[this.mapHistory.length - 1];
    const secondLast = this.mapHistory[this.mapHistory.length - 2];

    // Avoid repeating the same map type 3 times in a row
    if (last === secondLast && last !== undefined) {
      const opposite =
        last === PlaylistType.BigMaps
          ? PlaylistType.SmallMaps
          : PlaylistType.BigMaps;
      this.mapHistory.push(opposite);
      if (this.mapHistory.length > MAX_HISTORY) this.mapHistory.shift();
      return opposite;
    }

    // Weighted random
    const roll = Math.floor(Math.random() * (BIG_WEIGHT + SMALL_WEIGHT));
    const next =
      roll < BIG_WEIGHT ? PlaylistType.BigMaps : PlaylistType.SmallMaps;

    this.mapHistory.push(next);
    if (this.mapHistory.length > MAX_HISTORY) this.mapHistory.shift();

    return next;
  }

  private getFrequency(playlistType: PlaylistType) {
    switch (playlistType) {
      // Big Maps are those larger than ~2.5 mil pixels
      case PlaylistType.BigMaps:
        return {
          Europe: 2,
          NorthAmerica: 1,
          Africa: 2,
          Britannia: 1,
          GatewayToTheAtlantic: 2,
          Australia: 2,
          Iceland: 2,
          SouthAmerica: 1,
          KnownWorld: 2,
          DeglaciatedAntarctica: 2,
        };
      case PlaylistType.SmallMaps:
        return {
          World: 4,
          EuropeClassic: 3,
          Mena: 2,
          Pangaea: 1,
          Asia: 1,
          Mars: 1,
          BetweenTwoSeas: 2,
          Japan: 2,
          BlackSea: 1,
          FaroeIslands: 2,
        };
    }
  }

  // Check for consecutive duplicates in the maps array
  private allNonConsecutive(maps: GameMapType[]): boolean {
    for (let i = 0; i < maps.length - 1; i++) {
      if (maps[i] === maps[i + 1]) {
        return false;
      }
    }
    return true;
  }
}
