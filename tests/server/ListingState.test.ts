import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEATURED_LOBBY_AUTO_START_MS,
  HOSTED_LOBBY_AUTO_START_MS,
  LobbyLabelSchema,
} from "../../src/core/Schemas";
import { ListingState } from "../../src/server/ListingState";

// The listing state on its own. How the game acts on it — rejecting a
// whitelist while listed, arming the start countdown at the deadline, what
// the lobby browser is told — is covered through GameServer in
// HostedLobbyListing.test.ts.

const T0 = 1_700_000_000_000;

describe("ListingState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts unlisted, unfeatured and undressed", () => {
    const listing = new ListingState();
    expect(listing.isListed()).toBe(false);
    expect(listing.autoStartAt()).toBeUndefined();
    expect(listing.isFeatured()).toBe(false);
    expect(listing.lobbyLabel()).toBeUndefined();
    expect(listing.lobbyAccent()).toBeUndefined();
  });

  it("dates the auto-start deadline from the moment of listing", () => {
    const listing = new ListingState();
    listing.setListed(true);
    expect(listing.autoStartAt()).toBe(T0 + HOSTED_LOBBY_AUTO_START_MS);
  });

  it("does not let a repeated listing push the deadline back", () => {
    const listing = new ListingState();
    listing.setListed(true);
    vi.setSystemTime(T0 + 60_000);
    listing.setListed(true);
    expect(listing.autoStartAt()).toBe(T0 + HOSTED_LOBBY_AUTO_START_MS);
  });

  it("drops the deadline on delist and starts a fresh one on relist", () => {
    const listing = new ListingState();
    listing.setListed(true);
    listing.setListed(false);
    expect(listing.isListed()).toBe(false);
    expect(listing.autoStartAt()).toBeUndefined();

    vi.setSystemTime(T0 + 60_000);
    listing.setListed(true);
    expect(listing.autoStartAt()).toBe(
      T0 + 60_000 + HOSTED_LOBBY_AUTO_START_MS,
    );
  });

  it("gives a featured lobby the longer deadline", () => {
    const listing = new ListingState();
    listing.setFeatured({});
    listing.setListed(true);
    expect(listing.isFeatured()).toBe(true);
    expect(listing.autoStartAt()).toBe(T0 + FEATURED_LOBBY_AUTO_START_MS);
  });

  it("keeps the featured dressing, with the label sanitised at the boundary", () => {
    const listing = new ListingState();
    // Control characters go, whitespace runs collapse; the label is rendered
    // as text, so markup-looking characters are just characters.
    listing.setFeatured({
      label: "  Friday \t Night\u0007 <Cup>  ",
      accent: "gold",
    });
    expect(listing.lobbyLabel()).toBe("Friday Night <Cup>");
    expect(LobbyLabelSchema.safeParse(listing.lobbyLabel()).success).toBe(true);
    expect(listing.lobbyAccent()).toBe("gold");
  });

  it("stores no label when the given one sanitises to nothing", () => {
    const listing = new ListingState();
    listing.setFeatured({ label: "   " });
    expect(listing.isFeatured()).toBe(true);
    expect(listing.lobbyLabel()).toBeUndefined();
  });
});
