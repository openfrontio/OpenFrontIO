import {
  FEATURED_LOBBY_AUTO_START_MS,
  HOSTED_LOBBY_AUTO_START_MS,
  LobbyAccent,
} from "../core/Schemas";
import { sanitizeLobbyLabel } from "../core/Util";

// A private lobby's presence in the public lobby browser: whether it is
// listed, since when (which drives the auto-start deadline), and the
// featured dressing an admin bot can give it. Deliberately kept out of
// GameConfig so update_game_config can't set any of it; only the
// authenticated listing endpoint (which verifies the creator's
// subscription) and create_game may.
export class ListingState {
  private listed = false;
  // When the lobby was listed. Cleared on delist, so relisting starts a
  // fresh deadline.
  private listedAt?: number;
  // Featured lobbies: a label shown instead of the map name, an accent for
  // the row, and a longer auto-start deadline.
  private label?: string;
  private accent?: LobbyAccent;
  private featured = false;

  isListed(): boolean {
    return this.listed;
  }

  setListed(listed: boolean): void {
    if (this.listed === listed) {
      // Duplicate toggles must not extend the auto-start deadline.
      return;
    }
    this.listed = listed;
    this.listedAt = listed ? Date.now() : undefined;
  }

  // Deadline after which a listed lobby starts automatically, so hosts
  // can't sit on a public listing indefinitely.
  autoStartAt(): number | undefined {
    if (!this.listed || this.listedAt === undefined) return undefined;
    return (
      this.listedAt +
      (this.featured
        ? FEATURED_LOBBY_AUTO_START_MS
        : HOSTED_LOBBY_AUTO_START_MS)
    );
  }

  isFeatured(): boolean {
    return this.featured;
  }

  lobbyLabel(): string | undefined {
    return this.label;
  }

  lobbyAccent(): LobbyAccent | undefined {
    return this.accent;
  }

  // Only create_game calls this. A label is sanitised at the boundary so no
  // unsanitised text can exist on a game at all.
  setFeatured(opts: { label?: string; accent?: LobbyAccent }): void {
    this.featured = true;
    const label = opts.label ? sanitizeLobbyLabel(opts.label) : "";
    this.label = label.length > 0 ? label : undefined;
    this.accent = opts.accent;
  }
}
