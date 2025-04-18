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

  public getNextGameMode(): GameMode {
    const nextGameMode = this.gameModeRotation[this.currentGameModeIndex];
    this.currentGameModeIndex =
      (this.currentGameModeIndex + 1) % this.gameModeRotation.length;
    return nextGameMode;
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
    while (!this.allNonConsecutive(mapsPlaylist)) {
      random.shuffleArray(mapsPlaylist);
    }
  }

  // Specifically controls how the playlists rotate.
  private getNextPlaylistType(): PlaylistType {
    switch (this.currentPlaylistCounter) {
      case 0:
      case 1:
        this.currentPlaylistCounter++;
        return PlaylistType.BigMaps;
      case 2:
        this.currentPlaylistCounter = 0;
        return PlaylistType.SmallMaps;
    }
  }

  private getFrequency(playlistType: PlaylistType) {
    switch (playlistType) {
      // Big Maps are those larger than ~2.5 mil pixels
      case PlaylistType.BigMaps:
        return {
          Europe: 3,
          NorthAmerica: 2,
          Africa: 2,
          Britannia: 1,
          GatewayToTheAtlantic: 2,
          Australia: 1,
          Iceland: 1,
          SouthAmerica: 3,
          KnownWorld: 2,
        };
      case PlaylistType.SmallMaps:
        return {
          World: 1,
          Mena: 2,
          Pangaea: 1,
          Asia: 1,
          Mars: 1,
          BetweenTwoSeas: 3,
          Japan: 3,
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
