import { GameMapType, GameMode } from "../core/game/Game";
import { MAP_DEFINITIONS } from "../core/game/MapRegistry";
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
    if (mapsPlaylist.length === 0) {
      console.error(
        `Playlist ${PlaylistType[playlistType]} became empty unexpectedly. Refilling.`,
      );
      this.fillMapsPlaylist(playlistType, mapsPlaylist);
      if (mapsPlaylist.length === 0) {
        console.error(
          `Failed to refill playlist ${PlaylistType[playlistType]}. Returning default.`,
        );
        const defaultMapId =
          (MAP_DEFINITIONS.find((m) => m.identifier === "World")
            ?.identifier as GameMapType) ??
          (MAP_DEFINITIONS[0]?.identifier as GameMapType);
        if (!defaultMapId)
          throw new Error(
            "Map registry is empty, cannot provide a default map.",
          );
        return defaultMapId;
      }
    }
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
    mapsPlaylist.length = 0;

    for (const def of MAP_DEFINITIONS) {
      let weight = 0;
      if (playlistType === PlaylistType.BigMaps) {
        weight = def.playlistWeightBig ?? 0;
      } else {
        weight = def.playlistWeightSmall ?? 0;
      }

      const enumMember = GameMapType[def.identifier];
      if (enumMember === undefined) {
        console.error(
          `Map identifier ${def.identifier} not found in GameMapType enum during playlist fill.`,
        );
        continue;
      }

      for (let i = 0; i < weight; i++) {
        mapsPlaylist.push(enumMember);
      }
    }

    if (mapsPlaylist.length === 0) {
      console.warn(
        `Playlist ${PlaylistType[playlistType]} is empty after filling.`,
      );
      return;
    }

    let attempts = 0;
    const maxAttempts = 100;
    while (!this.allNonConsecutive(mapsPlaylist) && attempts < maxAttempts) {
      random.shuffleArray(mapsPlaylist);
      attempts++;
    }
    if (attempts >= maxAttempts) {
      console.warn(
        `Could not achieve non-consecutive map order for playlist ${PlaylistType[playlistType]} after ${maxAttempts} shuffles.`,
      );
    }
  }

  // Specifically controls how the playlists rotate.
  private getNextPlaylistType(): PlaylistType {
    const type =
      this.currentPlaylistCounter < 2
        ? PlaylistType.BigMaps
        : PlaylistType.SmallMaps;
    this.currentPlaylistCounter = (this.currentPlaylistCounter + 1) % 3;
    return type;
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
